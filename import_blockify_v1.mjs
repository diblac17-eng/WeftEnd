// test/harness/import_blockify_v1.mjs
// Harness-only blockify (A1->A2) mirror, JS-only for Node tests.

import crypto from "crypto";

const boundaryTags = new Set(["section", "article", "nav", "main", "header", "footer", "aside"]);
const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const MAX_BLOCK_NODES = 200;
const MIN_BLOCK_NODES = 1;

const issue = (code, message, path) => ({ code, message, path });

const sortIssues = (issues) =>
  [...issues].sort((a, b) => {
    const c = a.code.localeCompare(b.code);
    if (c !== 0) return c;
    const p = (a.path || "").localeCompare(b.path || "");
    if (p !== 0) return p;
    return a.message.localeCompare(b.message);
  });

const sortBuildErrors = (errs) =>
  [...errs].sort((a, b) => {
    const c = a.code.localeCompare(b.code);
    if (c !== 0) return c;
    const p = (a.path ?? "").localeCompare(b.path ?? "");
    if (p !== 0) return p;
    return a.message.localeCompare(b.message);
  });

const sha256 = (input) => crypto.createHash("sha256").update(String(input ?? ""), "utf8").digest("hex");

const normalizeWhitespace = (value) => value.replace(/\s+/g, " ").trim();

const sortClassTokens = (value) =>
  value
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .join(" ");

const stableAttrString = (attrs) => {
  const parts = [];
  for (const key of Object.keys(attrs).sort()) {
    const raw = attrs[key];
    const v = key === "class" ? sortClassTokens(raw) : raw.trim();
    parts.push(`${key}=${v}`);
  }
  return parts.join(";");
};

const firstStableAttrHint = (attrs) => {
  if (attrs["id"]) return `id=${attrs["id"].trim()}`;
  if (attrs["data-block"]) return `data-block=${attrs["data-block"].trim()}`;
  if (attrs["aria-label"]) return `aria-label=${attrs["aria-label"].trim()}`;
  if (attrs["role"]) return `role=${attrs["role"].trim()}`;
  if (attrs["class"]) return `class=${sortClassTokens(attrs["class"])}`;
  return "";
};

const isBoundary = (node) => {
  if (boundaryTags.has(node.tag)) return true;
  return (
    "data-block" in node.attrs ||
    "data-region" in node.attrs ||
    "data-weftend-boundary" in node.attrs
  );
};

const parseAttributes = (raw) => {
  const attrs = {};
  const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match = null;
  while ((match = attrPattern.exec(raw))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = value;
  }
  return attrs;
};

const parseHtml = (html) => {
  const root = { tag: "root", attrs: {}, children: [], textParts: [] };
  const stack = [root];
  let i = 0;
  const lower = html.toLowerCase();

  while (i < html.length) {
    const ch = html[i];
    if (ch !== "<") {
      const next = html.indexOf("<", i);
      const end = next === -1 ? html.length : next;
      const text = html.slice(i, end);
      if (text.trim().length > 0) {
        stack[stack.length - 1].textParts.push(text);
      }
      i = end;
      continue;
    }

    if (lower.startsWith("<!--", i)) {
      const end = lower.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }

    if (lower.startsWith("<!doctype", i) || lower.startsWith("<!", i)) {
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    if (lower.startsWith("</", i)) {
      const end = html.indexOf(">", i + 2);
      const tag = lower.slice(i + 2, end === -1 ? html.length : end).trim().split(/\s+/)[0];
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s].tag === tag) {
          stack.length = s;
          break;
        }
      }
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const end = html.indexOf(">", i + 1);
    if (end === -1) break;
    const rawTag = html.slice(i + 1, end);
    const selfClosing = rawTag.endsWith("/");
    const parts = rawTag.trim().replace(/\/$/, "").split(/\s+/, 2);
    const tag = parts[0].toLowerCase();
    const attrs = parseAttributes(rawTag.slice(parts[0].length));

    const node = {
      tag,
      attrs,
      children: [],
      textParts: [],
      parent: stack[stack.length - 1],
    };
    stack[stack.length - 1].children.push(node);

    if (tag === "script" || tag === "style") {
      const closeTag = `</${tag}>`;
      const closeIdx = lower.indexOf(closeTag, end + 1);
      const content = closeIdx === -1 ? html.slice(end + 1) : html.slice(end + 1, closeIdx);
      if (content.trim().length > 0) node.textParts.push(content);
      i = closeIdx === -1 ? html.length : closeIdx + closeTag.length;
      continue;
    }

    if (!selfClosing && !voidTags.has(tag)) {
      stack.push(node);
    }
    i = end + 1;
  }

  return root;
};

