import { tool } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execFileSync } from "child_process";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const STATE_FILE = ".opencode/j_file_tool_state.json";
const TRASH_DIR = ".opencode/trash";

export default tool({
  description: `The ULTIMATE file management tool for reading, writing, creating, and safely deleting files.
CRITICAL RULES:
1. ALWAYS read a file before editing it. The tool ENFORCES this with a strict "Read-Before-Write" check.
2. Supports batch operations: Read multiple files, edit multiple files, or delete multiple files in one call.
3. Safe Deletion: Moves files to system trash (macOS) or a local '.opencode/trash/' folder. NEVER permanently deletes.
4. Smart Editing: Features robust fuzzy matching (whitespace insensitive), syntax validation (JSON/JS/Python), and automatic backups.

Use this tool for ALL file operations. It replaces previous file editing tools.`,

  args: {
    command: tool.schema.enum(["read", "write", "create", "delete"]).describe("The operation to perform"),
    items: tool.schema.array(
      tool.schema.object({
        path: tool.schema.string().describe("Relative path to the file"),
        content: tool.schema.string().optional().describe("Content for 'create' command"),
        replacements: tool.schema.array(
          tool.schema.object({
            target: tool.schema.string().describe("Exact content to find"),
            replacement: tool.schema.string().describe("New content"),
            allow_multiple: tool.schema.boolean().default(false).describe("Replace all occurrences"),
            ignore_whitespace: tool.schema.enum(["exact", "normalized", "flexible"]).default("exact").describe("Whitespace matching mode")
          })
        ).optional().describe("List of replacements for 'write' command")
      })
    ).min(1).describe("List of files to operate on"),
    options: tool.schema.object({
      dry_run: tool.schema.boolean().default(false).describe("Preview changes without modifying"),
      create_backup: tool.schema.boolean().default(true).describe("Create .backup file before editing"),
      validate_syntax: tool.schema.boolean().default(true).describe("Validate syntax after edit (JSON/JS/Py)"),
      show_context: tool.schema.number().default(3).describe("Lines of context for preview")
    }).optional()
  },

  async execute(args, context) {
    const { command, items, options } = args;
    const workspaceRoot = context.worktree || context.directory;
    const results = [];
    const state = loadState(workspaceRoot);

    // Initialize state directory
    if (!fs.existsSync(path.join(workspaceRoot, ".opencode"))) {
      fs.mkdirSync(path.join(workspaceRoot, ".opencode"), { recursive: true });
    }

    try {
      for (const item of items) {
        const absolutePath = path.resolve(workspaceRoot, item.path);
        const displayPath = item.path;

        // Security Check
        if (!absolutePath.startsWith(workspaceRoot)) {
          results.push(`❌ SKIPPED ${displayPath}: Path traversal detected.`);
          continue;
        }

        // --- READ COMMAND ---
        if (command === "read") {
          if (!fs.existsSync(absolutePath)) {
            results.push(`❌ ERROR ${displayPath}: File not found.`);
            continue;
          }
          if (isBinaryFile(absolutePath)) {
            results.push(`❌ ERROR ${displayPath}: Cannot read binary file.`);
            continue;
          }

          const content = fs.readFileSync(absolutePath, "utf-8");
          // Update Read Receipt
          updateReadReceipt(state, displayPath, content);

          results.push(`📄 READ ${displayPath} (${content.length} chars):\n---\n${content}\n---`);
        }

        // --- CREATE COMMAND ---
        else if (command === "create") {
          if (fs.existsSync(absolutePath)) {
            results.push(`❌ ERROR ${displayPath}: File already exists. Use 'write' to edit.`);
            continue;
          }
          if (!item.content) {
            results.push(`❌ ERROR ${displayPath}: Content required for creation.`);
            continue;
          }

          if (!options?.dry_run) {
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, item.content, "utf-8");
            updateReadReceipt(state, displayPath, item.content);
          }
          results.push(`✨ CREATED ${displayPath}`);
        }

        // --- WRITE/EDIT COMMAND ---
        else if (command === "write") {
          if (!fs.existsSync(absolutePath)) {
            results.push(`❌ ERROR ${displayPath}: File not found. Use 'create' for new files.`);
            continue;
          }

          // STRICT READ-BEFORE-WRITE CHECK
          if (!validateReadReceipt(state, displayPath, absolutePath)) {
            results.push(`🛑 BLOCKED ${displayPath}: Read receipt invalid or missing.\n   REASON: File has changed or hasn't been read recently.\n   ACTION: You MUST read the file again using 'read' command before editing.`);
            continue;
          }

          if (!item.replacements || item.replacements.length === 0) {
            results.push(`⚠️ WARNING ${displayPath}: No replacements provided.`);
            continue;
          }

          const originalContent = fs.readFileSync(absolutePath, "utf-8");
          let currentContent = originalContent;
          let editLog = [];
          const contextLines = options?.show_context ?? 3;

          // Process Replacements
          for (const rep of item.replacements) {
             const wsMode = rep.ignore_whitespace || "exact";
             // Find matches using robust regex approach
             const matchResult = findWithRegex(currentContent, rep.target, wsMode, rep.allow_multiple);

             if (!matchResult.found) {
               const betterError = generateBetterErrorContext(currentContent, rep.target, contextLines);
               editLog.push(`❌ FAILED to find target:\n${betterError}`);
               continue;
             }

             // Show context for first match
             if (contextLines > 0 && matchResult.positions.length > 0) {
                editLog.push(generateMatchContext(currentContent, matchResult.positions[0].start, contextLines));
             }

             // Apply replacement
             if (rep.allow_multiple) {
                currentContent = performReplacements(currentContent, matchResult.positions, rep.replacement);
                editLog.push(`✅ Replaced ${matchResult.positions.length} occurrence(s)`);
             } else {
                const pos = matchResult.positions[0];
                currentContent = currentContent.substring(0, pos.start) + rep.replacement + currentContent.substring(pos.end);
                editLog.push(`✅ Replaced 1 occurrence`);
             }
          }

          if (currentContent === originalContent) {
            results.push(`⚠️ NO CHANGES for ${displayPath}: Targets not found or identical replacements.\n${editLog.join('\n')}`);
            continue;
          }

          // Syntax Validation
          if (options?.validate_syntax) {
             const syntaxError = validateContent(absolutePath, currentContent);
             if (syntaxError) {
                results.push(`❌ SYNTAX ERROR in ${displayPath}, write aborted:\n${syntaxError}`);
                continue;
             }
          }

          // Function Call Validation (Warning only)
          const functionWarnings = checkForOldFunctionCalls(currentContent, item.replacements);
          if (functionWarnings) {
             editLog.push(functionWarnings);
          }

          if (!options?.dry_run) {
            // Backup
            if (options?.create_backup) {
               fs.copyFileSync(absolutePath, absolutePath + ".backup");
            }

            fs.writeFileSync(absolutePath, currentContent, "utf-8");

            // INVALIDATE READ RECEIPT
            invalidateReadReceipt(state, displayPath);

            results.push(`💾 SAVED ${displayPath}:\n${editLog.join('\n')}\n(Read receipt invalidated - Read again to edit more)`);
          } else {
            results.push(`🔍 DRY RUN ${displayPath}:\n${editLog.join('\n')}`);
          }
        }

        // --- DELETE COMMAND ---
        else if (command === "delete") {
          if (!fs.existsSync(absolutePath)) {
            results.push(`⚠️ SKIPPED ${displayPath}: File not found.`);
            continue;
          }

          if (!options?.dry_run) {
            const trashResult = safeMoveToTrash(absolutePath, workspaceRoot);
            results.push(trashResult);
            invalidateReadReceipt(state, displayPath);
          } else {
            results.push(`🗑️ DRY RUN: Would move ${displayPath} to trash.`);
          }
        }
      }

      // Save state
      saveState(workspaceRoot, state);

      return results.join("\n\n");

    } catch (error) {
      return `❌ CRITICAL ERROR: ${error.message}`;
    }
  }
});

