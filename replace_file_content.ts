import { tool } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TARGET_SIZE = 100 * 1024;

export default tool({
  description: `Replace, rename, or refactor exact text in files. BEST FOR: renaming variables/functions, changing repeated strings, find-and-replace operations, updating configuration values. Use when user says "rename", "change all", "replace all", "update text", or "refactor". SAFER than 'edit' tool for bulk changes. Features: automatic .backup files, syntax validation, security checks, smart whitespace handling, context preview. Requires EXACT text match including whitespace (unless flexible mode enabled).`,

  args: {
    FilePath: tool.schema.string().describe("Relative path to file from workspace root (e.g., 'src/App.js' or 'config.json')"),
    TargetContent: tool.schema.string().min(1).describe("Exact content to find and replace"),
    ReplacementContent: tool.schema.string().describe("New content to replace with"),
    AllowMultiple: tool.schema.boolean().default(false).describe("true = replace ALL matches in file (most common), false = replace only first match"),
    DryRun: tool.schema.boolean().default(false).describe("Preview changes without modifying file"),
    CreateBackup: tool.schema.boolean().default(true).describe("Create .backup file before editing"),
    IgnoreWhitespace: tool.schema.enum(["exact", "normalized", "flexible"]).default("exact")
      .describe("exact=match all whitespace, normalized=ignore leading/trailing per line, flexible=ignore all spacing differences"),
    ShowContext: tool.schema.number().optional().default(3).describe("Lines of context to show around match (0-10, default 3)"),
    ValidateFunctionCalls: tool.schema.boolean().default(false).describe("After replacement, warn if old variable name still referenced in function calls")
  },

  async execute(args, context) {
    const { FilePath, TargetContent, ReplacementContent, AllowMultiple, DryRun, CreateBackup, IgnoreWhitespace, ShowContext, ValidateFunctionCalls } = args;

    try {
      const workspaceRoot = context.worktree || context.directory;
      const absolutePath = path.resolve(workspaceRoot, FilePath);

      if (!absolutePath.startsWith(workspaceRoot)) {
        return "❌ SECURITY: Path traversal detected. File must be within workspace.";
      }

      const displayPath = path.relative(workspaceRoot, absolutePath);

      if (!fs.existsSync(absolutePath)) {
        return `❌ FILE NOT FOUND: ${displayPath}\n\nRecovery: Use read tool to verify the correct file path.`;
      }

      // SYMLINK DETECTION
      const fileStats = fs.lstatSync(absolutePath);
      if (fileStats.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(absolutePath);
        return `❌ SECURITY: Cannot edit symlinks\n\nFile: ${displayPath}\nPoints to: ${linkTarget}\n\nReason: Symlinks could escape workspace boundaries.`;
      }

      const stats = fs.statSync(absolutePath);
      if (stats.size > MAX_FILE_SIZE) {
        return `❌ FILE TOO LARGE: ${formatBytes(stats.size)} exceeds ${formatBytes(MAX_FILE_SIZE)} limit`;
      }

      if (isBinaryFile(absolutePath)) {
        return "❌ BINARY FILE: This tool only supports text files";
      }

      const originalContent = fs.readFileSync(absolutePath, "utf-8");

      if (TargetContent === ReplacementContent) {
        return "❌ NO-OP: Target and replacement are identical. No changes needed.";
      }

      const contextLines = Math.min(Math.max(0, ShowContext || 3), 10);
      const wsMode = IgnoreWhitespace || "exact";

      // Try to find match with whitespace handling
      const matchResult = findWithWhitespaceMode(originalContent, TargetContent, wsMode, AllowMultiple);

      if (!matchResult.found) {
        const betterPreview = generateBetterErrorContext(originalContent, TargetContent, contextLines);
        return `❌ TARGET NOT FOUND in ${displayPath}

${betterPreview}

COMMON MISTAKES:
• Whitespace mismatch (spaces vs tabs) - current mode: ${wsMode}
• Line ending differences (LF vs CRLF)
• Missing or extra newlines
• Partial line match instead of complete lines

RECOVERY OPTIONS:
1. Use: read({ path: "${displayPath}" })
2. Copy EXACT text including all whitespace
3. Try IgnoreWhitespace="normalized" or "flexible"
4. Check for invisible characters (tabs, newlines)
5. Retry with exact matched content`;
      }

      let newContent;
      let replacementCount = 0;
      let matchContextPreview = "";

      // Show context for first match if enabled
      if (contextLines > 0 && matchResult.positions.length > 0) {
        matchContextPreview = generateMatchContext(originalContent, matchResult.positions[0], contextLines);
      }

      // Perform replacement
      if (AllowMultiple) {
        replacementCount = matchResult.positions.length;
        newContent = performReplacements(originalContent, matchResult.positions, TargetContent, ReplacementContent, wsMode);
      } else {
        replacementCount = 1;
        const pos = matchResult.positions[0];
        newContent = originalContent.substring(0, pos) +
          ReplacementContent +
          originalContent.substring(pos + matchResult.actualLength);
      }

      const originalLines = originalContent.split("\n").length;
      const newLines = newContent.split("\n").length;
      const lineDelta = newLines - originalLines;

      if (DryRun) {
        return `🔍 DRY RUN - Preview for ${displayPath}:

Would replace ${replacementCount} occurrence(s)
Lines: ${originalLines} → ${newLines} (${lineDelta >= 0 ? '+' : ''}${lineDelta})
Chars: ${originalContent.length} → ${newContent.length} (${newContent.length - originalContent.length >= 0 ? '+' : ''}${newContent.length - originalContent.length})
Whitespace mode: ${wsMode}

${matchContextPreview ? 'MATCH LOCATION:\n' + matchContextPreview + '\n\n' : ''}Target: ${JSON.stringify(TargetContent.substring(0, 60))}${TargetContent.length > 60 ? '...' : ''}
Replacement: ${JSON.stringify(ReplacementContent.substring(0, 60))}${ReplacementContent.length > 60 ? '...' : ''}

⚠️  FILE NOT MODIFIED. Set DryRun=false to apply changes.`;
      }

      // AUTOMATIC BACKUP
      if (CreateBackup) {
        const backupPath = absolutePath + '.backup';
        try {
          fs.copyFileSync(absolutePath, backupPath);
        } catch (backupError) {
          return `❌ BACKUP FAILED: Could not create backup file\n\nError: ${backupError.message}\n\nFile was NOT modified for safety.`;
        }
      }

      const tempPath = absolutePath + ".tmp." + crypto.randomBytes(8).toString("hex");

      try {
        fs.writeFileSync(tempPath, newContent, "utf-8");
        fs.renameSync(tempPath, absolutePath);
      } catch (writeError) {
        try { fs.unlinkSync(tempPath); } catch { }
        throw writeError;
      }

      // VALIDATION WARNING
      const validationWarning = validateFileAfterEdit(absolutePath, displayPath);

      // FUNCTION CALL VALIDATION
      let functionCallWarning = "";
      if (ValidateFunctionCalls) {
        functionCallWarning = checkForOldFunctionCalls(newContent, TargetContent, ReplacementContent);
      }

      return `✅ SUCCESS - ${displayPath} updated!

Replaced ${replacementCount} occurrence(s)
Lines: ${originalLines} → ${newLines} (${lineDelta >= 0 ? '+' : ''}${lineDelta})
Chars: ${originalContent.length} → ${newContent.length} (${newContent.length - originalContent.length >= 0 ? '+' : ''}${newContent.length - originalContent.length})
${wsMode !== 'exact' ? `Whitespace mode: ${wsMode}\n` : ''}
${matchContextPreview ? '\nREPLACEMENT LOCATION:\n' + matchContextPreview + '\n' : ''}
${CreateBackup ? `💾 Backup saved: ${displayPath}.backup` : ''}${validationWarning}${functionCallWarning}

Changes applied successfully.`;

    } catch (error) {
      return `❌ ERROR: ${error.message}

${error.code === "EACCES" ? "File permissions issue. File may be read-only or locked." :
          error.code === "ENOSPC" ? "Disk space full." :
            "Check if file is accessible."}`;
    }
  }
});

