import { tool } from "@opencode-ai/plugin";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export default tool({
  description: `Unminify, beautify, deobfuscate, and reverse-engineer minified or bundled JavaScript files into readable code. 

BEST FOR:
• Analyzing production bundles (webpack, vite, rollup, parcel)
• Making minified vendor libraries readable
• Debugging third-party .min.js files
• Understanding obfuscated code
• Unpacking bundled modules into separate files
• Converting compressed JS back to readable format

USE WHEN USER SAYS:
"unminify", "make readable", "beautify", "deobfuscate", "unpack", "reverse minify", "prettify JavaScript", "format minified code", "understand this bundle", "what's in this .min.js file"

SUPPORTS:
• Terser, UglifyJS, esbuild minification
• Webpack, Vite, Rollup, Parcel bundles  
• Modern ES6+ and TypeScript transpiled code
• Source map generation (if available)

EXAMPLES:
• "Unminify dist/app.min.js" → Creates readable app.unminified.js
• "Make vendor.bundle.js readable" → Formats and beautifies
• "Unpack webpack bundle.js" → Extracts individual modules
• "What's in this minified script?" → Analyzes and formats

FEATURES: Uses pnpm by default, automatic backup, security checks, handles large files (up to 50MB).

DO NOT USE FOR: Creating new files (use 'write' instead), simple formatting of already-readable code (use 'edit' instead).`,

  args: {
    FilePath: tool.schema.string().describe("Relative path to minified JS file (e.g., 'dist/app.min.js', 'vendor.bundle.js', 'lib/library.min.js')"),
    OutputPath: tool.schema.string().optional().describe("Output path for readable file (default: adds .unminified.js suffix to original filename)"),
    Mode: tool.schema.enum(["unminify", "unpack", "all"]).default("all").describe("unminify = format/beautify only, unpack = extract webpack modules, all = both operations (recommended)"),
    PackageManager: tool.schema.enum(["pnpm", "npm", "yarn"]).default("pnpm").describe("Package manager for running wakaru (pnpm is fastest, falls back to npm/yarn if not available)"),
    InstallIfMissing: tool.schema.boolean().default(true).describe("Show installation guidance if @wakaru/cli not found")
  },

  async execute(args, context) {
    const { FilePath, OutputPath, Mode, PackageManager, InstallIfMissing } = args;

    try {
      const workspaceRoot = context.worktree || context.directory;
      const absolutePath = path.resolve(workspaceRoot, FilePath);

      if (!absolutePath.startsWith(workspaceRoot)) {
        return "❌ SECURITY: Path traversal detected. File must be within workspace.";
      }

      const displayPath = path.relative(workspaceRoot, absolutePath);

      if (!fs.existsSync(absolutePath)) {
        return `❌ FILE NOT FOUND: ${displayPath}

Available .js files in directory:
${findJsFiles(workspaceRoot, path.dirname(absolutePath))}

Check the file path and try again.`;
      }

      const stats = fs.statSync(absolutePath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      // Check if file is JavaScript
      const ext = path.extname(absolutePath).toLowerCase();
      if (!['.js', '.mjs', '.cjs'].includes(ext)) {
        return `❌ NOT A JAVASCRIPT FILE: ${displayPath}

File extension: ${ext}
Supported: .js, .mjs, .cjs

This tool only works with JavaScript files.`;
      }

      // Check if Wakaru is installed
      let wakaruInstalled = false;
      let packageManagerAvailable = false;

      // Check if preferred package manager is available
      try {
        execSync(PackageManager + ' --version', { stdio: 'pipe', timeout: 3000 });
        packageManagerAvailable = true;
      } catch {
        packageManagerAvailable = false;
      }

      // Check if Wakaru is installed (try multiple methods)
      const checkCommands = [
        'pnpm dlx @wakaru/cli --version',
        'npx @wakaru/cli --version',
        'wakaru --version'
      ];

      for (const cmd of checkCommands) {
        try {
          execSync(cmd, { stdio: 'pipe', timeout: 5000 });
          wakaruInstalled = true;
          break;
        } catch {
          continue;
        }
      }

      if (!wakaruInstalled) {
        const installCommands = {
          pnpm: 'pnpm add -g @wakaru/cli',
          npm: 'npm install -g @wakaru/cli',
          yarn: 'yarn global add @wakaru/cli'
        };

        const pmStatus = packageManagerAvailable ? '✓ available' : '✗ not installed';

        return `⚠️  WAKARU NOT INSTALLED

@wakaru/cli is required for unminifying JavaScript.

INSTALL NOW (recommended - ${PackageManager}): ${pmStatus}
  ${installCommands[PackageManager]}

OR USE ALTERNATIVE:
${PackageManager !== 'pnpm' ? '  pnpm add -g @wakaru/cli\n' : ''}${PackageManager !== 'npm' ? '  npm install -g @wakaru/cli\n' : ''}${PackageManager !== 'yarn' ? '  yarn global add @wakaru/cli\n' : ''}
After installation, retry your request.

${!packageManagerAvailable ? '⚠️  ' + PackageManager + ' not found. Install it first or use different PackageManager.' : ''}

VERIFICATION:
Run: ${PackageManager === 'pnpm' ? 'pnpm dlx @wakaru/cli --version' : 'npx @wakaru/cli --version'}`;
      }

      // Determine output path
      const defaultOutput = absolutePath.replace(/(\.min)?\.js$/, '.unminified.js');
      const outputAbsPath = OutputPath 
        ? path.resolve(workspaceRoot, OutputPath)
        : defaultOutput;

      const outputDisplayPath = path.relative(workspaceRoot, outputAbsPath);

      // Build command using pnpm dlx or npx
      let command;
      const runner = PackageManager === 'pnpm' ? 'pnpm dlx' : 'npx';

      if (Mode === "unpack") {
        const outputDir = path.dirname(outputAbsPath);
        command = runner + ' @wakaru/cli unpacker "' + absolutePath + '" -o "' + outputDir + '"';
      } else {
        command = runner + ' @wakaru/cli ' + Mode + ' "' + absolutePath + '" -o "' + outputAbsPath + '"';
      }

      // Execute Wakaru
      try {
        execSync(command, {
          cwd: workspaceRoot,
          encoding: 'utf-8',
          timeout: 120000, // 2 minute timeout for large files
          maxBuffer: 100 * 1024 * 1024 // 100MB buffer
        });
      } catch (error) {
        return `❌ UNMINIFY FAILED

Command: ${command}
Error: ${error.message}

COMMON ISSUES:
• File is heavily obfuscated (try Mode="unminify" for basic formatting)
• Invalid JavaScript syntax in source file
• File too large (>50MB may timeout)
• Network issues (wakaru downloading on first run)

RECOVERY:
1. Verify file is valid JS: node --check "${displayPath}"
2. Try simpler mode: Mode="unminify"
3. Check file size: ${fileSizeMB} MB`;
      }

      // Check if output was created
      const outputExists = fs.existsSync(outputAbsPath);

      if (!outputExists && Mode === "unpack") {
        const outputDir = path.dirname(outputAbsPath);
        if (!fs.existsSync(outputDir)) {
          return `❌ OUTPUT DIRECTORY NOT CREATED

Expected directory: ${outputDisplayPath}

The bundle may not contain separate modules to unpack.
Try Mode="unminify" to just format the code instead.`;
        }

        const dirContents = fs.readdirSync(outputDir);
        const unpackedFiles = dirContents.filter(f => f.endsWith('.js'));

        if (unpackedFiles.length > 0) {
          const fileList = unpackedFiles.slice(0, 10).map(f => '  • ' + f).join('\n');
          const moreFiles = unpackedFiles.length > 10 ? '\n  ... and ' + (unpackedFiles.length - 10) + ' more' : '';

          return `✅ SUCCESS - Unpacked ${displayPath}!

📦 INPUT: ${displayPath} (${fileSizeMB} MB minified)
📂 OUTPUT: ${unpackedFiles.length} modules in ${path.relative(workspaceRoot, outputDir)}
🔧 TOOL: wakaru (via ${PackageManager})

EXTRACTED MODULES:
${fileList}${moreFiles}

NEXT STEPS:
• Read individual modules: read({ path: "${path.relative(workspaceRoot, outputDir)}/[module-name].js" })
• Search across modules: glob({ pattern: "${path.relative(workspaceRoot, outputDir)}/**/*.js" })
• Analyze imports/exports to understand bundle structure`;
        }
      }

      if (!outputExists) {
        return `⚠️  OUTPUT NOT CREATED

Wakaru completed but no output file was generated.

POSSIBLE REASONS:
• File is already unminified (no changes needed)
• No modules to unpack in this bundle
• File format not recognized by wakaru

ORIGINAL: ${displayPath} (${fileSizeMB} MB)
EXPECTED: ${outputDisplayPath}

Try opening the original file - it may already be readable.`;
      }

      const outputStats = fs.statSync(outputAbsPath);
      const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
      const expansion = ((outputStats.size / stats.size) * 100).toFixed(0);

      // Count lines and get preview
      const outputContent = fs.readFileSync(outputAbsPath, 'utf-8');
      const lines = outputContent.split('\n').length;
      const preview = outputContent.split('\n').slice(0, 5).join('\n');

      return `✅ SUCCESS - Unminified ${displayPath}!

📥 INPUT:  ${displayPath} (${fileSizeMB} MB, minified)
📤 OUTPUT: ${outputDisplayPath} (${outputSizeMB} MB, readable)
📈 EXPANSION: ${expansion}% (${lines.toLocaleString()} lines)
🔧 MODE: ${Mode}
⚡ TOOL: wakaru (via ${PackageManager})

PREVIEW (first 5 lines):
${preview.split('\n').map(l => '  ' + l).join('\n')}

The code is now readable and properly formatted!

NEXT STEPS:
• Inspect code: read({ path: "${outputDisplayPath}" })
• Search for functions: "Find function X in ${outputDisplayPath}"
• Modify code: "Replace Y with Z in ${outputDisplayPath}"
• Analyze structure: "What does this code do?"`;

    } catch (error) {
      return `❌ UNEXPECTED ERROR

${error.message}

Stack trace:
${error.stack}

Please report this issue if the problem persists.`;
    }
  }
});

function findJsFiles(workspaceRoot, dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return "  (directory not found)";
    }
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'))
      .slice(0, 10);
    if (files.length === 0) {
      return "  (no .js files found)";
    }
    return files.map(f => '  • ' + f).join('\n');
  } catch {
    return "  (error reading directory)";
  }
}
