// test/harness/import_snapshot_v0.mjs
// ImportSnapshotV0 helpers (harness-only, deterministic, bounded).

const SNAPSHOT_KIND = "weftend.import.snapshot.v0";
const MAX_HTML_BYTES = 256 * 1024;
const MAX_BLOCKS = 256;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_NOTES_BYTES = 512;
const MAX_BLOCK_ID_BYTES = 128;
const MAX_NODE_PATH_BYTES = 128;
const MAX_NAME_BYTES = 256;

const fnv1a32 = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const canonicalJSON = (obj) => {
  const seen = new WeakSet();
  const normalize = (v) => {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (Array.isArray(v)) return v.map(normalize);
    if (t === "object") {
      if (seen.has(v)) throw new Error("CYCLE_IN_CANONICAL_JSON");
      seen.add(v);
      const out = {};
      Object.keys(v)
        .sort()
        .forEach((k) => {
          out[k] = normalize(v[k]);
        });
      return out;
    }
    return null;
  };
  return JSON.stringify(normalize(obj));
};

const utf8ByteLen = (value) => {
  if (value === null || value === undefined) return 0;
  const text = String(value);
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return Buffer.from(text, "utf8").length;
};

const truncateUtf8 = (value, maxBytes) => {
  const text = String(value ?? "");
  if (utf8ByteLen(text) <= maxBytes) return text;
  if (typeof TextEncoder === "undefined" || typeof TextDecoder === "undefined") {
    return Buffer.from(text, "utf8").slice(0, maxBytes).toString("utf8");
  }
  const enc = new TextEncoder().encode(text);
  const sliced = enc.slice(0, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(sliced);
};

const digestString = (value) => `fnv1a32:${fnv1a32(String(value))}`;

const normalizeHtml = (html) => {
  if (typeof html !== "string") return "";
  return html.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
};

const issue = (path, code, message) => ({ path, code, message });

const sortIssues = (issues) =>
  [...issues].sort((a, b) => {
    const p = (a.path || "").localeCompare(b.path || "");
    if (p !== 0) return p;
    const c = a.code.localeCompare(b.code);
    if (c !== 0) return c;
    return a.message.localeCompare(b.message);
  });

const normalizeAssets = (assets, issues) => {
  const out = [];
  const list = Array.isArray(assets) ? assets : [];
  list.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      issues.push(issue(`/assets/${idx}`, "IMPORT_ASSET_INVALID", "asset must be an object."));
      return;
    }
    const path = typeof item.path === "string" ? item.path.trim() : "";
    if (!path) {
      issues.push(issue(`/assets/${idx}/path`, "IMPORT_ASSET_PATH_INVALID", "asset path must be a string."));
    }
    const kind =
      item.kind === "css" || item.kind === "js" || item.kind === "img" || item.kind === "other"
        ? item.kind
        : "other";
    const digest = typeof item.digest === "string" ? item.digest : digestString("");
    const byteLen = typeof item.byteLen === "number" && Number.isFinite(item.byteLen) ? item.byteLen : 0;
    out.push({ path, kind, digest, byteLen });
  });
  out.sort((a, b) => {
    const p = a.path.localeCompare(b.path);
    if (p !== 0) return p;
    return a.digest.localeCompare(b.digest);
  });
  return out;
};

const computeBlockDigestV0 = (block) =>
  digestString(
    canonicalJSON({
      blockId: block.blockId,
      nodePath: block.nodePath,
      rootTag: block.rootTag,
      name: block.name,
      status: block.status,
      contentRef: block.contentRef,
    })
  );

const normalizeBlocks = (blocks, issues) => {
  const out = [];
  const list = Array.isArray(blocks) ? blocks : [];
  list.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      issues.push(issue(`/blocks/${idx}`, "IMPORT_BLOCK_INVALID", "block must be an object."));
      return;
    }
    const blockId = typeof item.blockId === "string" ? item.blockId.trim() : "";
    if (!blockId) {
      issues.push(issue(`/blocks/${idx}/blockId`, "IMPORT_BLOCK_ID_INVALID", "blockId must be a string."));
    } else if (utf8ByteLen(blockId) > MAX_BLOCK_ID_BYTES) {
      issues.push(issue(`/blocks/${idx}/blockId`, "IMPORT_BLOCK_ID_TOO_LONG", "blockId is too long."));
    }
    const nodePath = typeof item.nodePath === "string" ? item.nodePath.trim() : "";
    if (!nodePath) {
      issues.push(issue(`/blocks/${idx}/nodePath`, "IMPORT_BLOCK_NODEPATH_INVALID", "nodePath must be a string."));
    } else if (utf8ByteLen(nodePath) > MAX_NODE_PATH_BYTES) {
      issues.push(
        issue(`/blocks/${idx}/nodePath`, "IMPORT_BLOCK_NODEPATH_TOO_LONG", "nodePath is too long.")
      );
    }
    const rootTag = typeof item.rootTag === "string" ? item.rootTag.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (utf8ByteLen(name) > MAX_NAME_BYTES) {
      issues.push(issue(`/blocks/${idx}/name`, "IMPORT_BLOCK_NAME_TOO_LONG", "name is too long."));
    }
    const status =
      item.status === "sealed" || item.status === "warn" || item.status === "missing"
        ? item.status
        : "sealed";
    const contentRef =
      item.contentRef && typeof item.contentRef === "object"
        ? item.contentRef
        : { kind: "nodePath", value: nodePath };
    const block = {
      blockId,
      blockDigest: computeBlockDigestV0({
        blockId,
        nodePath,
        rootTag,
        name,
        status,
        contentRef,
      }),
      nodePath,
      rootTag,
      name,
      status,
      contentRef,
    };
    out.push(block);
  });
  out.sort((a, b) => {
    const p = a.nodePath.localeCompare(b.nodePath);
    if (p !== 0) return p;
    return a.blockId.localeCompare(b.blockId);
  });
  if (out.length > MAX_BLOCKS) {
    issues.push(issue("/blocks", "IMPORT_BLOCKS_EXCEEDED", `blocks must not exceed ${MAX_BLOCKS}.`));
    out.length = MAX_BLOCKS;
  }
  return out;
};

