// scripts/guard_prepush.js
// Mandatory pre-push guard: scope check, upstream sync check, and fast truth-cache freshness check.

const { runGit, gitText, runNodeScript } = require("./guard_common");

function main() {
  console.log("[guard:prepush] begin");
  const scopeCode = runNodeScript("scripts/guard_scope_compare.js", [
    "--mode",
    "prepush",
    "--write",
    "out/guardrails/guard_prepush_scope.json",
  ]);
  if (scopeCode !== 0) {
    console.error("[guard:prepush] blocked by scope guard");
    process.exit(scopeCode);
  }

  const upstreamRef = gitText(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], true);
  if (!upstreamRef) {
    console.error("[guard:prepush] FAIL code=GUARD_UPSTREAM_MISSING");
    process.exit(40);
  }
  const counts = runGit(["rev-list", "--left-right", "--count", `HEAD...${upstreamRef}`]).stdout.split(/\s+/);
  const ahead = Number.parseInt(counts[0] || "0", 10) || 0;
  const behind = Number.parseInt(counts[1] || "0", 10) || 0;
  console.log(`[guard:prepush] upstream=${upstreamRef} ahead=${ahead} behind=${behind}`);
  if (behind > 0) {
    console.error("[guard:prepush] FAIL code=GUARD_UPSTREAM_BEHIND");
    process.exit(1);
  }

  const truthCode = runNodeScript("scripts/guard_truth_gate.js", [
    "--require-fresh",
    "--write",
    "out/guardrails/guard_prepush_truth.json",
  ]);
  if (truthCode !== 0) {
    console.error("[guard:prepush] blocked by truth gate freshness check");
    process.exit(truthCode);
  }

  console.log("[guard:prepush] PASS");
}

main();
