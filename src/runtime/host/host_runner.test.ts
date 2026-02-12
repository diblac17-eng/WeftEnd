/* src/runtime/host/host_runner.test.ts */
/**
 * Node host runner tests (deterministic receipts).
 */

import { runHostStrictV0 } from "./host_runner";
import { installHostUpdateV0 } from "./host_update";
import { validateHostRunReceiptV0 } from "../../core/validate";
import { deriveDemoPublicKey } from "../../ports/crypto-demo";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-host-"));

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
  const publicKey = deriveDemoPublicKey(secret);
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

suite("runtime/host runner", () => {
  register("missing artifacts yields deny receipt", async () => {
    const host = setupHostRoot();
    const releaseDir = makeTempDir();
    const outDir = makeTempDir();
    const res = await runHostStrictV0({ releaseDir, outDir, hostRoot: host.hostRoot, trustRootPath: host.trustRootPath });
    assertEq(res.receipt.verify.verdict, "DENY", "expected verify deny");
    assert(res.receipt.verify.reasonCodes.includes("RELEASE_MANIFEST_MISSING"), "expected RELEASE_MANIFEST_MISSING");
    assertEq(res.receipt.schemaVersion, 0, "expected schemaVersion 0");
    assert(res.receipt.weftendBuild && res.receipt.weftendBuild.algo === "sha256", "expected weftendBuild block");
    const issues = validateHostRunReceiptV0(res.receipt, "receipt");
    assertEq(issues.length, 0, "expected valid receipt");
  });

  register("bad release signature yields deny", async () => {
    const host = setupHostRoot();
    const fixture = path.join(process.cwd(), "tests", "fixtures", "release_demo");
    const releaseDir = makeTempDir();
    const outDir = makeTempDir();
    copyDir(fixture, releaseDir);
    const badKey = { keyId: "fixture-key", publicKey: "pub:deadbeef" };
    fs.writeFileSync(path.join(releaseDir, "release_public_key.json"), JSON.stringify(badKey), "utf8");
    const res = await runHostStrictV0({ releaseDir, outDir, hostRoot: host.hostRoot, trustRootPath: host.trustRootPath });
    assertEq(res.receipt.verify.verdict, "DENY", "expected verify deny");
    assert(res.receipt.releaseReasonCodes.includes("RELEASE_SIGNATURE_BAD"), "expected RELEASE_SIGNATURE_BAD");
  });

  register("evidence head mismatch yields deterministic deny", async () => {
    const host = setupHostRoot();
    const fixture = path.join(process.cwd(), "tests", "fixtures", "release_demo");
    const releaseDir = makeTempDir();
    const outDir = makeTempDir();
    copyDir(fixture, releaseDir);
    const evidencePath = path.join(releaseDir, "evidence.json");
    const evidence = readJson(evidencePath);
    evidence.records[0].evidenceId = "sha256:deadbeef";
    fs.writeFileSync(evidencePath, JSON.stringify(evidence), "utf8");
    const res = await runHostStrictV0({ releaseDir, outDir, hostRoot: host.hostRoot, trustRootPath: host.trustRootPath });
    assertEq(res.receipt.verify.verdict, "DENY", "expected verify deny");
    assert(res.receipt.verify.reasonCodes.includes("EVIDENCE_HEAD_MISMATCH"), "expected EVIDENCE_HEAD_MISMATCH");
  });

  register("compartment unavailable yields SKIP", async () => {
    const host = setupHostRoot();
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const outDir = makeTempDir();
    const res = await runHostStrictV0({ releaseDir, outDir, testForceCompartmentUnavailable: true, hostRoot: host.hostRoot, trustRootPath: host.trustRootPath });
    assertEq(res.receipt.execute.result, "SKIP", "expected SKIP");
    assert(res.receipt.execute.reasonCodes.includes("STRICT_COMPARTMENT_UNAVAILABLE"), "expected STRICT_COMPARTMENT_UNAVAILABLE");
  });

  register("js fixture allows strict execute", async () => {
    const host = setupHostRoot();
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const outDir = makeTempDir();
    const res = await runHostStrictV0({ releaseDir, outDir, hostRoot: host.hostRoot, trustRootPath: host.trustRootPath });
    assertEq(res.receipt.verify.verdict, "ALLOW", "expected verify allow");
    assertEq(res.receipt.execute.result, "ALLOW", "expected execute allow");
    assertEq(res.receipt.execute.executionOk, true, "expected executionOk true");
    assertEq(res.receipt.execute.reasonCodes.length, 0, "expected no execute reason codes");
  });

  register("missing schemaVersion is invalid", async () => {
    const host = setupHostRoot();
    const releaseDir = makeTempDir();
    const outDir = makeTempDir();
    const res = await runHostStrictV0({ releaseDir, outDir, hostRoot: host.hostRoot, trustRootPath: host.trustRootPath });
    const mutated = { ...res.receipt } as any;
    delete mutated.schemaVersion;
    const issues = validateHostRunReceiptV0(mutated, "receipt");
    assert(issues.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");
  });

  register("wrong schemaVersion is invalid", async () => {
    const host = setupHostRoot();
    const releaseDir = makeTempDir();
    const outDir = makeTempDir();
    const res = await runHostStrictV0({ releaseDir, outDir, hostRoot: host.hostRoot, trustRootPath: host.trustRootPath });
    const mutated = { ...res.receipt, schemaVersion: 1 };
    const issues = validateHostRunReceiptV0(mutated, "receipt");
    assert(issues.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`host_runner.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
