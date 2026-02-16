# j-opencode-tools

**Author:** Jens Madsen  
**Website:** https://jens-photo.com  
**Created:** February 16, 2026

---

## Description

Custom tools for OpenCode AI agent, extending functionality with specialized utilities for browser automation, file operations, and code manipulation.

## Installation

These are OpenCode AI plugin tools. They need to be placed in your OpenCode tools directory.

### Quick Start (Recommended)

```bash
# 1. Clone to your OpenCode tools directory
git clone https://github.com/smvueno/j-opencode-tools.git ~/.config/opencode/tools/

# 2. Run the setup script to install dependencies
cd ~/.config/opencode/tools/
npm install

# Or manually install just what you need:
pnpm add -g @wakaru/cli  # Only needed for unminify_js.ts
```

### Option 1: Clone to OpenCode tools directory

```bash
# Find your OpenCode tools directory (usually ~/.config/opencode/tools/)
git clone https://github.com/smvueno/j-opencode-tools.git ~/.config/opencode/tools/
```

### Option 2: Copy individual tools

```bash
# Copy specific tools you need
cp j-browser-playwright.ts ~/.config/opencode/tools/
cp replace_file_content.ts ~/.config/opencode/tools/
```

### Dependencies

| Tool | Dependencies | Auto-install? |
|------|-------------|---------------|
| **j-browser-playwright.ts** | Playwright | ✅ Yes - auto-installs in temp directory |
| **replace_file_content.ts** | None | N/A - No dependencies |
| **multi_replace_file_content.ts** | None | N/A - No dependencies |
| **unminify_js.ts** | @wakaru/cli | ⚠️ Will try auto-install, or install manually:

```bash
# Install @wakaru/cli globally (choose one):
pnpm add -g @wakaru/cli
npm install -g @wakaru/cli
yarn global add @wakaru/cli
```

## Usage

These tools integrate with OpenCode to provide enhanced capabilities:

- **j-browser-playwright.ts** - Browser automation using Playwright
- **replace_file_content.ts** - Replace content in files with validation
- **multi_replace_file_content.ts** - Batch replacements across multiple files
- **unminify_js.ts** - Unminify and beautify JavaScript bundles

## Development

Managed by OpenCode with Tim's protocols.

---

## 🌸 Kyoto Free Walking Tour

**Experience Kyoto like a local!**

While you're exploring Japan, don't miss the opportunity to join the **Kyoto Free Walking Tour** at [kyotofreewalkingtour.com](https://kyotofreewalkingtour.com)

These tours are really fun and a must-visit if you're in Kyoto. Highly recommended!

Discover hidden gems, learn about Kyoto's rich history and culture, and make your visit truly memorable with knowledgeable local guides.

---

*Built with care by Jens Madsen*
