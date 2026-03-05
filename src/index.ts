import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { parseFigmaUrl, fetchFigmaNodes, collectIconNodes, exportSVGs } from "./figma.js";
import { toPascalCase, extractSVGInternals, extractPaths, generateTSX } from "./svg-utils.js";
import { loadExistingIcons, findSimilarIcon, writeIconFile } from "./icon-matcher.js";

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
if (!FIGMA_TOKEN) {
  console.error("❌ FIGMA_TOKEN environment variable is not set.");
  process.exit(1);
}

const server = new Server(
  { name: "figma-icon-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "extract_figma_icons",
      description: "Extract SVG icons from a Figma page or node URL, compare with existing icon components, and generate new TSX icon files for any icons not already present.",
      inputSchema: {
        type: "object",
        properties: {
          figma_url: { type: "string", description: "Figma file or node URL." },
          icons_dir: { type: "string", description: "Absolute path to your icons folder." },
          dry_run: { type: "boolean", description: "Preview without writing files. Default: false." },
          copy_existing: { type: "boolean", description: "If true, write similar/duplicate icons with a -copy suffix instead of skipping. Default: false." },
        },
        required: ["figma_url", "icons_dir"],
      },
    },
    {
      name: "svg_to_icon",
      description: "Convert raw SVG code into a TSX icon component and optionally write it to your icons folder.",
      inputSchema: {
        type: "object",
        properties: {
          svg_code: { type: "string", description: "Raw SVG markup string." },
          icon_name: { type: "string", description: "Name for the icon (e.g. 'eye' → EyeIcon)." },
          icons_dir: { type: "string", description: "Optional. If provided, writes the TSX file there." },
          dry_run: { type: "boolean", description: "If true, only return TSX string, don't write file." },
        },
        required: ["svg_code", "icon_name"],
      },
    },
    {
      name: "debug_figma_node",
      description: "Dump the raw Figma node tree showing every node's type, name, and size. Use this to diagnose icon detection issues.",
      inputSchema: {
        type: "object",
        properties: {
          figma_url: { type: "string", description: "Figma file or node URL." },
          depth: { type: "number", description: "How many levels deep to show (default: 4)." },
        },
        required: ["figma_url"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ── debug_figma_node ─────────────────────────────────────────────────────
  if (name === "debug_figma_node") {
    const figmaUrl = args?.figma_url as string;
    const maxDepth = (args?.depth as number) ?? 4;
    try {
      const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
      const nodes = await fetchFigmaNodes(FIGMA_TOKEN, fileKey, nodeId);
      function printTree(node: any, depth: number, prefix: string): string {
        if (depth > maxDepth) return "";
        const bbox = node.absoluteBoundingBox;
        const size = bbox ? `${Math.round(bbox.width)}x${Math.round(bbox.height)}` : "no-bbox";
        let out = `${prefix}[${node.type}] "${node.name}" (${size})\n`;
        if (node.children) {
          for (const child of node.children) out += printTree(child, depth + 1, prefix + "  ");
        }
        return out;
      }
      const tree = nodes.map((n: any) => printTree(n, 0, "")).join("\n");
      return { content: [{ type: "text", text: `## Figma Node Tree\n\`\`\`\n${tree}\n\`\`\`\nShare this to diagnose icon detection issues.` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `❌ Error: ${err.message}` }] };
    }
  }

  // ── extract_figma_icons ──────────────────────────────────────────────────
  if (name === "extract_figma_icons") {
    const figmaUrl = args?.figma_url as string;
    const iconsDir = args?.icons_dir as string;
    const dryRun = (args?.dry_run as boolean) ?? false;
    const copyExisting = (args?.copy_existing as boolean) ?? false;

    try {
      const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
      const nodes = await fetchFigmaNodes(FIGMA_TOKEN, fileKey, nodeId);
      const iconNodes = collectIconNodes(nodes);

      if (iconNodes.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No icon nodes found.\n\nTip: Run `debug_figma_node` with the same URL to see the full node tree.",
          }],
        };
      }

      const nodeIds = iconNodes.map((n: any) => n.id);
      const svgMap = await exportSVGs(FIGMA_TOKEN, fileKey, nodeIds);
      const existingIcons = loadExistingIcons(iconsDir);

      const results: Array<{
        figmaName: string;
        componentName: string;
        status: "created" | "skipped" | "dry_run";
        reason?: string;
        filePath?: string;
        tsxPreview?: string;
      }> = [];

      for (const node of iconNodes) {
        const svgRaw = svgMap[(node as any).id];
        if (!svgRaw) continue;

        const componentName = toIconName((node as any).name);
        const newPaths = extractPaths(svgRaw);
        const match = findSimilarIcon(componentName, newPaths, existingIcons);

        if (!match.isNew) {
          if (copyExisting) {
            // Write with -copy suffix e.g. ShoppingCart03CopyIcon
            const copyName = componentName.replace(/Icon$/, "CopyIcon");
            const { viewBox, innerContent } = extractSVGInternals(svgRaw);
            const tsx = generateTSX(copyName, viewBox, innerContent);
            if (dryRun) {
              results.push({ figmaName: (node as any).name, componentName: copyName, status: "dry_run", tsxPreview: tsx });
            } else {
              const filePath = writeIconFile(iconsDir, copyName, tsx);
              results.push({ figmaName: (node as any).name, componentName: copyName, status: "created", filePath });
            }
          } else {
            results.push({
              figmaName: (node as any).name,
              componentName,
              status: "skipped",
              reason: `Similar to existing "${match.matchedIcon!.name}" (${match.matchType} match, ${match.similarity}% similarity)`,
            });
          }
          continue;
        }

        const { viewBox, innerContent } = extractSVGInternals(svgRaw);
        const tsx = generateTSX(componentName, viewBox, innerContent);

        if (dryRun) {
          results.push({ figmaName: (node as any).name, componentName, status: "dry_run", tsxPreview: tsx });
        } else {
          const filePath = writeIconFile(iconsDir, componentName, tsx);
          results.push({ figmaName: (node as any).name, componentName, status: "created", filePath });
        }
      }

      const created = results.filter((r) => r.status === "created" || r.status === "dry_run");
      const skipped = results.filter((r) => r.status === "skipped");

      let summary = `## Figma Icon Extraction Summary\n\n`;
      summary += `- **Total icons found in Figma node:** ${iconNodes.length}\n`;
      summary += `- **Icons detected:** ${iconNodes.map((n: any) => `\`${n.name}\``).join(", ")}\n`;
      summary += `- **New icons ${dryRun ? "(would be created)" : "created"}:** ${created.length}\n`;
      summary += `- **Skipped (already exist):** ${skipped.length}\n\n`;

      if (created.length > 0) {
        summary += `### ✅ ${dryRun ? "Would Create" : "Created"}\n`;
        for (const r of created) {
          summary += `- \`${r.componentName}.tsx\` (from Figma: "${r.figmaName}")`;
          if (r.filePath) summary += ` → \`${r.filePath}\``;
          summary += "\n";
          if (dryRun && r.tsxPreview) summary += `\n\`\`\`tsx\n${r.tsxPreview}\n\`\`\`\n`;
        }
        summary += "\n";
      }

      if (skipped.length > 0) {
        summary += `### ⏭️ Skipped\n`;
        for (const r of skipped) summary += `- \`${r.componentName}\` — ${r.reason}\n`;
      }

      return { content: [{ type: "text", text: summary }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `❌ Error: ${err.message}` }] };
    }
  }

  // ── svg_to_icon ──────────────────────────────────────────────────────────
  if (name === "svg_to_icon") {
    const svgCode = args?.svg_code as string;
    const rawName = args?.icon_name as string;
    const iconsDir = args?.icons_dir as string | undefined;
    const dryRun = (args?.dry_run as boolean) ?? false;
    try {
      const componentName = toIconName(rawName);
      const { viewBox, innerContent } = extractSVGInternals(svgCode);
      const tsx = generateTSX(componentName, viewBox, innerContent);
      let result = `## Generated: \`${componentName}.tsx\`\n\n\`\`\`tsx\n${tsx}\n\`\`\`\n`;
      if (iconsDir && !dryRun) {
        const newPaths = extractPaths(svgCode);
        const existingIcons = loadExistingIcons(iconsDir);
        const match = findSimilarIcon(componentName, newPaths, existingIcons);
        if (!match.isNew) {
          result += `\n⚠️ Similar icon already exists: \`${match.matchedIcon!.name}\` (${match.matchType} match, ${match.similarity}% similarity). File **not** written.\n`;
        } else {
          const filePath = writeIconFile(iconsDir, componentName, tsx);
          result += `\n✅ Written to: \`${filePath}\`\n`;
        }
      }
      return { content: [{ type: "text", text: result }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `❌ Error: ${err.message}` }] };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
});

function toIconName(name: string): string {
  const pascal = toPascalCase(name.replace(/\s+/g, "-"));
  return pascal.endsWith("Icon") ? pascal : `${pascal}Icon`;
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("figma-icon-mcp running on stdio");