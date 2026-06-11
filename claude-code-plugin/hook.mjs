#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// claude-code-plugin/renderers/svg-mindmap.ts
var svg_mindmap_exports = {};
__export(svg_mindmap_exports, {
  generateMindMapSvg: () => generateMindMapSvg,
  stripHtml: () => stripHtml
});
import { Transformer } from "markmap-lib";
function generateMindMapSvg(markdown, options) {
  const width = options?.width ?? 1200;
  const height = options?.height ?? 800;
  const { root } = transformer.transform(markdown || "# (empty)");
  const hSpacing = 200;
  const vSpacing = 40;
  const { layoutNode } = layoutTree(root, 60, height / 2, hSpacing, vSpacing);
  return buildSvgFromTree(layoutNode, width, height);
}
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, "").trim();
}
function layoutTree(node, x, y, hSpacing, vSpacing) {
  const label = stripHtml(node.content);
  if (!node.children || node.children.length === 0) {
    return {
      layoutNode: { label, x, y, children: [] },
      totalHeight: vSpacing
    };
  }
  const childX = x + hSpacing;
  const childLayouts = [];
  for (const child of node.children) {
    childLayouts.push(
      layoutTree(child, childX, 0, hSpacing, vSpacing)
    );
  }
  const totalChildHeight = childLayouts.reduce((sum, cl) => sum + cl.totalHeight, 0);
  let cursor = y - totalChildHeight / 2;
  const positionedChildren = [];
  for (const cl of childLayouts) {
    const childCenterY = cursor + cl.totalHeight / 2;
    const positioned = shiftY(cl.layoutNode, childCenterY - cl.layoutNode.y);
    positionedChildren.push(positioned);
    cursor += cl.totalHeight;
  }
  return {
    layoutNode: { label, x, y, children: positionedChildren },
    totalHeight: Math.max(totalChildHeight, vSpacing)
  };
}
function shiftY(node, dy) {
  return {
    ...node,
    y: node.y + dy,
    children: node.children.map((c) => shiftY(c, dy))
  };
}
function collectElements(node, nodes, edges) {
  nodes.push(node);
  for (const child of node.children) {
    edges.push({ x1: node.x, y1: node.y, x2: child.x, y2: child.y });
    collectElements(child, nodes, edges);
  }
}
function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildSvgFromTree(root, width, height) {
  const nodes = [];
  const edges = [];
  collectElements(root, nodes, edges);
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
  lines.push(`  <rect width="${width}" height="${height}" fill="#1e1e1e"/>`);
  for (const e of edges) {
    lines.push(
      `  <line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="#666" stroke-width="1.5"/>`
    );
  }
  for (const n of nodes) {
    const label = escapeXml(n.label);
    lines.push(
      `  <text x="${n.x}" y="${n.y}" font-family="sans-serif" font-size="14" fill="#e0e0e0" dominant-baseline="middle">${label}</text>`
    );
  }
  lines.push("</svg>");
  return lines.join("\n");
}
var transformer;
var init_svg_mindmap = __esm({
  "claude-code-plugin/renderers/svg-mindmap.ts"() {
    "use strict";
    transformer = new Transformer();
  }
});

