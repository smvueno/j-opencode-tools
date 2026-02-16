# j-opencode-tools

**Author:** Jens Madsen  
**Website:** https://jens-photo.com  
**Created:** February 16, 2026

---

## Description

Custom tools for OpenCode AI agent, extending functionality with specialized utilities for browser automation, file operations, and code manipulation.

## Installation

These are OpenCode AI plugin tools. They need to be placed in your OpenCode tools directory.

### Option 1: Clone to OpenCode tools directory

```bash
# Find your OpenCode tools directory (usually ~/.config/opencode/tools/)
# Clone or copy the .ts files there
git clone https://github.com/smvueno/j-opencode-tools.git ~/.config/opencode/tools/
```

### Option 2: Copy individual tools

```bash
# Copy specific tools you need
cp j-browser-playwright.ts ~/.config/opencode/tools/
cp replace_file_content.ts ~/.config/opencode/tools/
```

### Prerequisites

Some tools have external dependencies:

- **j-browser-playwright.ts**: Automatically installs Playwright in temp directories (no manual setup needed)
- **unminify_js.ts**: Requires `@wakaru/cli` - install with:
  ```bash
  pnpm add -g @wakaru/cli
  # or: npm install -g @wakaru/cli
  # or: yarn global add @wakaru/cli
  ```
- **replace_file_content.ts** & **multi_replace_file_content.ts**: No dependencies (uses Node.js built-ins only)

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
