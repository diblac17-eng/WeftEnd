/* src/runtime/host/host_status.test.ts */
/**
 * Host status receipt tests (startup self-verify).
 */

import { createHostStatusReceiptV0, emitHostStatusReceiptV0 } from "./host_status";
import { validateHostStatusReceiptV0 } from "../../core/validate";
import { buildReceiptReadmeV0 } from "../receipt_readme";
import { runCliCapture } from "../../cli/cli_test_runner";
import { installHostUpdateV0 } from "./host_update";
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-host-status-"));
const makeOutDir = () => {
  const base = path.join(process.cwd(), "out", "weftend-host-status-");
  fs.mkdirSync(path.dirname(base), { recursive: true });
  return fs.mkdtempSync(base);
};

const getStatusReceipts = (outRoot: string): string[] => {
  const dir = path.join(outRoot, "weftend", "host");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name: string) => name.startsWith("host_status_"));
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

suite("runtime/host status", () => {
  register("startup emits receipt exactly once", () => {
    const hostRoot = makeTempDir();
    const outRoot = makeOutDir();
    const trustRootPath = "";
    const before = getStatusReceipts(outRoot).length;
    const emitted = emitHostStatusReceiptV0({
      hostRoot,
      hostOutRoot: outRoot,
      trustRootPath,
      outRootSource: "ARG_OUT",
      outRootEffective: outRoot,
    });
    assert(!fs.existsSync(`${emitted.receiptPath}.stage`), "host status stage file must not remain after finalize");
    const after = getStatusReceipts(outRoot).length;
    assertEq(after - before, 1, "expected exactly one receipt");
    const readmePath = path.join(outRoot, "weftend", "README.txt");
    assert(fs.existsSync(readmePath), "expected README.txt");
    const readme = fs.readFileSync(readmePath, "utf8");
    const expected = buildReceiptReadmeV0(emitted.receipt.weftendBuild, emitted.receipt.schemaVersion);
    assertEq(readme, expected, "README must match expected snapshot");
  });

  register("corrupt host binary yields UNVERIFIED and denies run", async () => {
    const host = setupHostRoot();
    const outDir = makeTempDir();
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const missingBinary = path.join(host.hostRoot, "missing-node.exe");

    const res = await runCliCapture(
      ["host", "run", releaseDir, "--out", outDir, "--root", host.hostRoot, "--trust-root", host.trustRootPath],
      {
        env: {
          WEFTEND_HOST_ROOT: host.hostRoot,
          WEFTEND_HOST_TRUST_ROOT: host.trustRootPath,
          WEFTEND_HOST_BINARY_PATH: missingBinary,
        },
      }
    );
    assertEq(res.status, 40, "expected host run denied");

    const receipts = getStatusReceipts(outDir);
    assert(receipts.length > 0, "expected host status receipt");
    const latest = receipts.sort().slice(-1)[0];
    const receipt = readJson(path.join(outDir, "weftend", "host", latest));
    assertEq(receipt.verifyResult, "UNVERIFIED", "expected UNVERIFIED status");
    assert(receipt.reasonCodes.includes("HOST_BINARY_MISSING"), "expected HOST_BINARY_MISSING");
    assert(receipt.reasonCodes.includes("HOST_STARTUP_UNVERIFIED"), "expected HOST_STARTUP_UNVERIFIED");
    assertEq(receipt.schemaVersion, 0, "expected schemaVersion 0");
    assert(receipt.weftendBuild && receipt.weftendBuild.algo === "sha256", "expected weftendBuild block");
  });

  register("oversize config yields HOST_INPUT_OVERSIZE", () => {
    const hostRoot = makeTempDir();
    const bigConfig = { pad: "x".repeat(70 * 1024) };
    const res = createHostStatusReceiptV0({
      hostRoot,
      trustRootPath: "",
      configOverride: bigConfig,
      hostBinaryDigestOverride: "sha256:11111111",
      bundlePathsOverride: [],
      timestampMs: 1,
      outRootSource: "ENV_OUT_ROOT",
      outRootEffective: hostRoot,
    });
    assertEq(res.receipt.verifyResult, "UNVERIFIED", "expected UNVERIFIED status");
    assert(res.receipt.reasonCodes.includes("HOST_INPUT_OVERSIZE"), "expected HOST_INPUT_OVERSIZE");
    assert(res.receipt.reasonCodes.includes("HOST_STARTUP_UNVERIFIED"), "expected HOST_STARTUP_UNVERIFIED");
  });

  register("receipt digest stable across identical startups", () => {
    const options: {
      hostRoot: string;
      trustRootPath: string;
      hostBinaryDigestOverride: string;
      hostConfigDigestOverride: string;
      bundlePathsOverride: string[];
      timestampMs: number;
      outRootSource: "ARG_OUT" | "ENV_OUT_ROOT";
      outRootEffective: string;
    } = {
      hostRoot: makeTempDir(),
      trustRootPath: "",
      hostBinaryDigestOverride: "sha256:11111111",
      hostConfigDigestOverride: "sha256:22222222",
      bundlePathsOverride: [],
      timestampMs: 42,
      outRootSource: "ENV_OUT_ROOT",
      outRootEffective: "out-root",
    };
    const a = createHostStatusReceiptV0(options);
    const b = createHostStatusReceiptV0(options);
    assertEq(a.receipt.receiptDigest, b.receipt.receiptDigest, "expected stable receiptDigest");
  });

  register("missing schemaVersion is invalid", () => {
    const options: {
      hostRoot: string;
      trustRootPath: string;
      hostBinaryDigestOverride: string;
      hostConfigDigestOverride: string;
      bundlePathsOverride: string[];
      timestampMs: number;
      outRootSource: "ARG_OUT" | "ENV_OUT_ROOT";
      outRootEffective: string;
    } = {
      hostRoot: makeTempDir(),
      trustRootPath: "",
      hostBinaryDigestOverride: "sha256:11111111",
      hostConfigDigestOverride: "sha256:22222222",
      bundlePathsOverride: [],
      timestampMs: 42,
      outRootSource: "ENV_OUT_ROOT",
      outRootEffective: "out-root",
    };
    const res = createHostStatusReceiptV0(options);
    const mutated = { ...res.receipt } as any;
    delete mutated.schemaVersion;
    const issues = validateHostStatusReceiptV0(mutated, "hostStatusReceipt");
    assert(issues.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");
  });

  register("wrong schemaVersion is invalid", () => {
    const res = createHostStatusReceiptV0({
      hostRoot: makeTempDir(),
      trustRootPath: "",
      hostBinaryDigestOverride: "sha256:11111111",
      hostConfigDigestOverride: "sha256:22222222",
      bundlePathsOverride: [],
      timestampMs: 42,
      outRootSource: "ENV_OUT_ROOT",
      outRootEffective: "out-root",
    });
    const mutated = { ...res.receipt, schemaVersion: 1 };
    const issues = validateHostStatusReceiptV0(mutated, "hostStatusReceipt");
    assert(issues.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");
  });

  register("when both provided, --out wins and receipt records ARG_OUT", async () => {
    const host = setupHostRoot();
    const outArg = makeOutDir();
    const outEnv = makeOutDir();
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const res = await runCliCapture(
      ["host", "run", releaseDir, "--out", outArg, "--root", host.hostRoot, "--trust-root", host.trustRootPath],
      { env: { WEFTEND_HOST_OUT_ROOT: outEnv, WEFTEND_HOST_ROOT: host.hostRoot, WEFTEND_HOST_TRUST_ROOT: host.trustRootPath } }
    );
    assertEq(res.status, 0, `expected host run allow\n${res.stderr}`);
    const receipts = getStatusReceipts(outArg);
    assert(receipts.length > 0, "expected status receipt under --out");
    const latest = receipts.sort().slice(-1)[0];
    const receipt = readJson(path.join(outArg, "weftend", "host", latest));
    assertEq(receipt.outRootSource, "ARG_OUT", "expected outRootSource ARG_OUT");
    const expectedRel = path.relative(process.cwd(), outArg);
    assertEq(path.normalize(receipt.outRootEffective), path.normalize(expectedRel), "expected outRootEffective to match --out relPath");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`host_status.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
