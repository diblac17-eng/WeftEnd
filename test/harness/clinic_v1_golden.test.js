// test/harness/clinic_v1_golden.test.js
// Golden test for Clinic v1 web adapter output (deterministic, harness-only).

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual, expected, msg) => {
  if (actual !== expected) {
    throw new Error(`${msg}\nExpected: ${expected}\nActual: ${actual}`);
  }
};

const run = async () => {
  const core = await import(pathToFileURL(path.resolve(__dirname, "clinic_v1_core.mjs")));
  const adapter = await import(pathToFileURL(path.resolve(__dirname, "adapter_v0.mjs")));

  const fixturePath = path.resolve(__dirname, "fixtures", "clinic_v1", "web_demo_input.html");
  const expectedPath = path.resolve(
    __dirname,
    "fixtures",
    "clinic_v1",
    "expected",
    "weftend_adapter_v0_web_demo.json"
  );

  const html = fs.readFileSync(fixturePath, "utf8");
  const result = core.buildAdapterFromWebHtml(html, {});
  assert(result && result.ok, "expected clinic web adapter to succeed");

  const actual = adapter.canonicalJSON(result.adapter);
  const expected = fs.readFileSync(expectedPath, "utf8").trim();

  assertEq(actual, expected, "clinic_v1 adapter JSON must match golden bytes");
  console.log("clinic_v1 golden: PASS");
};

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
