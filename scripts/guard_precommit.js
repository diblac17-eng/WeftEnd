// scripts/guard_precommit.js
// Mandatory pre-commit guard: scope check only (fail-fast, no long truth-gate run).

const { runNodeScript } = require("./guard_common");

function main() {
  console.log("[guard:precommit] begin");
  const scopeCode = runNodeScript("scripts/guard_scope_compare.js", [
    "--mode",
    "precommit",
    "--write",
    "out/guardrails/guard_precommit_scope.json",
  ]);
  if (scopeCode !== 0) {
    console.error("[guard:precommit] blocked by scope guard");
    process.exit(scopeCode);
  }

  console.log("[guard:precommit] PASS");
}

main();
