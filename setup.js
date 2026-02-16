#!/usr/bin/env node

/**
 * Setup script for j-opencode-tools
 * Checks and installs required dependencies
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

console.log('🔧 Setting up j-opencode-tools...\n');

// Check if we're in the opencode tools directory
const currentDir = process.cwd();
const isToolsDir = currentDir.includes('opencode') && currentDir.includes('tools');

if (!isToolsDir) {
  console.log('⚠️  Warning: You may not be in the correct OpenCode tools directory.');
  console.log('   Current directory:', currentDir);
  console.log('   Expected something like: ~/.config/opencode/tools/');
  console.log('');
}

// Detect package manager
function detectPackageManager() {
  const managers = ['pnpm', 'npm', 'yarn'];
  
  for (const pm of managers) {
    try {
      execSync(`${pm} --version`, { stdio: 'pipe', timeout: 3000 });
      return pm;
    } catch {
      continue;
    }
  }
  return null;
}

const pm = detectPackageManager();

if (!pm) {
  console.log('❌ ERROR: No package manager found!');
  console.log('   Please install Node.js and npm first:');
  console.log('   https://nodejs.org/\n');
  process.exit(1);
}

console.log(`✓ Found package manager: ${pm}\n`);

// Check if @wakaru/cli is installed globally
console.log('📦 Checking @wakaru/cli...');
let wakaruInstalled = false;

try {
  execSync('wakaru --version', { stdio: 'pipe', timeout: 5000 });
  wakaruInstalled = true;
  console.log('✓ @wakaru/cli is already installed globally\n');
} catch {
  console.log('⚠️  @wakaru/cli not found. Installing...\n');
  
  try {
    const installCmd = pm === 'pnpm' ? 'pnpm add -g @wakaru/cli' :
                       pm === 'yarn' ? 'yarn global add @wakaru/cli' :
                                       'npm install -g @wakaru/cli';
    
    console.log(`Running: ${installCmd}\n`);
    execSync(installCmd, { stdio: 'inherit', timeout: 120000 });
    
    console.log('\n✓ @wakaru/cli installed successfully!\n');
    wakaruInstalled = true;
  } catch (error) {
    console.log('\n❌ Failed to install @wakaru/cli');
    console.log('   You can install it manually later with:');
    console.log(`   ${pm} add -g @wakaru/cli\n`);
  }
}

// Check for local dependencies
console.log('📦 Checking local dependencies...');

if (!fs.existsSync(path.join(currentDir, 'node_modules'))) {
  console.log('⚠️  node_modules not found. Installing dependencies...\n');
  
  try {
    execSync(`${pm} install`, { stdio: 'inherit', timeout: 120000 });
    console.log('\n✓ Dependencies installed!\n');
  } catch (error) {
    console.log('\n❌ Failed to install dependencies');
    console.log('   You can try manually: npm install\n');
  }
} else {
  console.log('✓ node_modules found\n');
}

// Summary
console.log('='.repeat(50));
console.log('✅ Setup complete!\n');
console.log('Tools available:');
console.log('  • j-browser-playwright.ts - Browser automation (auto-installs Playwright)');
console.log('  • replace_file_content.ts - File replacements');
console.log('  • multi_replace_file_content.ts - Batch replacements');
if (wakaruInstalled) {
  console.log('  • unminify_js.ts - Unminify JavaScript ✓');
} else {
  console.log('  • unminify_js.ts - Unminify JavaScript ⚠️  (needs @wakaru/cli)');
}

console.log('\n📖 Usage: These tools will be automatically available in OpenCode.');
console.log('🚀 Restart OpenCode if it was running during installation.\n');
