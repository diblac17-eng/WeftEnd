// scripts/commit_truth_gate.js
// Deterministic reusable-commit gate: no skip flags, fail closed on any gate failure.

const { spawnSync } = require("child_process");

const npmCli = process.env.npm_execpath || "";
if (!npmCli) {
  console.error("Missing npm_execpath; cannot run commit truth gate.");
  process.exit(1);
}

const run = (args, label) => {
  console.log(`[truth-gate] ${label}`);
  const res = spawnSync(process.execPath, [npmCli, ...args], {
    stdio: "inherit",
    env: { ...process.env },
  });
  if (typeof res.status === "number" && res.status !== 0) process.exit(res.status);
  if (res.error) {
    console.error(`[truth-gate] ${label} failed: ${String(res.error.message || res.error)}`);
    process.exit(1);
  }
};

run(["test"], "npm test");
run(["run", "verify:360:release:managed"], "npm run verify:360:release:managed");
run(["run", "proofcheck:release"], "npm run proofcheck:release");

console.log("[truth-gate] PASS");
