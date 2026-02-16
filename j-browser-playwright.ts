import { tool } from "@opencode-ai/plugin";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export default tool({
  description: `Inspect websites using a real browser. Captures console logs, errors, screenshots. Use for: "browse site", "open site", "check website", "test page", "inspect URL", "debug site", "console errors". Works with localhost, IPs, public URLs. Auto-downloads browser on first use.`,
  args: {
    URL: tool.schema.string().describe("URL to inspect (http://localhost:3000, https://example.com, etc.)"),
    CaptureScreenshot: tool.schema.boolean().default(false).describe("Take screenshot"),
    WaitSeconds: tool.schema.number().default(3).describe("Seconds to wait (1-30)")
  },
  async execute(args, context) {
    const { URL, CaptureScreenshot, WaitSeconds } = args;

    try {
      const workspaceRoot = process.cwd();
      const timeout = Math.min(Math.max(1, WaitSeconds), 30) * 1000;

      // Validate URL
      if (!/^https?:\/\//i.test(URL)) {
        return `❌ INVALID URL: ${URL}
Must start with http:// or https://
Examples: http://localhost:3000, https://example.com`;
      }

      // Generate files
      const id = crypto.randomBytes(4).toString('hex');
      const tempDir = path.join(workspaceRoot, `.browser-${id}`);
      const scriptPath = path.join(tempDir, 'inspect.mjs');
      const screenshotPath = CaptureScreenshot ? path.join(tempDir, `screenshot.png`) : null;
      const resultPath = path.join(tempDir, 'result.json');

      // Create temp directory
      fs.mkdirSync(tempDir, { recursive: true });

      // Create package.json with playwright dependency
      const packageJson = {
        type: "module",
        dependencies: {
          playwright: "latest"
        }
      };
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8');

      // Create script
      const script = generateScript(URL, resultPath, screenshotPath, timeout);
      fs.writeFileSync(scriptPath, script, 'utf-8');

      // Install playwright
      try {
        console.log('Installing Playwright...');
        execSync('pnpm install', {
          cwd: tempDir,
          timeout: 120000,
          stdio: 'pipe'
        });

        // Install chromium browser
        execSync('pnpm dlx playwright install chromium --with-deps', {
          cwd: tempDir,
          timeout: 120000,
          stdio: 'pipe'
        });
      } catch (installErr) {
        // Clean up
        fs.rmSync(tempDir, { recursive: true, force: true });
        return `❌ INSTALLATION FAILED
Error installing Playwright: ${installErr.message}`;
      }

      // Run the script with tsx
      console.log('Running browser inspection...');
      let stdout, stderr;
      try {
        stdout = execSync('pnpm dlx tsx inspect.mjs', {
          cwd: tempDir,
          timeout: timeout + 60000,
          encoding: 'utf-8',
          stdio: 'pipe'
        });
      } catch (execErr) {
        stderr = execErr.stderr || execErr.stdout || execErr.message;

        // Clean up
        fs.rmSync(tempDir, { recursive: true, force: true });

        return `❌ INSPECTION FAILED
URL: ${URL}
Error: ${stderr}

COMMON ISSUES:
• Server not running (for localhost)
• Network timeout
• Page JavaScript errors

TRY:
• Check server is running: curl ${URL}
• Increase WaitSeconds
• Test simpler URL first`;
      }

      // Read results
      if (!fs.existsSync(resultPath)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return `❌ NO RESULTS - Browser ran but returned no data
stdout: ${stdout}`;
      }

      let results;
      try {
        results = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      } catch (parseErr) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return `❌ INVALID RESULTS - Could not parse browser output
Error: ${parseErr.message}`;
      }

      // Copy screenshot to workspace root if it exists
      let finalScreenshotPath = null;
      if (CaptureScreenshot && screenshotPath && fs.existsSync(screenshotPath)) {
        finalScreenshotPath = path.join(workspaceRoot, `screenshot-${id}.png`);
        fs.copyFileSync(screenshotPath, finalScreenshotPath);
      }

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });

      // Format response
      const errors = results.console?.errors || [];
      const warnings = results.console?.warnings || [];
      const logs = results.console?.logs || [];

      let response = `✅ BROWSER INSPECTION
🌐 ${URL}
📄 ${results.title || '(no title)'}
⏱️ ${results.loadTime || 0}ms
📝 CONSOLE: ${logs.length} logs, ${warnings.length} warnings, ${errors.length} errors

`;

      if (errors.length > 0) {
        response += `❌ ERRORS (${errors.length}):\n`;
        errors.slice(0, 10).forEach((e, i) => {
          const msg = e.length > 150 ? e.substring(0, 150) + '...' : e;
          response += `  ${i + 1}. ${msg}\n`;
        });
        if (errors.length > 10) response += `  ... +${errors.length - 10} more\n`;
        response += '\n';
      } else {
        response += '✅ No errors\n\n';
      }

      if (warnings.length > 0) {
        response += `⚠️ WARNINGS (${warnings.length}):\n`;
        warnings.slice(0, 3).forEach((w, i) => {
          const msg = w.length > 150 ? w.substring(0, 150) + '...' : w;
          response += `  ${i + 1}. ${msg}\n`;
        });
        if (warnings.length > 3) response += `  ... +${warnings.length - 3} more\n`;
        response += '\n';
      }

      if (logs.length > 0) {
        response += `📋 LOGS (first 3):\n`;
        logs.slice(0, 3).forEach((l, i) => {
          const msg = l.length > 100 ? l.substring(0, 100) + '...' : l;
          response += `  ${i + 1}. ${msg}\n`;
        });
        response += '\n';
      }

      if (finalScreenshotPath && fs.existsSync(finalScreenshotPath)) {
        response += `📸 Screenshot: ${path.basename(finalScreenshotPath)}\n\n`;
      }

      response += errors.length > 0 ? `⚠️ ${errors.length} error(s) need attention` : '✅ Page OK';
      return response;

    } catch (error) {
      return `❌ ERROR: ${error.message}`;
    }
  }
});

function generateScript(url, resultPath, screenshotPath, timeout) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

async function run() {
  const results = { url: '${esc(url)}', title: '', loadTime: 0, console: { logs: [], errors: [], warnings: [] } };
  let browser, page;
  try {
    const start = Date.now();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    
    page.on('console', msg => {
      const t = msg.type(), txt = msg.text();
      if (t === 'error') results.console.errors.push(txt);
      else if (t === 'warning') results.console.warnings.push(txt);
      else results.console.logs.push(txt);
    });
    
    page.on('pageerror', e => results.console.errors.push('PageError: ' + e.message));
    
    await page.goto('${esc(url)}', { timeout: ${timeout}, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    
    results.title = await page.title();
    results.loadTime = Date.now() - start;
    
    ${screenshotPath ? `await page.screenshot({ path: 'screenshot.png', fullPage: false });` : ''}
    
    await page.close();
    await browser.close();
  } catch (e) {
    results.console.errors.push('Error: ' + e.message);
  }
  
  writeFileSync('result.json', JSON.stringify(results));
}

run().catch(e => { console.error(e); process.exit(1); });
`;
}
