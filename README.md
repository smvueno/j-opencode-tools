# j-opencode-tools

**Author:** Jens Madsen  
**Website:** https://jens-photo.com  
**Created:** February 16, 2026

---

## Description

Custom tools for OpenCode AI agent, extending functionality with specialized utilities for browser automation, file operations, and code manipulation.

## Installation

These are OpenCode AI plugin tools. Simply copy the `.ts` files to your OpenCode tools directory.

### Option 1: Clone to OpenCode tools directory

```bash
# Find your OpenCode tools directory (usually ~/.config/opencode/tools/)
git clone https://github.com/smvueno/j-opencode-tools.git ~/.config/opencode/tools/
```

### Option 2: Copy individual tools

```bash
# Copy only the tools you need
cp j-file-tool.ts ~/.config/opencode/tools/
cp j-browser-playwright.ts ~/.config/opencode/tools/
```

### Optional Dependencies

| Tool | Dependencies | Install |
|------|-------------|---------|
| **j-file-tool.ts** | None | N/A |
| **j-browser-playwright.ts** | Playwright | ✅ Auto-installs on first use |
| **replace_file_content.ts** | None | N/A |
| **multi_replace_file_content.ts** | None | N/A |
| **unminify_js.ts** | @wakaru/cli | ⚠️ Install manually if needed:

```bash
# Install @wakaru/cli globally (only needed for unminify_js.ts):
pnpm add -g @wakaru/cli
# or: npm install -g @wakaru/cli
# or: yarn global add @wakaru/cli
```

## Usage

These tools integrate with OpenCode to provide enhanced capabilities:

- **j-file-tool.ts** - **(NEW)** The Ultimate File Tool. Reads, writes (batch/single), creates, and safely deletes files with strict "Read-Before-Write" enforcement. Replaces `replace_file_content` and `multi_replace_file_content`.
- **j-browser-playwright.ts** - Browser automation using Playwright
- **replace_file_content.ts** - (Legacy) Replace content in files with validation
- **multi_replace_file_content.ts** - (Legacy) Batch replacements across multiple files
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