// --- STATE MANAGEMENT ---

function loadState(root) {
  try {
    const statePath = path.join(root, STATE_FILE);
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, "utf-8"));
    }
  } catch (e) {}
  return { files: {} };
}

function saveState(root, state) {
  try {
    const statePath = path.join(root, STATE_FILE);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (e) {}
}

function updateReadReceipt(state, filePath, content) {
  const hash = crypto.createHash("md5").update(content).digest("hex");
  state.files[filePath] = {
    hash: hash,
    timestamp: Date.now()
  };
}

function validateReadReceipt(state, filePath, absolutePath) {
  if (!state.files[filePath]) return false;

  const currentContent = fs.readFileSync(absolutePath, "utf-8");
  const currentHash = crypto.createHash("md5").update(currentContent).digest("hex");

  return state.files[filePath].hash === currentHash;
}

function invalidateReadReceipt(state, filePath) {
  if (state.files[filePath]) {
    delete state.files[filePath];
  }
}

// --- CORE LOGIC ---

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function findWithRegex(content, target, mode, findAll) {
  let regexPattern;

  if (mode === "exact") {
    regexPattern = escapeRegExp(target);
  } else if (mode === "normalized") {
    // Escape target, then replace literal \n with flexible newline matcher
    // This allows for different indentation around newlines
    regexPattern = escapeRegExp(target).replace(/\\n/g, '\\s*\\n\\s*');
  } else if (mode === "flexible") {
    // Escape target, then replace any whitespace sequence with \s+
    // We first split by whitespace to get tokens, escape them, then join with \s+
    const tokens = target.split(/\s+/).filter(t => t.length > 0);
    regexPattern = tokens.map(escapeRegExp).join('\\s+');
  }

  // Create RegExp
  // We use 'g' if findAll is true, otherwise no flags (find first)
  // Actually, for matchAll/exec loop we need 'g' to find multiple or to construct logic manually.
  // Safer: always use 'g' and stop after one if !findAll
  const flags = 'g';
  const regex = new RegExp(regexPattern, flags);

  const positions = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    positions.push({
      start: match.index,
      end: match.index + match[0].length,
      length: match[0].length
    });

    if (!findAll) break;
  }

  return {
    found: positions.length > 0,
    positions
  };
}