// claude-code-plugin/caps.ts
var HYPERLINK_ALLOWLIST = /* @__PURE__ */ new Set([
  "iTerm.app",
  "WezTerm",
  "vscode",
  "Hyper",
  "Tabby",
  "Alacritty",
  "kitty",
  "Ghostty"
]);
var ITERM_PROTOCOL_PROGRAMS = /* @__PURE__ */ new Set(["iTerm.app", "WezTerm", "mintty"]);
function parseOverride(raw) {
  const flags = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  let imageProtocol = "none";
  if (flags.has("kitty")) imageProtocol = "kitty";
  else if (flags.has("iterm")) imageProtocol = "iterm";
  else if (flags.has("sixel")) imageProtocol = "sixel";
  return {
    imageProtocol,
    truecolor: flags.has("truecolor"),
    color256: flags.has("color256") || flags.has("truecolor"),
    unicode: flags.has("unicode"),
    mouse: flags.has("mouse"),
    hyperlinks: flags.has("hyperlinks")
  };
}
function detectTerminalCaps() {
  const override = process.env.MD_READER_TERM_CAPS;
  if (override) {
    return parseOverride(override);
  }
  const term = process.env.TERM ?? "";
  const termProgram = process.env.TERM_PROGRAM ?? "";
  const colorterm = process.env.COLORTERM ?? "";
  if (term === "dumb") {
    return {
      imageProtocol: "none",
      truecolor: false,
      color256: false,
      unicode: false,
      mouse: false,
      hyperlinks: false
    };
  }
  let imageProtocol = "none";
  if (term === "xterm-kitty" || termProgram === "kitty") {
    imageProtocol = "kitty";
  } else if (ITERM_PROTOCOL_PROGRAMS.has(termProgram)) {
    imageProtocol = "iterm";
  }
  const truecolor = colorterm === "truecolor" || colorterm === "24bit";
  const color256 = truecolor || term.includes("256color");
  const unicode = true;
  const mouse = /xterm|screen|tmux|kitty/.test(term) || termProgram !== "";
  const hyperlinks = HYPERLINK_ALLOWLIST.has(termProgram) || term === "xterm-kitty";
  return { imageProtocol, truecolor, color256, unicode, mouse, hyperlinks };
}
var _cache = null;
function getCachedCaps() {
  if (_cache === null) {
    _cache = detectTerminalCaps();
  }
  return _cache;
}

// claude-code-plugin/renderers/ascii-tree.ts
function renderAsciiTree(tree, opts) {
  const lines = [];
  const rootName = opts.color ? `\x1B[1m${tree.name}\x1B[0m` : tree.name;
  lines.push(rootName);
  renderChildren(tree.children, "", 1, opts, lines);
  return lines.join("\n");
}
var DEPTH_COLORS = [
  "\x1B[1;36m",
  // bold cyan
  "\x1B[1;33m",
  // bold yellow
  "\x1B[1;32m",
  // bold green
  "\x1B[1;35m",
  // bold magenta
  "\x1B[1;34m",
  // bold blue
  "\x1B[1;31m"
  // bold red
];
var RESET = "\x1B[0m";
var DIM = "\x1B[2m";
function colorForDepth(depth) {
  return DEPTH_COLORS[(depth - 1) % DEPTH_COLORS.length];
}
function countDescendants(node) {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}
function renderChildren(children, prefix, depth, opts, lines) {
  const atLimit = opts.maxDepth !== void 0 && depth >= opts.maxDepth;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    const isLast = i === children.length - 1;
    const connector = isLast ? "\u2514\u2500" : "\u251C\u2500";
    if (atLimit) {
      const total = countDescendants(node);
      const suffix = ` (+${total} more)`;
      const truncLine = opts.color ? `${prefix}${DIM}${connector} ${node.name}${suffix}${RESET}` : `${prefix}${connector} ${node.name}${suffix}`;
      lines.push(truncLine);
    } else {
      const colorCode = opts.color ? colorForDepth(depth) : "";
      const colorReset = opts.color ? RESET : "";
      lines.push(`${prefix}${connector} ${colorCode}${node.name}${colorReset}`);
      const childPrefix = prefix + (isLast ? "   " : "\u2502  ");
      renderChildren(node.children, childPrefix, depth + 1, opts, lines);
    }
  }
}

