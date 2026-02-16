import { tool } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TARGET_SIZE = 100 * 1024;
const MAX_CHUNKS = 50;

export default tool({
  description: `Perform multiple renames or replacements in one file efficiently. BEST FOR: batch refactoring (rename several variables), updating multiple values at once, cascading renames. Use when user says "rename multiple", "several changes", "batch refactor", "multiple renames at once". Features: transaction mode (all-or-nothing), partial save mode, automatic backups, sequential processing, smart whitespace handling, context preview. Ideal for complex refactoring tasks.`,

  args: {
    FilePath: tool.schema.string().describe("Relative path to file"),
    ReplacementChunks: tool.schema.array(
      tool.schema.object({
        TargetContent: tool.schema.string().min(1).describe("Exact content to find"),
        ReplacementContent: tool.schema.string().describe("New content"),
        AllowMultiple: tool.schema.boolean().default(false).describe("Replace all occurrences"),
        ChunkLabel: tool.schema.string().optional().describe("Optional label for this chunk"),
        IgnoreWhitespace: tool.schema.enum(["exact", "normalized", "flexible"]).optional().default("exact")
          .describe("exact=match all whitespace, normalized=ignore leading/trailing per line, flexible=ignore all spacing")
      })
    ).min(1).max(MAX_CHUNKS).describe("Array of replacement operations"),
    DryRun: tool.schema.boolean().default(false).describe("Preview without modifying"),
    UseTransaction: tool.schema.boolean().default(true).describe("All-or-nothing mode (true) or save partial progress (false)"),
    CreateBackup: tool.schema.boolean().default(true).describe("Create .backup file before editing"),
    ShowContext: tool.schema.number().optional().default(3).describe("Lines of context to show around matches (0-10, default 3)"),
    ValidateFunctionCalls: tool.schema.boolean().default(false).describe("After replacement, warn if old variable names still referenced")
  },

  async execute(args, context) {
    const { FilePath, ReplacementChunks, DryRun, UseTransaction, CreateBackup, ShowContext, ValidateFunctionCalls } = args;

    try {
      const workspaceRoot = context.worktree || context.directory;
      const absolutePath = path.resolve(workspaceRoot, FilePath);

      if (!absolutePath.startsWith(workspaceRoot)) {
        return "❌ SECURITY: Path traversal detected. File must be within workspace.";
      }

      const displayPath = path.relative(workspaceRoot, absolutePath);

      if (!fs.existsSync(absolutePath)) {
        return `❌ FILE NOT FOUND: ${displayPath}`;
      }

      // SYMLINK DETECTION
      const fileStats = fs.lstatSync(absolutePath);
      if (fileStats.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(absolutePath);
        return `❌ SECURITY: Cannot edit symlinks\n\nFile: ${displayPath}\nPoints to: ${linkTarget}\n\nReason: Symlinks could escape workspace boundaries.`;
      }

      const stats = fs.statSync(absolutePath);
      if (stats.size > MAX_FILE_SIZE) {
        return `❌ FILE TOO LARGE: ${formatBytes(stats.size)} exceeds limit`;
      }

      if (isBinaryFile(absolutePath)) {
        return "❌ BINARY FILE: This tool only supports text files";
      }

      const validationResult = validateChunks(ReplacementChunks);
      if (!validationResult.valid) {
        return `❌ INVALID CHUNKS: ${validationResult.message}`;
      }

      const originalContent = fs.readFileSync(absolutePath, "utf-8");

      // AUTOMATIC BACKUP (before any processing)
      if (CreateBackup && !DryRun) {
        const backupPath = absolutePath + '.backup';
        try {
          fs.copyFileSync(absolutePath, backupPath);
        } catch (backupError) {
          return `❌ BACKUP FAILED: Could not create backup file\n\nError: ${backupError.message}\n\nFile was NOT modified for safety.`;
        }
      }

      let currentContent = originalContent;
      const chunkResults = [];
      let totalReplacements = 0;
      const contextLines = Math.min(Math.max(0, ShowContext || 3), 10);

      for (let i = 0; i < ReplacementChunks.length; i++) {
        const chunk = ReplacementChunks[i];
        const { TargetContent, ReplacementContent, AllowMultiple, ChunkLabel, IgnoreWhitespace } = chunk;
        const label = ChunkLabel || `Chunk ${i + 1}`;
        const wsMode = IgnoreWhitespace || "exact";

        if (TargetContent === ReplacementContent) {
          const result = `❌ NO-OP at ${label}: Target and replacement are identical

Progress: ${i} of ${ReplacementChunks.length} chunks completed before failure
${!UseTransaction && i > 0 ? `✓ Partial edits (${i} chunks) were saved` : "✗ All changes rolled back (transaction mode)"}`;

          if (!UseTransaction && currentContent !== originalContent) {
            saveFile(absolutePath, currentContent);
          }
          return result;
        }

        // Try to find match with whitespace handling
        const matchResult = findWithWhitespaceMode(currentContent, TargetContent, wsMode, AllowMultiple);

        if (!matchResult.found) {
          const betterPreview = generateBetterErrorContext(
            currentContent,
            TargetContent,
            contextLines,
            ReplacementChunks,
            i
          );

          const result = `❌ TARGET NOT FOUND at ${label} (chunk ${i + 1} of ${ReplacementChunks.length})

Progress: ${i} chunks completed successfully, ${ReplacementChunks.length - i} remaining
${!UseTransaction && i > 0 ? `✓ Partial edits (chunks 1-${i}) were SAVED` : "✗ All changes ROLLED BACK (transaction mode)"}

${betterPreview}

WHY THIS FAILED:
${i > 0 ? "• Previous replacement likely changed the content this chunk was looking for" : "• Target format doesn't match actual file formatting"}
• Whitespace or indentation differences (current mode: ${wsMode})
• Expected content was already modified

RECOVERY OPTIONS:
1. Use: read({ path: "${displayPath}" })
2. Try IgnoreWhitespace="normalized" or "flexible" for this chunk
3. ${UseTransaction ? `Fix chunk ${i + 1} and retry all ${ReplacementChunks.length} chunks` : `Continue with corrected chunks ${i + 1} to ${ReplacementChunks.length}`}`;

          if (!UseTransaction && currentContent !== originalContent) {
            saveFile(absolutePath, currentContent);
          }
          return result;
        }

        let replacementCount = 0;
        const contentBefore = currentContent;

        // Show context for first match if enabled
        let contextPreview = "";
        if (contextLines > 0 && matchResult.positions.length > 0) {
          contextPreview = generateMatchContext(currentContent, matchResult.positions[0], contextLines, label);
        }

        // Perform replacement
        if (AllowMultiple) {
          replacementCount = matchResult.positions.length;
          currentContent = performReplacements(currentContent, matchResult.positions, TargetContent, ReplacementContent, wsMode);
        } else {
          replacementCount = 1;
          const pos = matchResult.positions[0];
          currentContent = currentContent.substring(0, pos) +
            ReplacementContent +
            currentContent.substring(pos + matchResult.actualLength);
        }

        totalReplacements += replacementCount;

        chunkResults.push({
          label,
          replacements: replacementCount,
          charsDelta: currentContent.length - contentBefore.length,
          contextPreview
        });
      }

      const originalLines = originalContent.split("\n").length;
      const newLines = currentContent.split("\n").length;

      const summary = chunkResults.map(r =>
        `  • ${r.label}: ${r.replacements} replacement(s), ${r.charsDelta >= 0 ? '+' : ''}${r.charsDelta} chars${r.contextPreview ? '\n' + r.contextPreview : ''}`
      ).join("\n");

      if (DryRun) {
        return `🔍 DRY RUN - Preview for ${displayPath}:

Would apply ${ReplacementChunks.length} chunks with ${totalReplacements} total replacements

CHUNK DETAILS:
${summary}

TOTALS:
Lines: ${originalLines} → ${newLines} (${newLines - originalLines >= 0 ? '+' : ''}${newLines - originalLines})
Chars: ${originalContent.length} → ${currentContent.length} (${currentContent.length - originalContent.length >= 0 ? '+' : ''}${currentContent.length - originalContent.length})

⚠️  FILE NOT MODIFIED. Set DryRun=false to apply changes.`;
      }

      saveFile(absolutePath, currentContent);

      // VALIDATION WARNING
      const validationWarning = validateFileAfterEdit(absolutePath, displayPath);

      // FUNCTION CALL VALIDATION
      let functionCallWarnings = "";
      if (ValidateFunctionCalls) {
        functionCallWarnings = checkForOldFunctionCalls(currentContent, ReplacementChunks);
      }

      return `✅ SUCCESS - ${displayPath} updated!

Applied ${ReplacementChunks.length} chunks with ${totalReplacements} total replacements

CHUNK DETAILS:
${summary}

TOTALS:
Lines: ${originalLines} → ${newLines} (${newLines - originalLines >= 0 ? '+' : ''}${newLines - originalLines})
Chars: ${originalContent.length} → ${currentContent.length} (${currentContent.length - originalContent.length >= 0 ? '+' : ''}${currentContent.length - originalContent.length})

${CreateBackup ? `💾 Backup saved: ${displayPath}.backup` : ''}${validationWarning}${functionCallWarnings}

All changes applied successfully.`;

    } catch (error) {
      return `❌ ERROR: ${error.message}`;
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

function generateMatchContext(content, position, contextLines, label) {
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
    return `    ${marker} ${lineNum}: ${line}`;
  }).join('\n');

  return `\n    Match found at line ${matchLine + 1}:\n${contextSnippet}`;
}

function checkForOldFunctionCalls(content, chunks) {
  const warnings = [];

  for (const chunk of chunks) {
    const target = chunk.TargetContent;
    const replacement = chunk.ReplacementContent;

    // Extract potential function names from target (simple heuristic)
    const targetMatch = target.match(/^\s*(?:const|let|var)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);
    const replacementMatch = replacement.match(/^\s*(?:const|let|var)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);

    if (targetMatch && replacementMatch) {
      const oldName = targetMatch[1];
      const newName = replacementMatch[1];

      if (oldName !== newName) {
        // Check for remaining calls to old name
        const callPattern = new RegExp(`\\b${oldName}\\s*\\(`, 'g');
        const matches = content.match(callPattern);

        if (matches && matches.length > 0) {
          const lines = content.split('\n');
          const occurrences = [];

          lines.forEach((line, idx) => {
            if (callPattern.test(line)) {
              occurrences.push(`    Line ${idx + 1}: ${line.trim()}`);
            }
          });

          if (occurrences.length > 0 && occurrences.length <= 5) {
            warnings.push(`\n⚠️  Found ${occurrences.length} call(s) to old name '${oldName}' (should be '${newName}'):\n${occurrences.slice(0, 5).join('\n')}`);
          } else if (occurrences.length > 5) {
            warnings.push(`\n⚠️  Found ${occurrences.length} call(s) to old name '${oldName}' (should be '${newName}')\n    First 5 occurrences:\n${occurrences.slice(0, 5).join('\n')}\n    ... and ${occurrences.length - 5} more`);
          }
        }
      }
    }
  }

  return warnings.join('\n');
}

function saveFile(filePath, content) {
  const tempPath = filePath + ".tmp." + crypto.randomBytes(8).toString("hex");
  try {
    fs.writeFileSync(tempPath, content, "utf-8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { }
    throw error;
  }
}

function validateChunks(chunks) {
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].TargetContent === chunks[i].ReplacementContent) {
      return {
        valid: false,
        message: `Chunk ${i + 1} (${chunks[i].ChunkLabel || "unlabeled"}) has identical target and replacement`
      };
    }
  }

  for (let i = 0; i < chunks.length - 1; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      if (chunks[i].TargetContent === chunks[j].TargetContent) {
        return {
          valid: false,
          message: `Chunks ${i + 1} and ${j + 1} have duplicate targets`
        };
      }
    }
  }

  return { valid: true };
}