function performReplacements(content, positions, replacement) {
  // Sort reverse to maintain indices
  const sortedPositions = [...positions].sort((a, b) => b.start - a.start);
  let result = content;

  for (const pos of sortedPositions) {
    result = result.substring(0, pos.start) + replacement + result.substring(pos.end);
  }
  return result;
}

function safeMoveToTrash(absolutePath, root) {
  const filename = path.basename(absolutePath);

  if (process.platform === "darwin") {
    try {
      // Use execFileSync with osascript for safety
      // We pass the script as an argument to -e
      const script = `tell application "Finder" to delete POSIX file "${absolutePath.replace(/"/g, '\\"')}"`;
      execFileSync("osascript", ["-e", script]);
      return `🗑️ TRASHED ${filename} (System Trash)`;
    } catch (e) {
      // Fallback
    }
  }

  const trashDir = path.join(root, TRASH_DIR);
  if (!fs.existsSync(trashDir)) {
    fs.mkdirSync(trashDir, { recursive: true });
  }

  const destPath = path.join(trashDir, `${filename}.${Date.now()}`);
  fs.renameSync(absolutePath, destPath);
  return `🗑️ TRASHED ${filename} (Moved to ${TRASH_DIR})`;
}

function validateContent(absolutePath, content) {
  const ext = path.extname(absolutePath).toLowerCase();

  const tempPath = absolutePath + ".validate.tmp";
  try {
      fs.writeFileSync(tempPath, content);

      if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') {
        try {
            execFileSync("node", ["--check", tempPath], { stdio: 'pipe' });
        } catch (e) {
            return `JavaScript syntax error: ${e.message}`;
        }
      } else if (ext === '.py') {
        try {
            execFileSync("python3", ["-m", "py_compile", tempPath], { stdio: 'pipe' });
        } catch (e) {
            return `Python syntax error: ${e.message}`;
        }
      } else if (ext === '.json') {
        try { JSON.parse(content); } catch (e) { return `JSON syntax error: ${e.message}`; }
      }
  } catch (e) {
      return `Validation failed: ${e.message}`;
  } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
  return null;
}

function isBinaryFile(filePath) {
  try {
    const buffer = Buffer.alloc(512);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch { return false; }
}

function generateBetterErrorContext(content, target, contextLines) {
    const lines = content.split("\n");
    const targetFirstLine = target.split("\n")[0].trim().substring(0, 50);

    const searchStr = targetFirstLine.substring(0, Math.min(20, targetFirstLine.length));
    const matchingLineIndices = lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => line.toLowerCase().includes(searchStr.toLowerCase()))
        .slice(0, 3);

    if (matchingLineIndices.length > 0) {
        let result = `Expected to find: "${targetFirstLine}..."\nSimilar lines found:\n`;
        matchingLineIndices.forEach(({ idx }) => {
            const start = Math.max(0, idx - contextLines);
            const end = Math.min(lines.length, idx + contextLines + 1);
            result += lines.slice(start, end).map((l, i) => `  ${start + i + 1}: ${l}`).join('\n') + "\n...\n";
        });
        return result;
    }

    return `Content not found. Check whitespace or use 'read' to verify content.`;
}

function generateMatchContext(content, position, contextLines) {
  const lines = content.split('\n');
  let currentPos = 0;
  let matchLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (currentPos + lines[i].length >= position) {
      matchLine = i;
      break;
    }
    currentPos += lines[i].length + 1;
  }

  const start = Math.max(0, matchLine - contextLines);
  const end = Math.min(lines.length, matchLine + contextLines + 1);

  const contextSnippet = lines.slice(start, end).map((line, idx) => {
    const lineNum = start + idx + 1;
    const marker = (start + idx === matchLine) ? '→' : ' ';
    return `  ${marker} ${lineNum}: ${line}`;
  }).join('\n');

  return `Match found at line ${matchLine + 1}:\n${contextSnippet}`;
}

function checkForOldFunctionCalls(content, replacements) {
  const warnings = [];

  for (const rep of replacements) {
    const targetMatch = rep.target.match(/^\s*(?:const|let|var|function)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=(]/);
    const replacementMatch = rep.replacement.match(/^\s*(?:const|let|var|function)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=(]/);

    if (targetMatch && replacementMatch) {
      const oldName = targetMatch[1];
      const newName = replacementMatch[1];

      if (oldName !== newName) {
        // Safe regex construction
        const safeOldName = escapeRegExp(oldName);
        const callPattern = new RegExp(`\\b${safeOldName}\\s*\\(`, 'g');
        const matches = content.match(callPattern);
        if (matches && matches.length > 0) {
           warnings.push(`⚠️ WARNING: Found ${matches.length} call(s) to old name '${oldName}' (renamed to '${newName}'). Check if you need to update usages.`);
        }
      }
    }
  }
  return warnings.length > 0 ? warnings.join('\n') : null;
}