function findWithWhitespaceMode(content, target, mode, findAll) {
  const positions = [];
  let searchContent = content;
  let searchTarget = target;

  if (mode === "normalized") {
    // Normalize line-by-line (trim each line)
    const normalizeLines = (str) => str.split('\n').map(l => l.trim()).join('\n');
    searchContent = normalizeLines(content);
    searchTarget = normalizeLines(target);
  } else if (mode === "flexible") {
    // Replace all whitespace with single space
    const normalizeWhitespace = (str) => str.replace(/\s+/g, ' ').trim();
    searchContent = normalizeWhitespace(content);
    searchTarget = normalizeWhitespace(target);
  }

  if (findAll) {
    let index = 0;
    while ((index = searchContent.indexOf(searchTarget, index)) !== -1) {
      positions.push(index);
      index += searchTarget.length;
    }
  } else {
    const index = searchContent.indexOf(searchTarget);
    if (index !== -1) {
      positions.push(index);
    }
  }

  return {
    found: positions.length > 0,
    positions,
    actualLength: searchTarget.length
  };
}

function performReplacements(content, positions, target, replacement, wsMode) {
  // Work backwards to maintain position indices
  const sortedPositions = [...positions].sort((a, b) => b - a);
  let result = content;

  const actualTarget = wsMode === "exact" ? target :
    wsMode === "normalized" ? target.split('\n').map(l => l.trim()).join('\n') :
      target.replace(/\s+/g, ' ').trim();

  for (const pos of sortedPositions) {
    result = result.substring(0, pos) + replacement + result.substring(pos + actualTarget.length);
  }

  return result;
}

