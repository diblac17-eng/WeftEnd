const fs = require("fs");
const path = require("path");

function fail(msg) {
  throw new Error(msg);
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBodySummary(html, page) {
  const match = html.match(/<body[^>]*data-weftend-summary="([^"]+)"[^>]*>/i);
  if (!match) {
    fail(`ui_gatepack: ${page} missing data-weftend-summary on <body>`);
  }
  return match[1];
}

function extractActions(html) {
  const actions = [];
  const re = /<[^>]*\sdata-weftend-action="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const tag = match[0];
    const action = match[1];
    const targetMatch = tag.match(/data-weftend-target="([^"]+)"/i);
    const target = targetMatch ? targetMatch[1] : "";
    actions.push({ action, target, tag });
  }
  return actions;
}

function findTargetTag(html, selector) {
  const id = selector.replace(/^#/, "");
  const re = new RegExp(`<[^>]*\\sid="${escapeRegExp(id)}"[^>]*>`, "i");
  const match = html.match(re);
  return match ? match[0] : "";
}

function extractAttr(tag, name) {
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  const match = tag.match(re);
  return match ? match[1] : "";
}

const pages = [
  { key: "portal.html", path: "portal.html" },
  { key: "portal_lab.html", path: "portal_lab.html" },
  { key: "clinic_v1.html", path: path.join("test", "harness", "clinic_v1.html") },
  { key: "import_studio_v1.html", path: "import_studio_v1.html" },
];

const expectedPath = path.join("test", "harness", "fixtures", "ui_gatepack", "expected_summaries.json");
if (!fs.existsSync(expectedPath)) {
  fail(`ui_gatepack: missing expected summaries ${expectedPath}`);
}
const expected = JSON.parse(readText(expectedPath));

for (const page of pages) {
  if (!fs.existsSync(page.path)) {
    fail(`ui_gatepack: missing page ${page.path}`);
  }
  const html = readText(page.path);
  if (html.includes("console.error")) {
    fail(`ui_gatepack: ${page.key} contains console.error`);
  }

  const summary = extractBodySummary(html, page.key);
  const expectedSummary = expected[page.key];
  if (!expectedSummary) {
    fail(`ui_gatepack: missing expected summary for ${page.key}`);
  }
  if (summary !== expectedSummary) {
    fail(`ui_gatepack: ${page.key} summary mismatch\nExpected: ${expectedSummary}\nActual: ${summary}`);
  }

  const actions = extractActions(html);
  actions.forEach((action) => {
    if (!action.target) {
      fail(`ui_gatepack: ${page.key} action ${action.action} missing data-weftend-target`);
    }
    const targetTag = findTargetTag(html, action.target);
    if (!targetTag) {
      fail(`ui_gatepack: ${page.key} action ${action.action} target missing: ${action.target}`);
    }
    const before = extractAttr(targetTag, "data-weftend-before");
    const after = extractAttr(targetTag, "data-weftend-after");
    if (!before || !after) {
      fail(
        `ui_gatepack: ${page.key} action ${action.action} target ${action.target} missing before/after`
      );
    }
    if (before === after) {
      fail(
        `ui_gatepack: ${page.key} action ${action.action} target ${action.target} no change (before=after)`
      );
    }
  });
}

console.log("ui_gatepack: PASS");
