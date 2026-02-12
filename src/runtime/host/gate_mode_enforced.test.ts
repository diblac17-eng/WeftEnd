/* src/runtime/host/gate_mode_enforced.test.ts */
/**
 * Host gate mode (baseline required) tests.
 */

import { runHostStrictV0 } from "./host_runner";
import { installHostUpdateV0 } from "./host_update";
import { runSafeRun } from "../../cli/safe_run";
import { sanitizeLibraryTargetKeyV0 } from "../library_keys";
import { resolveLibraryRootV0 } from "../library_root";

declare const require: any;
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-gate-"));

const copyDir = (src: string, dest: string) => {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
};

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const setupHostRoot = (): { hostRoot: string; trustRootPath: string } => {
  const hostRoot = makeTempDir();
  const trustRootPath = path.join(hostRoot, "trust_root.json");
  const keyId = "host-demo-key";
  const secret = "host-update-demo";
  const publicKey = require("../../ports/crypto-demo").deriveDemoPublicKey(secret);
  fs.writeFileSync(trustRootPath, JSON.stringify({ keyId, publicKey }), "utf8");
  const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
  const outDir = path.join(hostRoot, "receipts");
  const res = installHostUpdateV0({
    releaseDir,
    hostRoot,
    trustRootPath,
    signingSecret: secret,
    outDir,
  });
  assertEq(res.receipt.decision, "ALLOW", "expected host update allow");
  assertEq(res.receipt.apply.result, "APPLIED", "expected host update applied");
  return { hostRoot, trustRootPath };
};

const withEnv = async (env: Record<string, string>, fn: () => Promise<void> | void) => {
  const prev: Record<string, string | undefined> = {};
  Object.keys(env).forEach((key) => {
    prev[key] = process.env[key];
    process.env[key] = env[key];
  });
  try {
    await fn();
  } finally {
    Object.keys(env).forEach((key) => {
      const value = prev[key];
      if (typeof value === "undefined") delete process.env[key];
      else process.env[key] = value;
    });
  }
};

suite("runtime/host gate mode enforced", () => {
  register("baseline missing blocks execution", async () => {
    const host = setupHostRoot();
    const libraryRoot = makeTempDir();
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const outDir = makeTempDir();
    await withEnv({ WEFTEND_LIBRARY_ROOT: libraryRoot }, async () => {
      const res = await runHostStrictV0({
        releaseDir,
        outDir,
        hostRoot: host.hostRoot,
        trustRootPath: host.trustRootPath,
        gateMode: "enforced",
      });
      assertEq(res.receipt.gateVerdict, "BLOCK", "expected gate block");
      assert(res.receipt.gateReasonCodes?.includes("BASELINE_REQUIRED"), "expected BASELINE_REQUIRED");
    });
  });

  register("baseline same allows execution path", async () => {
    const host = setupHostRoot();
    const libraryRoot = makeTempDir();
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const outDir = makeTempDir();
    const manifest = readJson(path.join(releaseDir, "release_manifest.json"));
    const targetKey = sanitizeLibraryTargetKeyV0(String(manifest.releaseId || "release_demo"));
    await withEnv({ WEFTEND_LIBRARY_ROOT: libraryRoot }, async () => {
      const resolvedRoot = resolveLibraryRootV0().root;
      const runDir = path.join(resolvedRoot, targetKey, "run_000001");

      const safe = await runSafeRun({
        inputPath: releaseDir,
        outDir: runDir,
        profile: "generic",
        mode: "strict",
        executeRequested: false,
        withholdExec: true,
      });
      assertEq(safe, 0, "expected safe-run baseline ok");

      const res = await runHostStrictV0({
        releaseDir,
        outDir,
        hostRoot: host.hostRoot,
        trustRootPath: host.trustRootPath,
        gateMode: "enforced",
      });
      assertEq(res.receipt.gateVerdict, "ALLOW", "expected gate allow");
    });
  });

  register("baseline changed blocks execution", async () => {
    const host = setupHostRoot();
    const libraryRoot = makeTempDir();
    const releaseFixture = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const releaseDir = makeTempDir();
    copyDir(releaseFixture, releaseDir);
    const outDir = makeTempDir();

    const manifest = readJson(path.join(releaseFixture, "release_manifest.json"));
    const targetKey = sanitizeLibraryTargetKeyV0(String(manifest.releaseId || "release_demo"));

    await withEnv({ WEFTEND_LIBRARY_ROOT: libraryRoot }, async () => {
      const resolvedRoot = resolveLibraryRootV0().root;
      const runDir = path.join(resolvedRoot, targetKey, "run_000001");
      const safe = await runSafeRun({
        inputPath: releaseFixture,
        outDir: runDir,
        profile: "generic",
        mode: "strict",
        executeRequested: false,
        withholdExec: true,
      });
      assertEq(safe, 0, "expected safe-run baseline ok");

      const evidencePath = path.join(releaseDir, "evidence.json");
      const evidence = readJson(evidencePath);
      if (Array.isArray(evidence.records) && evidence.records.length > 0) {
        evidence.records[0].evidenceId = "sha256:deadbeef";
      }
      fs.writeFileSync(evidencePath, JSON.stringify(evidence), "utf8");

      const res = await runHostStrictV0({
        releaseDir,
        outDir,
        hostRoot: host.hostRoot,
        trustRootPath: host.trustRootPath,
        gateMode: "enforced",
      });
      assertEq(res.receipt.gateVerdict, "BLOCK", "expected gate block");
      assert(res.receipt.gateReasonCodes?.includes("GATE_MODE_CHANGED_BLOCKED"), "expected GATE_MODE_CHANGED_BLOCKED");
    });
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      await Promise.resolve()
        .then(() => t.fn())
        .catch((err) => {
          throw new Error(`gate_mode_enforced.test.ts: ${t.name} failed\n${String(err?.message || err)}`);
        });
    }
  })();
}
