// scripts/guard_truth_gate.js
// Full truth gate wrapper for commit/push guardrails.

const path = require("path");
const { ROOT, gitText, runNpm, readJson, writeJsonAtomic } = require("./guard_common");
const { buildTruthGateSteps } = require("./truth_gate_steps");

const OUT_DIR = path.join(ROOT, "out", "guardrails");
const VERSION = "weftend.guardTruthGate/0";
const STATE_PATH = path.join(OUT_DIR, "guard_truth_state.json");
const DEFAULT_WRITE_PATH = path.join(OUT_DIR, "guard_truth_last.json");

function parseArgs(argv) {
  const out = {
    ifStale: false,
    requireFresh: false,
    writePath: DEFAULT_WRITE_PATH,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--if-stale") {
      out.ifStale = true;
    } else if (arg === "--require-fresh") {
      out.requireFresh = true;
    } else if (arg === "--write") {
      i += 1;
      out.writePath = path.resolve(ROOT, String(argv[i] || ""));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function commandResult(label, args, envExtra) {
  console.log(`[guard:truth] ${label}`);
  const res = runNpm(args, envExtra || {}, "inherit");
  const code = res.code;
  return {
    label,
    command: `npm ${args.join(" ")}`,
    exitCode: code,
    status: code === 0 ? "PASS" : "FAIL",
  };
}

function main() {
  const args = parseArgs(process.argv);
  const headSha = gitText(["rev-parse", "--short", "HEAD"]);
  const headTree = gitText(["rev-parse", "HEAD^{tree}"], true);
  const indexTree = gitText(["write-tree"], true);
  const state = readJson(STATE_PATH);
  const stateHeadTree = String(state?.headTree || "");
  const stateIndexTree = String(state?.indexTree || "");
  const hasCurrentTree = headTree.length > 0;
  const hasCurrentIndexTree = indexTree.length > 0;
  const treeFresh =
    hasCurrentTree &&
    ((stateHeadTree.length > 0 && stateHeadTree === headTree) ||
      (stateIndexTree.length > 0 && stateIndexTree === headTree));
  const indexFresh =
    hasCurrentIndexTree &&
    ((stateIndexTree.length > 0 && stateIndexTree === indexTree) ||
      (stateHeadTree.length > 0 && stateHeadTree === indexTree));
  const fresh =
    !!state &&
    state.schema === VERSION &&
    state.status === "PASS" &&
    (treeFresh || indexFresh) &&
    Array.isArray(state.commands);

  if (args.ifStale && fresh) {
    const skipPayload = {
      schema: VERSION,
      status: "SKIP",
      code: "GUARD_TRUTH_FRESH",
      headSha,
      headTree,
      indexTree,
      stale: false,
      commands: [],
    };
    writeJsonAtomic(args.writePath, skipPayload);
    console.log(`[guard:truth] status=SKIP code=GUARD_TRUTH_FRESH head=${headSha}`);
    process.exit(0);
  }

  if (args.requireFresh && !fresh) {
    const stalePayload = {
      schema: VERSION,
      status: "FAIL",
      code: "GUARD_TRUTH_STALE",
      headSha,
      headTree,
      indexTree,
      stale: true,
      commands: [],
      message: "truth gate cache is stale; run `npm run guard:truth` before push",
    };
    writeJsonAtomic(args.writePath, stalePayload);
    console.error("[guard:truth] status=FAIL code=GUARD_TRUTH_STALE");
    console.error("[guard:truth] run npm run guard:truth, then retry push");
    process.exit(40);
  }

  const commands = [];
  for (const step of buildTruthGateSteps()) {
    commands.push(commandResult(step.label, step.args, step.env || {}));
    if (commands[commands.length - 1].exitCode !== 0) return finalize("FAIL");
  }

  return finalize("PASS");

  function finalize(status) {
    const failed = commands.find((c) => c.exitCode !== 0);
    const payload = {
      schema: VERSION,
      status,
      code: status === "PASS" ? "GUARD_TRUTH_PASS" : "GUARD_TRUTH_COMMAND_FAILED",
      headSha,
      headTree,
      indexTree,
      stale: true,
      failedCommand: failed ? failed.label : "",
      commands,
    };
    writeJsonAtomic(args.writePath, payload);
    if (status === "PASS") {
      writeJsonAtomic(STATE_PATH, payload);
      console.log(`[guard:truth] status=PASS code=GUARD_TRUTH_PASS head=${headSha}`);
      process.exit(0);
    }
    console.error(
      `[guard:truth] status=FAIL code=GUARD_TRUTH_COMMAND_FAILED head=${headSha} failed=${payload.failedCommand}`
    );
    process.exit(1);
  }
}

main();