// claude-code-plugin/renderers/inline-image.ts
var KITTY_CHUNK_SIZE = 4096;
function encodeInlineImage(pngBuffer, protocol) {
  switch (protocol) {
    case "none":
      return "";
    case "iterm": {
      const base64 = pngBuffer.toString("base64");
      return `\x1B]1337;File=inline=1;size=${pngBuffer.length};width=auto;height=auto;preserveAspectRatio=1:${base64}\x07`;
    }
    case "kitty": {
      const base64 = pngBuffer.toString("base64");
      if (base64.length <= KITTY_CHUNK_SIZE) {
        return `\x1B_Ga=T,f=100,t=d;${base64}\x1B\\`;
      }
      const chunks = [];
      for (let i = 0; i < base64.length; i += KITTY_CHUNK_SIZE) {
        chunks.push(base64.slice(i, i + KITTY_CHUNK_SIZE));
      }
      const parts = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (i === 0) {
          parts.push(`\x1B_Ga=T,f=100,t=d,m=1;${chunk}\x1B\\`);
        } else if (i === chunks.length - 1) {
          parts.push(`\x1B_Gm=0;${chunk}\x1B\\`);
        } else {
          parts.push(`\x1B_Gm=1;${chunk}\x1B\\`);
        }
      }
      return parts.join("");
    }
    case "sixel":
      return "[Sixel rendering not yet implemented \u2014 use MD_READER_TERM_CAPS=iterm or view in browser]";
  }
}

// claude-code-plugin/bridge.ts
function rebuildMarkdownFromTree(node, depth = 0) {
  const lines = [];
  if (depth > 0) {
    lines.push(`${"#".repeat(Math.min(depth, 6))} ${node.name}`);
    lines.push("");
  }
  for (const child of node.children) {
    lines.push(rebuildMarkdownFromTree(child, depth + 1));
  }
  return lines.join("\n");
}
async function renderMindMapResult(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return jsonText;
  }
  if (data.type !== "mind_map" || !data.tree) {
    return jsonText;
  }
  const tree = data.tree;
  const totalNodes = typeof data.total_nodes === "number" ? data.total_nodes : 0;
  const maxDepth = typeof data.max_depth === "number" ? data.max_depth : 0;
  const browserUrl = typeof data.browser_url === "string" ? data.browser_url : "";
  const section = typeof data.section === "string" ? data.section : null;
  const caps = getCachedCaps();
  let headerText = `\x1B[1mMind Map\x1B[0m \u2014 ${totalNodes} nodes, ${maxDepth} levels deep`;
  if (section) {
    headerText += ` (section: ${section})`;
  }
  const lines = [];
  lines.push(headerText);
  lines.push("");
  let treeRendered = false;
  if (caps.imageProtocol !== "none") {
    try {
      const { generateMindMapSvg: generateMindMapSvg2 } = await Promise.resolve().then(() => (init_svg_mindmap(), svg_mindmap_exports));
      const markdown = rebuildMarkdownFromTree(tree);
      const svg = generateMindMapSvg2(markdown);
      const sharp = (await import("sharp")).default;
      const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
      const encoded = encodeInlineImage(pngBuffer, caps.imageProtocol);
      lines.push(encoded);
      treeRendered = true;
    } catch {
    }
  }
  if (!treeRendered) {
    const asciiTree = renderAsciiTree(tree, {
      color: caps.truecolor || caps.color256,
      maxDepth: 4
    });
    lines.push(asciiTree);
  }
  lines.push("");
  if (caps.hyperlinks) {
    lines.push(`\x1B]8;;${browserUrl}\x07Open in browser \u2192\x1B]8;;\x07`);
  } else {
    lines.push(`Open in browser \u2192 ${browserUrl}`);
  }
  return lines.join("\n");
}

// claude-code-plugin/hook.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
async function main() {
  const raw = await readStdin();
  let toolOutput;
  let original;
  try {
    const payload = JSON.parse(raw);
    toolOutput = payload.tool_output ?? {};
    original = toolOutput.content?.[0]?.text ?? "";
  } catch {
    process.exit(0);
  }
  let rendered;
  try {
    rendered = await renderMindMapResult(original);
  } catch {
    rendered = original;
  }
  const content = Array.isArray(toolOutput.content) ? toolOutput.content.map((b, i) => i === 0 ? { ...b, text: rendered } : b) : [{ type: "text", text: rendered }];
  const updatedToolOutput = { ...toolOutput, content };
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput
      }
    })
  );
  process.exit(0);
}
void main();
