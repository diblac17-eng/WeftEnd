/* src/cli/intake_cli_smoke.test.ts */
/**
 * CLI intake smoke tests (fixtures + policies).
 */

import { runCliCapture } from "./cli_test_runner";

declare const require: any;
declare const __dirname: string;
declare const process: any;

const fs = require("fs");
const os = require("os");
const path = require("path");

type TestFn = () => void | Promise<void>;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    fail(`${msg}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-intake-"));

const readDecision = (dir: string) => {
  const raw = fs.readFileSync(path.join(dir, "intake_decision.json"), "utf8").trim();
  return JSON.parse(raw);
};

suite("cli/intake", () => {
  register("safe fixture approves", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["intake", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 0, `expected zero exit code\n${result.stderr}`);
    const decision = readDecision(outDir);
    assertEq(decision.action, "APPROVE", "expected APPROVE action");
  });

  register("net attempt queues", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "net_attempt");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["intake", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 10, `expected QUEUE exit code\n${result.stderr}`);
    const decision = readDecision(outDir);
    assertEq(decision.action, "QUEUE", "expected QUEUE action");
    assert(
      Array.isArray(decision.topReasonCodes) && decision.topReasonCodes.includes("CAP_DENY_NET"),
      "expected CAP_DENY_NET reason"
    );
  });

  register("tampered zip holds", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const policyPath = path.join(process.cwd(), "policies", "release_strict_default.json");
    const result = await runCliCapture([
      "intake",
      inputPath,
      "--policy",
      policyPath,
      "--out",
      outDir,
      "--profile",
      "generic",
    ]);
    assertEq(result.status, 30, `expected HOLD exit code\n${result.stderr}`);
    const decision = readDecision(outDir);
    assertEq(decision.action, "HOLD", "expected HOLD action");
    assert(
      Array.isArray(decision.topReasonCodes) && decision.topReasonCodes.includes("ZIP_EOCD_MISSING"),
      "expected ZIP_EOCD_MISSING reason"
    );
  });

  register("invalid policy fails closed", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(outDir, "bad_policy.json");
    fs.writeFileSync(policyPath, "{", "utf8");
    const result = await runCliCapture(["intake", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 40, `expected invalid policy exit code\n${result.stderr}`);
  });

  register("missing input path exits 40", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "does_not_exist");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["intake", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 40, `expected missing input exit code\n${result.stderr}`);
  });

  register("unreadable input path exits 40", async () => {
    const outDir = makeTempDir();
    const unreadableDir = makeTempDir();
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    let accessDenied = false;
    try {
      fs.chmodSync(unreadableDir, 0);
    } catch {}
    try {
      fs.accessSync(unreadableDir, fs.constants.R_OK);
    } catch {
      accessDenied = true;
    }
    if (!accessDenied) {
      try {
        fs.chmodSync(unreadableDir, 0o700);
      } catch {}
      return;
    }
    const result = await runCliCapture(["intake", unreadableDir, "--policy", policyPath, "--out", outDir]);
    try {
      fs.chmodSync(unreadableDir, 0o700);
    } catch {}
    assertEq(result.status, 40, `expected unreadable input exit code\n${result.stderr}`);
  });

  register("unsupported profile fails closed", async () => {
    const outDir = makeTempDir();
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture([
      "intake",
      inputPath,
      "--policy",
      policyPath,
      "--out",
      outDir,
      "--profile",
      "plugin",
    ]);
    assertEq(result.status, 40, `expected profile unsupported exit code\n${result.stderr}`);
  });

  register("unexpected input error exits 1", async () => {
    const outDir = makeTempDir();
    const inputPath = "bad\u0000path";
    const policyPath = path.join(process.cwd(), "policies", "web_component_default.json");
    const result = await runCliCapture(["intake", inputPath, "--policy", policyPath, "--out", outDir]);
    assertEq(result.status, 1, `expected unexpected error exit code\n${result.stderr}`);
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`intake_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
