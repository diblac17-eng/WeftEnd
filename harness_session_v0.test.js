// test/harness/harness_session_v0.test.js
const fs = require("fs");
const path = require("path");

const fixturePath = path.join(__dirname, "test", "harness", "fixtures", "harness_session_demo.json");

(async () => {
  const mod = await import("./harness_session_v0.mjs");
  const raw = fs.readFileSync(fixturePath, "utf8");
  const parsed = JSON.parse(raw);

  const canon = mod.canonicalizeHarnessSessionV0(parsed);
  if (canon.trim() !== raw.trim()) {
    throw new Error("Fixture is not canonical JSON.");
  }

  const core = mod.buildHarnessSessionCoreV0(parsed.input, parsed.outputs);
  const digest = mod.digestHarnessSessionV0(core);
  if (!parsed.digests || parsed.digests.sessionDigest !== digest) {
    throw new Error(`Session digest mismatch. Expected ${parsed.digests && parsed.digests.sessionDigest}, got ${digest}`);
  }

  const validation = mod.validateHarnessSessionV0(parsed);
  if (!validation.ok) {
    throw new Error(`Session validation failed: ${JSON.stringify(validation.issues || [])}`);
  }

  console.log("harness_session_v0.test: PASS");
})().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
