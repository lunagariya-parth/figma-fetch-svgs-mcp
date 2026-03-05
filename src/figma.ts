import axios from "axios";

const FIGMA_BASE = "https://api.figma.com/v1";

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
}

/** Parse fileKey and optional nodeId from a Figma URL */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } {
  const urlMatch = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  if (urlMatch) {
    const fileKey = urlMatch[1];
    const nodeMatch = input.match(/node-id=([^&]+)/);
    const nodeId = nodeMatch
      ? decodeURIComponent(nodeMatch[1]).replace("-", ":")
      : undefined;
    return { fileKey, nodeId };
  }
  return { fileKey: input };
}

/** Fetch nodes from Figma API */
export async function fetchFigmaNodes(
  token: string,
  fileKey: string,
  nodeId?: string
): Promise<FigmaNode[]> {
  if (nodeId) {
    const res = await axios.get(`${FIGMA_BASE}/files/${fileKey}/nodes`, {
      headers: { "X-Figma-Token": token },
      params: { ids: nodeId },
    });
    const nodeData = res.data.nodes[nodeId];
    if (!nodeData) throw new Error(`Node ${nodeId} not found in file`);
    return [nodeData.document];
  } else {
    const res = await axios.get(`${FIGMA_BASE}/files/${fileKey}`, {
      headers: { "X-Figma-Token": token },
    });
    return [res.data.document];
  }
}

const ICON_SIZES = new Set([12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64]);

/**
 * Figma icon naming patterns — covers common design system conventions:
 * - kebab-case with numbers: shopping-cart-03, wallet-03, arrow-left-01
 * - with prefixes: ic_home, icon-close
 * - plain names: eye, home, search
 * Excludes clearly non-icon names: "Featured icon", "Metric item", "Frame 123", "Solid", "Bold"
 */
const ICON_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/; // pure kebab-case: wallet-03, shopping-cart-03
const EXCLUDE_NAMES = new Set([
  "solid", "bold", "regular", "light", "thin", "duotone", "outline",
  "featured icon", "featured-icon", "icon wrapper", "container",
]);

function isSquareIconSize(node: FigmaNode): boolean {
  const bbox = node.absoluteBoundingBox;
  if (!bbox) return false;
  const { width, height } = bbox;
  return Math.abs(width - height) <= 1 && ICON_SIZES.has(Math.round(width));
}

function isIconName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  // Exclude known non-icon names
  if (EXCLUDE_NAMES.has(lower)) return false;
  // Exclude generic frame/layer names
  if (/^frame\s*\d+$/i.test(lower)) return false;
  if (/^group\s*\d+$/i.test(lower)) return false;
  if (/^layer\s*\d+$/i.test(lower)) return false;
  if (/^rectangle\s*\d*$/i.test(lower)) return false;
  if (/^ellipse\s*\d*$/i.test(lower)) return false;
  // Match kebab-case icon names like: wallet-03, shopping-cart-03, arrow-left, eye
  return ICON_NAME_PATTERN.test(lower);
}

/**
 * Collect icon nodes by walking the full tree.
 * Strategy:
 * 1. INSTANCE or COMPONENT that is icon-sized AND has an icon-like kebab name → it's an icon
 * 2. VECTOR / BOOLEAN_OPERATION that is icon-sized → it's a raw icon shape
 * 3. Deduplicate by name so the same icon used multiple times only produces one file
 */
export function collectIconNodes(nodes: FigmaNode[]): FigmaNode[] {
  const icons: FigmaNode[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>(); // deduplicate by name (same icon used multiple times)

  function walk(node: FigmaNode) {
    if (seenIds.has(node.id)) return;

    const type = node.type;
    const squareIcon = isSquareIconSize(node);

    if (
      (type === "INSTANCE" || type === "COMPONENT") &&
      squareIcon &&
      isIconName(node.name)
    ) {
      seenIds.add(node.id);
      // Deduplicate: if same-named icon already collected, skip
      const normalizedName = node.name.toLowerCase().trim();
      if (!seenNames.has(normalizedName)) {
        seenNames.add(normalizedName);
        icons.push(node);
      }
      return; // don't go deeper into this icon's internals
    }

    if (
      (type === "VECTOR" || type === "BOOLEAN_OPERATION") &&
      squareIcon
    ) {
      seenIds.add(node.id);
      const normalizedName = node.name.toLowerCase().trim();
      if (!seenNames.has(normalizedName)) {
        seenNames.add(normalizedName);
        icons.push(node);
      }
      return;
    }

    // Continue walking into wrapper/layout nodes
    if (node.children) {
      node.children.forEach(walk);
    }
  }

  nodes.forEach(walk);
  return icons;
}

/** Export SVGs for a list of node IDs, batched in 100s */
export async function exportSVGs(
  token: string,
  fileKey: string,
  nodeIds: string[]
): Promise<Record<string, string>> {
  const chunks: string[][] = [];
  for (let i = 0; i < nodeIds.length; i += 100) {
    chunks.push(nodeIds.slice(i, i + 100));
  }

  const svgMap: Record<string, string> = {};

  for (const chunk of chunks) {
    const res = await axios.get(`${FIGMA_BASE}/images/${fileKey}`, {
      headers: { "X-Figma-Token": token },
      params: {
        ids: chunk.join(","),
        format: "svg",
        svg_include_id: false,
        svg_simplify_stroke: true,
      },
    });

    const imageUrls: Record<string, string> = res.data.images;

    await Promise.all(
      Object.entries(imageUrls).map(async ([id, url]) => {
        if (!url) return;
        const svgRes = await axios.get(url, { responseType: "text" });
        svgMap[id] = svgRes.data as string;
      })
    );
  }

  return svgMap;
}