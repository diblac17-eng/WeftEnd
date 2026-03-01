// scripts/commit_truth_gate.js
// Deterministic reusable-commit gate: no skip flags, fail closed on any gate failure.

const { runNpm } = require("./guard_common");
const { buildTruthGateSteps } = require("./truth_gate_steps");

const run = (step) => {
  const args = step.args || [];
  const label = String(step.label || args.join(" "));
  console.log(`[truth-gate] ${label}`);
  const res = runNpm(args, step.env || {}, "inherit");
  if (res.code !== 0) {
    console.error(`[truth-gate] ${label} failed (exit=${res.code})`);
    process.exit(res.code);
  }
};

for (const step of buildTruthGateSteps()) {
  run(step);
}

console.log("[truth-gate] PASS");
