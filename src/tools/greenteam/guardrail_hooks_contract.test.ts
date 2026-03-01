/* src/tools/greenteam/guardrail_hooks_contract.test.ts */
/**
 * Green Team: branch-comparison drift guardrail contract.
 */

export {};

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

type TestFn = () => void | Promise<void>;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

const g: any = globalThis as any;
const hasBDD = typeof g.describe === "function" && typeof g.it === "function";
const localTests: Array<{ name: string; fn: TestFn }> = [];

function register(name: string, fn: TestFn): void {
  if (hasBDD) g.it(name, fn);
  else localTests.push({ name, fn });
}

function suite(name: string, define: () => void): void {
  if (hasBDD) g.describe(name, define);
  else define();
}

function readText(relPath: string): string {
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
}

suite("greenteam/guardrail-hooks-contract", () => {
  register("guard scripts, hooks, and scope schema remain wired", () => {
    const packageJson = readText("package.json");
    const preCommit = readText(".githooks/pre-commit");
    const prePush = readText(".githooks/pre-push");
    const scopeExample = readText(".weftend/guard_scope.example.json");
    const scopeScript = readText("scripts/guard_scope_compare.js");
    const truthScript = readText("scripts/guard_truth_gate.js");
    const truthStepsScript = readText("scripts/truth_gate_steps.js");
    const guardCommonScript = readText("scripts/guard_common.js");
    const preCommitScript = readText("scripts/guard_precommit.js");
    const prePushScript = readText("scripts/guard_prepush.js");
    const installHooks = readText("scripts/guard_install_hooks.js");

    assert(
      packageJson.includes("\"guard:scope\": \"node scripts/guard_scope_compare.js --mode precommit\""),
      "package.json missing guard:scope script"
    );
    assert(
      packageJson.includes("\"guard:truth\": \"node scripts/guard_truth_gate.js\""),
      "package.json missing guard:truth script"
    );
    assert(
      packageJson.includes("\"guard:precommit\": \"node scripts/guard_precommit.js\""),
      "package.json missing guard:precommit script"
    );
    assert(
      packageJson.includes("\"guard:prepush\": \"node scripts/guard_prepush.js\""),
      "package.json missing guard:prepush script"
    );
    assert(
      packageJson.includes("\"guard:hooks:install\": \"node scripts/guard_install_hooks.js\""),
      "package.json missing guard:hooks:install script"
    );
    assert(
      packageJson.includes("\"gate:truth\": \"node scripts/commit_truth_gate.js\""),
      "package.json missing gate:truth script"
    );

    assert(preCommit.includes("node scripts/guard_precommit.js"), ".githooks/pre-commit missing guard runner");
    assert(prePush.includes("node scripts/guard_prepush.js"), ".githooks/pre-push missing guard runner");

    assert(scopeExample.includes("\"schema\": \"weftend.guardScope/0\""), "scope example schema missing");
    assert(scopeExample.includes("\"allowed_files\""), "scope example allowed_files missing");
    assert(scopeExample.includes("\"allowed_prefixes\""), "scope example allowed_prefixes missing");

    assert(
      scopeScript.includes("merge-base\", \"HEAD\", \"main"),
      "scope guard must compare against local main baseline"
    );
    assert(
      scopeScript.includes("@{upstream}"),
      "scope guard must compare against tracked upstream baseline"
    );
    assert(
      scopeScript.includes("SCOPE_GUARD_SCOPE_UNDECLARED"),
      "scope guard must fail closed when no task scope is declared"
    );
    assert(scopeScript.includes("SCOPE_GUARD_OUT_OF_SCOPE"), "scope guard out-of-scope fail code missing");
    assert(
      scopeScript.includes("\\uFEFF"),
      "scope guard must strip UTF-8 BOM when parsing scope JSON"
    );

    assert(
      truthScript.includes("buildTruthGateSteps()"),
      "truth gate must source command steps from shared truth-gate definition"
    );
    assert(
      truthStepsScript.includes("label: \"compile\"") &&
        truthStepsScript.includes("[\"run\", \"compile\", \"--silent\"]"),
      "shared truth-gate steps must include compile command"
    );
    assert(
      truthStepsScript.includes("label: \"test\"") && truthStepsScript.includes("[\"test\"]"),
      "shared truth-gate steps must include test command"
    );
    assert(
      truthStepsScript.includes("label: \"proofcheck_release\"") &&
        truthStepsScript.includes("[\"run\", \"proofcheck:release\"]"),
      "shared truth-gate steps must include strict proofcheck command"
    );
    assert(
      truthStepsScript.includes("label: \"verify360_release_managed\"") &&
        truthStepsScript.includes("[\"run\", \"verify:360:release:managed\"]"),
      "shared truth-gate steps must include managed verify command"
    );
    assert(
      truthStepsScript.includes("WEFTEND_RELEASE_DIR: \"tests/fixtures/release_demo\"") &&
        truthStepsScript.includes("WEFTEND_ALLOW_SKIP_RELEASE: \"\""),
      "shared truth-gate steps must enforce strict release fixture env"
    );
    assert(
      guardCommonScript.includes("function runNodeScript(") &&
        preCommitScript.includes("runNodeScript(") &&
        prePushScript.includes("runNodeScript("),
      "precommit/prepush scripts must use shared runNodeScript helper"
    );
    assert(
      guardCommonScript.includes("function runGit(") &&
        prePushScript.includes("runGit(") &&
        installHooks.includes("runGit([\"config\", \"core.hooksPath\", \".githooks\"])"),
      "prepush/install scripts must use shared runGit helper"
    );
    assert(
      scopeScript.includes("const {") && scopeScript.includes("require(\"./guard_common\")"),
      "scope guard must source helpers from shared guard_common module"
    );

    assert(
      preCommitScript.includes("guard_scope_compare.js") && !preCommitScript.includes("guard_truth_gate.js"),
      "precommit script must run scope checks only (no long truth-gate run)"
    );
    assert(
      prePushScript.includes("--require-fresh"),
      "prepush truth check must require a fresh cached truth-gate result"
    );
    assert(
      prePushScript.includes("guard_scope_compare.js") &&
        prePushScript.includes("guard_truth_gate.js") &&
        prePushScript.includes("GUARD_UPSTREAM_BEHIND"),
      "prepush script must run scope + upstream + fast truth freshness check"
    );

    assert(
      installHooks.includes("core.hooksPath") && installHooks.includes(".githooks"),
      "hook installer must set core.hooksPath to .githooks"
    );
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`guardrail_hooks_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