const assignPaths = (node, prefix) => {
  let idx = 0;
  for (const child of node.children) {
    idx += 1;
    child.path = `${prefix}/${idx}`;
    assignPaths(child, child.path);
  }
};

const countElements = (node) => {
  let count = 1;
  for (const child of node.children) count += countElements(child);
  return count;
};

const collectText = (node) => {
  let out = node.textParts.join(" ");
  for (const child of node.children) {
    out = `${out} ${collectText(child)}`.trim();
  }
  return out.trim();
};

const collectHeadingText = (node) => {
  const isHeading = /^h[1-6]$/.test(node.tag);
  if (isHeading) {
    const text = normalizeWhitespace(collectText(node));
    if (text.length > 0) return text;
  }
  for (const child of node.children) {
    const hit = collectHeadingText(child);
    if (hit) return hit;
  }
  return null;
};

const computeBlockName = (node, fallbackIndex) => {
  if (node.attrs["data-block"]) return node.attrs["data-block"].trim();
  if (node.attrs["id"]) return node.attrs["id"].trim();
  if (node.attrs["aria-label"]) return node.attrs["aria-label"].trim();
  if (node.attrs["role"]) return node.attrs["role"].trim();
  const heading = collectHeadingText(node);
  if (heading) return heading;
  return `section-${fallbackIndex}`;
};

const detectRepetitionBoundaries = (root, boundarySet) => {
  const walk = (node) => {
    if (node.children.length >= 3) {
      const groups = new Map();
      for (const child of node.children) {
        const key = `${child.tag}|${stableAttrString(child.attrs)}`;
        const list = groups.get(key) ?? [];
        list.push(child);
        groups.set(key, list);
      }
      for (const list of groups.values()) {
        if (list.length >= 3) list.forEach((n) => boundarySet.add(n));
      }
    }
    node.children.forEach(walk);
  };
  walk(root);
};

const collectBoundaryNodes = (root) => {
  const boundarySet = new Set();
  const mark = (node) => {
    if (isBoundary(node)) boundarySet.add(node);
    node.children.forEach(mark);
  };
  mark(root);
  detectRepetitionBoundaries(root, boundarySet);

  const hasBoundaryDescendant = (node) => {
    for (const child of node.children) {
      if (boundarySet.has(child)) return true;
      if (hasBoundaryDescendant(child)) return true;
    }
    return false;
  };

  const blocks = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (boundarySet.has(child)) {
        if (hasBoundaryDescendant(child)) {
          walk(child);
        } else {
          blocks.push(child);
        }
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return blocks;
};

const splitOversize = (node) => {
  if (countElements(node) <= MAX_BLOCK_NODES) return [node];
  const out = [];
  for (const child of node.children) {
    out.push(...splitOversize(child));
  }
  return out;
};

const mergeTiny = (blocks) => {
  if (MIN_BLOCK_NODES <= 1) return blocks;
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    const current = blocks[i];
    if (countElements(current) < MIN_BLOCK_NODES && i + 1 < blocks.length) {
      out.push(current);
      i += 2;
    } else {
      out.push(current);
      i += 1;
    }
  }
  return out;
};

const serializeNode = (node) => {
  const attrs = stableAttrString(node.attrs);
  const attrText = attrs.length > 0 ? " " + attrs.replace(/;/g, " ") : "";
  const text = node.textParts.map(normalizeWhitespace).filter((t) => t.length > 0).join(" ");
  const children = node.children.map(serializeNode).join("");
  if (node.tag === "root") return children;
  return `<${node.tag}${attrText}>${[text, children].filter((v) => v.length > 0).join("")}</${node.tag}>`;
};

