// scripts/guard_install_hooks.js
// Configure repository hooksPath for scope/truth guardrails.

const path = require("path");
const { ROOT, gitText, runGit } = require("./guard_common");

function main() {
  const top = gitText(["rev-parse", "--show-toplevel"]);
  if (path.resolve(top) !== path.resolve(ROOT)) {
    throw new Error(`Run from repo root. expected=${top} current=${ROOT}`);
  }
  runGit(["config", "core.hooksPath", ".githooks"]);
  const configured = gitText(["config", "--get", "core.hooksPath"]);
  console.log(`[guard:hooks] core.hooksPath=${configured}`);
  console.log("[guard:hooks] Installed pre-commit/pre-push guardrails from .githooks/");
}

main();
