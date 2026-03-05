# Figma Icon MCP

A **Model Context Protocol (MCP) server** that seamlessly extracts SVG icons from Figma, automatically detects duplicates in your local icon library, and generates ready-to-use TSX icon components.

## 🎯 What This MCP Does

This MCP is designed to **streamline icon workflow** by:

1. 📥 **Fetching icons from Figma** – Extract all SVG icons from a Figma page, artboard, or specific node
2. 🔍 **Smart duplicate detection** – Compares with your existing `components/icons/` folder using:
   - Fuzzy name matching (e.g., `arrow-left` ≈ `ArrowLeftIcon`)
   - SVG path similarity (compares actual vector data)
3. ✨ **Auto-generates TSX components** – Creates fully-typed, production-ready icon files
4. 🎨 **Themeable by default** – Generated icons support custom sizing and color via props

Perfect for design systems and component libraries that need to keep icons in sync with Figma!

## 📦 Generated Icon Format

All icons are generated as reusable, themeable React components:

```tsx
import React from "react";

interface ArrowLeftIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export const ArrowLeftIcon = ({
  size = 24,
  color = "currentColor",
  className,
}: ArrowLeftIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path d="..." fill={color} />
  </svg>
);

export default ArrowLeftIcon;
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Set Environment Variable

Export your Figma personal access token:

```bash
export FIGMA_TOKEN="figd_your_token_here"
```

You can get a token from: **Figma → Account Settings → Personal Access Tokens**

### 4. Configure in VS Code (MCP Integration)

Add to your `.vscode/mcp.json` (or workspace `mcp.json`):

**Option A: Using absolute path**

```json
{
  "servers": {
    "figma-icon-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/figma-icon-mcp/dist/index.js"],
       "env": {
        //----replace your figma token
        "FIGMA_TOKEN": "figd_sdfdfdSCWDSQWDWcfsdfr3498r",
      },
    }
  }
}
```

**Option B: Using workspace folder variable**

```json
{
  "servers": {
    "figma-icon-mcp": {
      "command": "node",
      "args": ["${workspaceFolder}/figma-icon-mcp/dist/index.js"],
      "type": "stdio",
       "env": {
        //----replace your figma token
        "FIGMA_TOKEN": "figd_sdfdfdSCWDSQWDWcfsdfr3498r",
      },
    }
  }
}
```

---

## 📖 How to Use This MCP

Once configured, you can use Copilot to interact with the MCP tools:

### Extract Icons from Figma

**Example prompt to Copilot:**

```
Extract all icons from this Figma URL and add new ones to my icons folder.
Skip any that already exist.

Figma URL: https://www.figma.com/file/ABC123xyz/MyDesign?node-id=10:200
Icons folder: /Users/me/myproject/src/components/icons
```

The tool will:

- Fetch all icons from the Figma node
- Compare names and SVG paths with existing icons
- Generate `.tsx` files for new icons only
- Report duplicates and new additions

### Convert Single SVG to Icon Component

**Example prompt:**

```
Convert this SVG to an icon component:

<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2L15.09 8.26H22L17.05 12.52L19.09 18.74L12 14.48L4.91 18.74L6.95 12.52L2 8.26H8.91L12 2Z" fill="black"/>
</svg>

Icon name: star
Icons directory: /Users/me/myproject/src/components/icons
```

---

## 🛠 Available Tools

### `extract_figma_icons`

The main tool for syncing icons from Figma to your project.

| Parameter       | Type    | Required | Description                                          |
| --------------- | ------- | -------- | ---------------------------------------------------- |
| `figma_url`     | string  | ✅       | Figma file, page, or node URL                        |
| `icons_dir`     | string  | ✅       | Absolute path to your `components/icons` folder      |
| `dry_run`       | boolean | ❌       | Preview without writing files (default: false)       |
| `copy_existing` | boolean | ❌       | Save duplicates with `-copy` suffix (default: false) |

### `svg_to_icon`

Convert raw SVG code into a TSX icon component.

| Parameter   | Type    | Required | Description                                   |
| ----------- | ------- | -------- | --------------------------------------------- |
| `svg_code`  | string  | ✅       | Raw SVG markup                                |
| `icon_name` | string  | ✅       | Descriptive name (e.g., `arrow-left`)         |
| `icons_dir` | string  | ❌       | Path to icons folder (for duplicate checking) |
| `dry_run`   | boolean | ❌       | Show TSX without writing to disk              |

### `debug_figma_node`

Helpful for troubleshooting. Dumps the full Figma node tree to diagnose icon detection issues.

| Parameter   | Type   | Required | Description                          |
| ----------- | ------ | -------- | ------------------------------------ |
| `figma_url` | string | ✅       | Figma file or node URL               |
| `depth`     | number | ❌       | How many levels to show (default: 4) |

---

## 🔄 Duplicate Detection

Icons are considered duplicates if they match on:

- **SVG Path Similarity** (60% weight) – Compares actual vector path data
- **Name Similarity** (40% weight) – Fuzzy fuzzy string matching

**Thresholds:**

- Icon is a duplicate if path similarity ≥ 80% OR name similarity ≥ 60%

Adjust these in [src/icon-matcher.ts](src/icon-matcher.ts) by modifying `nameThreshold` and `pathThreshold`.

---

## 📁 Project Structure

```
figma-icon-mcp/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── figma.ts           # Figma API client
│   ├── icon-matcher.ts    # Duplicate detection logic
│   └── svg-utils.ts       # SVG to TSX conversion
├── dist/                  # Compiled output (after npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔐 Security Notes

- **Never commit `FIGMA_TOKEN`** to version control
- Use `.env` files or environment variables
- The `.gitignore` file is included to prevent accidental commits

---

## 💡 Tips

- **Dry run first**: Use `dry_run: true` to preview changes before writing
- **Check node tree**: If icons aren't being detected, run `debug_figma_node` to see the Figma structure
- **Use absolute paths**: Always use absolute paths for `icons_dir` parameter
- **SVG naming**: Figma frame/group names become the icon names (converted to PascalCase)