const normalizeDesign = (design, fallbackPageId, issues) => {
  const base = design && typeof design === "object" ? design : {};
  const pageId = typeof base.pageId === "string" && base.pageId.trim().length > 0 ? base.pageId : fallbackPageId;
  if (!pageId) {
    issues.push(issue("/design/pageId", "IMPORT_DESIGN_PAGE_ID_INVALID", "pageId is required."));
  }
  const title = typeof base.title === "string" ? base.title.trim() : undefined;
  const partTitle = typeof base.partTitle === "string" ? base.partTitle.trim() : undefined;
  return {
    schema: "retni.design/1",
    pageId: pageId || "page:/import",
    ...(title ? { title } : {}),
    ...(partTitle ? { partTitle } : {}),
  };
};

const normalizeImportSnapshotV0 = (snapshot) => {
  const issues = [];
  const base = snapshot && typeof snapshot === "object" ? snapshot : {};

  const inputHtml = normalizeHtml(base.inputHtml);
  if (!inputHtml) {
    issues.push(issue("/inputHtml", "IMPORT_HTML_EMPTY", "inputHtml must be a non-empty string."));
  }
  if (utf8ByteLen(inputHtml) > MAX_HTML_BYTES) {
    issues.push(
      issue("/inputHtml", "IMPORT_HTML_TOO_LARGE", `inputHtml must not exceed ${MAX_HTML_BYTES} bytes.`)
    );
  }

  const notes = typeof base.notes === "string" ? base.notes : undefined;
  if (notes && utf8ByteLen(notes) > MAX_NOTES_BYTES) {
    issues.push(issue("/notes", "IMPORT_NOTES_TOO_LONG", `notes must not exceed ${MAX_NOTES_BYTES} bytes.`));
  }

  const design = normalizeDesign(base.design, "page:/import", issues);
  const assets = normalizeAssets(base.assets, issues);
  const blocks = normalizeBlocks(base.blocks, issues);
  const blockOrder = blocks.map((block) => block.blockId);

  const input = {
    htmlDigest: digestString(inputHtml),
    assetsDigest: digestString(canonicalJSON(assets)),
  };

  const canonical = {
    kind: SNAPSHOT_KIND,
    inputHtml,
    input,
    design,
    assets,
    blocks,
    blockOrder,
    ...(notes ? { notes: truncateUtf8(notes, MAX_NOTES_BYTES) } : {}),
  };

  const snapshotBytes = utf8ByteLen(canonicalJSON(canonical));
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    issues.push(
      issue("/", "IMPORT_SNAPSHOT_TOO_LARGE", `snapshot must not exceed ${MAX_SNAPSHOT_BYTES} bytes.`)
    );
  }

  return { snapshot: canonical, issues: sortIssues(issues) };
};

const canonicalizeImportSnapshotV0 = (snapshot) => normalizeImportSnapshotV0(snapshot).snapshot;

const digestImportSnapshotV0 = (snapshot) =>
  digestString(canonicalJSON(canonicalizeImportSnapshotV0(snapshot)));

const validateImportSnapshotV0 = (snapshot) => {
  const res = normalizeImportSnapshotV0(snapshot);
  return { ok: res.issues.length === 0, issues: res.issues };
};

export {
  SNAPSHOT_KIND,
  MAX_HTML_BYTES,
  MAX_BLOCKS,
  MAX_SNAPSHOT_BYTES,
  MAX_NOTES_BYTES,
  canonicalJSON,
  utf8ByteLen,
  truncateUtf8,
  canonicalizeImportSnapshotV0,
  digestImportSnapshotV0,
  validateImportSnapshotV0,
  computeBlockDigestV0,
};