const collectDeps = (node) => {
  const deps = [];
  const warnings = [];
  const errors = [];

  const scan = (n) => {
    if (n.tag === "link" && (n.attrs["rel"] ?? "").toLowerCase().includes("stylesheet")) {
      const href = n.attrs["href"] ?? "";
      if (href.trim().length > 0) {
        deps.push({ kind: "css", ref: href.trim() });
        errors.push({
          code: "BUILD_INVALID_DESIGN",
          message: "Missing external stylesheet input.",
        });
      }
    }
    if (n.tag === "script") {
      const src = n.attrs["src"] ?? "";
      if (src.trim().length > 0) {
        deps.push({ kind: "js", ref: src.trim() });
        errors.push({
          code: "BUILD_INVALID_DESIGN",
          message: "Missing external script input.",
        });
      } else {
        const content = collectText(n);
        if (/(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|indexedDB|caches|localStorage|sessionStorage)/.test(content)) {
          warnings.push({
            code: "BUILD_INVALID_DESIGN",
            message: "Network or storage attempt detected in inline script.",
          });
        }
      }
    }
    if (["img", "video", "audio", "source"].includes(n.tag)) {
      const src = n.attrs["src"] ?? "";
      if (src.trim().length > 0) {
        deps.push({ kind: "asset", ref: src.trim() });
        errors.push({
          code: "BUILD_INVALID_DESIGN",
          message: "Missing external asset input.",
        });
      }
    }

    n.children.forEach(scan);
  };
  scan(node);
  return { deps, warnings, errors };
};

const blockifyHtmlToPlan = (html, pageId) => {
  const root = parseHtml(html);
  assignPaths(root, "root");

  let blocks = collectBoundaryNodes(root);
  if (blocks.length === 0 && root.children.length > 0) {
    blocks = [root.children[0]];
  }

  const expanded = [];
  for (const block of blocks) expanded.push(...splitOversize(block));
  const finalBlocks = mergeTiny(expanded);

  const warnings = [];
  const errors = [];
  const planBlocks = [];

  finalBlocks.forEach((block, index) => {
    const nodePath = block.path ?? `root/${index + 1}`;
    const hint = firstStableAttrHint(block.attrs);
    const hashInput = `${pageId}\u0000${nodePath}\u0000${block.tag}\u0000${hint}`;
    const blockId = `sha256:${sha256(hashInput)}`;
    const name = computeBlockName(block, index + 1);

    const collected = collectDeps(block);
    collected.warnings.forEach((w, i) => warnings.push({ ...w, path: `plan.blocks[${index}].warn[${i}]` }));
    collected.errors.forEach((e, i) => errors.push({ ...e, path: `plan.blocks[${index}].err[${i}]` }));

    const status = collected.errors.length ? "missing" : collected.warnings.length ? "warn" : "sealed";

    planBlocks.push({
      blockId,
      nodePath,
      rootTag: block.tag,
      name,
      status,
      deps: collected.deps,
    });
  });

  const normalizedDom = serializeNode(root);

  return {
    schema: "retni.blockplan/1",
    pageId,
    normalizedDom,
    blocks: planBlocks,
    warnings: sortBuildErrors(warnings),
    errors: sortBuildErrors(errors),
  };
};

const runImportBlockifyV1 = (html, pageId) => {
  const errors = [];
  if (typeof html !== "string") {
    errors.push(issue("IMPORT_PARSE_ERROR", "html input must be a string.", "html"));
  } else if (html.trim().length === 0) {
    errors.push(issue("IMPORT_EMPTY", "html input is empty.", "html"));
  }
  if (!pageId) {
    errors.push(issue("IMPORT_INVALID_NODE_ID", "pageId is required.", "options.pageId"));
  }
  if (errors.length > 0) {
    return { ok: false, errors: sortIssues(errors) };
  }

  const plan = blockifyHtmlToPlan(html, pageId);
  return { ok: true, plan, warnings: plan.warnings || [], errors: plan.errors || [] };
};

export { blockifyHtmlToPlan, runImportBlockifyV1 };
