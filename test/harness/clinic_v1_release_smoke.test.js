// test/harness/clinic_v1_release_smoke.test.js
// Optional release-path smoke test for Clinic v1 (env-gated).

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const releaseDir = process.env.WEFTEND_RELEASE_DIR;
if (!releaseDir) {
  console.log("clinic_v1 release smoke: SKIP (WEFTEND_RELEASE_DIR not set)");
  process.exit(0);
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const hasForbiddenTimeKeys = (obj) => {
  const stack = [obj];
  const badKey = /(^time$|timestamp|date|duration)/i;
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const key of Object.keys(current)) {
      if (badKey.test(key)) return true;
      const value = current[key];
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return false;
};

const run = async () => {
  const inspectPath = path.resolve("dist", "src", "cli", "inspect.js");
  assert(fs.existsSync(inspectPath), "inspect.js missing: run npm run compile first");
  const inspect = require(inspectPath);
  assert(typeof inspect.inspectReleaseFolder === "function", "inspectReleaseFolder missing in inspect.js");

  const result = inspect.inspectReleaseFolder(releaseDir);
  assert(result && result.ok, "release inspection failed");
  const inspection = {
    ok: true,
    checks: result.value && Array.isArray(result.value.checks) ? result.value.checks : [],
  };

  const core = await import(pathToFileURL(path.resolve(__dirname, "clinic_v1_core.mjs")));
  const adapterMod = await import(pathToFileURL(path.resolve(__dirname, "adapter_v0.mjs")));

  const built = core.buildAdapterFromReleaseInspection(inspection);
  const adapter = built.adapter;
  assert(adapter && adapter.schema === "weftend.adapter/0", "adapter schema invalid");

  const validation = adapterMod.validateAdapterV0(adapter);
  assert(validation && validation.ok, "adapter validation failed");
  assert(!hasForbiddenTimeKeys(adapter), "adapter contains time-like keys");

  console.log("clinic_v1 release smoke: PASS");
};

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