function generateMatchContext(content, position, contextLines) {
  const lines = content.split('\n');
  let currentPos = 0;
  let matchLine = 0;

  // Find which line the match is on
  for (let i = 0; i < lines.length; i++) {
    if (currentPos + lines[i].length >= position) {
      matchLine = i;
      break;
    }
    currentPos += lines[i].length + 1; // +1 for newline
  }

  const start = Math.max(0, matchLine - contextLines);
  const end = Math.min(lines.length, matchLine + contextLines + 1);

  const contextSnippet = lines.slice(start, end).map((line, idx) => {
    const lineNum = start + idx + 1;
    const marker = (start + idx === matchLine) ? '→' : ' ';
    return `  ${marker} ${lineNum}: ${line}`;
  }).join('\n');

  return `  Match found at line ${matchLine + 1}:\n${contextSnippet}`;
}

function checkForOldFunctionCalls(content, target, replacement) {
  // Extract potential function/variable names
  const targetMatch = target.match(/^\s*(?:const|let|var)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);
  const replacementMatch = replacement.match(/^\s*(?:const|let|var)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);

  if (!targetMatch || !replacementMatch) {
    return ""; // Not a variable/function rename
  }

  const oldName = targetMatch[1];
  const newName = replacementMatch[1];

  if (oldName === newName) {
    return ""; // No name change
  }

  // Check for remaining calls to old name
  const callPattern = new RegExp(`\\b${oldName}\\s*\\(`, 'g');
  const matches = content.match(callPattern);

  if (matches && matches.length > 0) {
    const lines = content.split('\n');
    const occurrences = [];

    lines.forEach((line, idx) => {
      if (new RegExp(`\\b${oldName}\\s*\\(`).test(line)) {
        occurrences.push(`  Line ${idx + 1}: ${line.trim()}`);
      }
    });

    if (occurrences.length > 0 && occurrences.length <= 5) {
      return `\n\n⚠️  WARNING: Found ${occurrences.length} call(s) to old name '${oldName}' (should be '${newName}'):\n${occurrences.join('\n')}\n\nYou may need additional replacements to update these function calls.`;
    } else if (occurrences.length > 5) {
      return `\n\n⚠️  WARNING: Found ${occurrences.length} call(s) to old name '${oldName}' (should be '${newName}')\nFirst 5 occurrences:\n${occurrences.slice(0, 5).join('\n')}\n... and ${occurrences.length - 5} more\n\nYou may need additional replacements to update these function calls.`;
    }
  }

  return "";
}

function generateBetterErrorContext(content, target, contextLines) {
  const lines = content.split("\n");
  const targetFirstLine = target.split("\n")[0].trim();

  if (targetFirstLine.length < 3) {
    const preview = lines.slice(0, 10).map((l, i) => `  ${i + 1}: ${l}`).join("\n");
    return `FILE CONTENT (first 10 lines):\n${preview}`;
  }

  const searchStr = targetFirstLine.substring(0, Math.min(20, targetFirstLine.length));
  const matchingLineIndices = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => line.toLowerCase().includes(searchStr.toLowerCase()))
    .slice(0, 3); // Show up to 3 similar matches

  if (matchingLineIndices.length === 0) {
    const targetPreview = JSON.stringify(target.substring(0, 100)) + (target.length > 100 ? '...' : '');
    const filePreview = lines.slice(0, 10).map((l, i) => `  ${i + 1}: ${l}`).join("\n");
    return `EXPECTED TO FIND (first 100 chars):\n  > ${targetPreview}

FILE CONTENT (first 10 lines):\n${filePreview}

NO SIMILAR CONTENT FOUND. Check for typos or use read tool.`;
  }

  const targetPreview = JSON.stringify(target.substring(0, 80)) + (target.length > 80 ? '...' : '');
  let result = `EXPECTED TO FIND:\n  > ${targetPreview}\n\nSIMILAR CONTENT FOUND (might help):\n`;

  matchingLineIndices.forEach(({ idx }) => {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(lines.length, idx + contextLines + 1);
    const snippet = lines.slice(start, end).map((l, i) => {
      const lineNum = start + i + 1;
      const marker = (start + i === idx) ? '→' : ' ';
      return `  ${marker} ${lineNum}: ${l}`;
    }).join("\n");
    result += snippet + "\n\n";
  });

  return result;
}

function validateFileAfterEdit(absolutePath, displayPath) {
  const ext = path.extname(absolutePath).toLowerCase();

  try {
    if (ext === '.json') {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      JSON.parse(content);
      return "\n✓ JSON validation passed";
    }

    if (ext === '.py') {
      try {
        execSync('python3 -m py_compile "' + absolutePath + '"', {
          stdio: 'pipe',
          timeout: 3000
        });
        return "\n✓ Python syntax validation passed";
      } catch {
        return "\n⚠️  WARNING: Python syntax check failed. File may have syntax errors.";
      }
    }

    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
      try {
        execSync('node --check "' + absolutePath + '"', {
          stdio: 'pipe',
          timeout: 3000
        });
        return "\n✓ JavaScript syntax validation passed";
      } catch {
        return "\n⚠️  WARNING: JavaScript syntax check failed. File may have syntax errors.";
      }
    }
  } catch (error) {
    // Best-effort validation
  }

  return "";
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
  } catch {
    return false;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