function generateBetterErrorContext(content, target, contextLines, allChunks, currentChunkIndex) {
  const lines = content.split("\n");
  const targetFirstLine = target.split("\n")[0].trim();

  if (targetFirstLine.length < 3) {
    const preview = lines.slice(0, 8).map((l, i) => `  ${i + 1}: ${l}`).join("\n");
    return `FILE CONTENT (first 8 lines):\n${preview}`;
  }

  const searchStr = targetFirstLine.substring(0, Math.min(20, targetFirstLine.length));
  const matchingLineIndices = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => line.toLowerCase().includes(searchStr.toLowerCase()))
    .slice(0, 3);

  if (matchingLineIndices.length === 0) {
    // Check if this might have been renamed by a previous chunk
    const possibleRename = checkForPreviousRename(target, allChunks, currentChunkIndex);

    const targetPreview = JSON.stringify(target.substring(0, 80)) + (target.length > 80 ? '...' : '');
    const filePreview = lines.slice(0, 8).map((l, i) => `  ${i + 1}: ${l}`).join("\n");

    let diagnosis = "";
    if (possibleRename) {
      diagnosis = `\n\n🔍 DIAGNOSIS:\nThis target may have been renamed in ${possibleRename.chunkLabel}.\nLook for the new name "${possibleRename.newName}" instead.`;
    }

    return `EXPECTED TO FIND:\n  > ${targetPreview}

FILE CONTENT (first 8 lines):\n${filePreview}

NO SIMILAR CONTENT FOUND. Check for typos.${diagnosis}`;
  }

  const targetPreview = JSON.stringify(target.substring(0, 80)) + (target.length > 80 ? '...' : '');
  let result = `EXPECTED TO FIND:\n  > ${targetPreview}\n\nSIMILAR CONTENT FOUND:\n`;

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

function checkForPreviousRename(target, allChunks, currentIndex) {
  // Extract potential variable name from target
  const targetMatch = target.match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);
  if (!targetMatch) return null;

  const targetVar = targetMatch[1];

  // Check if any previous chunk renamed this variable
  for (let i = 0; i < currentIndex; i++) {
    const chunk = allChunks[i];
    const chunkTargetMatch = chunk.TargetContent.match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);
    const chunkReplacementMatch = chunk.ReplacementContent.match(/^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);

    if (chunkTargetMatch && chunkReplacementMatch) {
      const oldName = chunkTargetMatch[1];
      const newName = chunkReplacementMatch[1];

      if (oldName === targetVar) {
        return {
          chunkLabel: chunk.ChunkLabel || `Chunk ${i + 1}`,
          oldName,
          newName
        };
      }
    }
  }

  return null;
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
