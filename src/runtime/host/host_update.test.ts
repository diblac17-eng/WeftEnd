/* src/runtime/host/host_update.test.ts */
/**
 * Host update invariants (fail-closed).
 */

import { installHostUpdateV0 } from "./host_update";
import { validateHostUpdateReceiptV0 } from "../../core/validate";
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-host-update-"));

const copyDir = (src: string, dst: string): void => {
  if (typeof fs.cpSync === "function") {
    fs.cpSync(src, dst, { recursive: true });
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
};

suite("runtime/host update", () => {
  register("verify UNVERIFIED implies no apply", () => {
    const hostRoot = makeTempDir();
    const trustRootPath = path.join(hostRoot, "trust_root.json");
    const keyId = "host-demo-key";
    const secret = "host-update-demo";
    const publicKey = deriveDemoPublicKey(secret);
    fs.writeFileSync(trustRootPath, JSON.stringify({ keyId, publicKey }), "utf8");

    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo");
    const outDir = path.join(hostRoot, "receipts");
    const res = installHostUpdateV0({
      releaseDir,
      hostRoot,
      trustRootPath,
      signingSecret: secret,
      outDir,
    });

    assertEq(res.receipt.verify.status, "UNVERIFIED", "expected verify UNVERIFIED");
    assert(res.receipt.verify.reasonCodes.length > 0, "expected verify reasons");
    assertEq(res.receipt.decision, "DENY", "expected decision DENY");
    assert(res.receipt.apply.result !== "APPLIED", "apply must not be APPLIED when verify is UNVERIFIED");
    assertEq(res.receipt.schemaVersion, 0, "expected schemaVersion 0");
    assert(res.receipt.weftendBuild && res.receipt.weftendBuild.algo === "sha256", "expected weftendBuild block");
    const receiptPath = path.join(outDir, "host_update_receipt.json");
    assert(fs.existsSync(receiptPath), "expected host update receipt output");
    assert(!fs.existsSync(`${receiptPath}.stage`), "host update stage file must not remain after finalize");

    const mutated = { ...res.receipt } as any;
    delete mutated.schemaVersion;
    const issues = validateHostUpdateReceiptV0(mutated, "receipt");
    assert(issues.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");

    const issuesWrong = validateHostUpdateReceiptV0({ ...res.receipt, schemaVersion: 1 }, "receipt");
    assert(issuesWrong.some((i) => i.code === "RECEIPT_SCHEMA_VERSION_BAD"), "expected schemaVersion invalid");
  });

  register("fails closed when host root overlaps release dir", () => {
    const temp = makeTempDir();
    const fixtureReleaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const releaseDir = path.join(temp, "release");
    copyDir(fixtureReleaseDir, releaseDir);

    const trustRootPath = path.join(temp, "trust_root.json");
    const keyId = "host-demo-key";
    const secret = "host-update-demo";
    const publicKey = deriveDemoPublicKey(secret);
    fs.writeFileSync(trustRootPath, JSON.stringify({ keyId, publicKey }), "utf8");

    const res = installHostUpdateV0({
      releaseDir,
      hostRoot: releaseDir,
      trustRootPath,
      signingSecret: secret,
      outDir: path.join(temp, "receipts"),
    });

    assertEq(res.exitCode, 40, "expected fail-closed exit code");
    assertEq(res.receipt.decision, "DENY", "expected decision DENY");
    assertEq(res.receipt.apply.result, "SKIP", "overlap must not attempt apply");
    assert(res.receipt.verify.reasonCodes.includes("HOST_ROOT_OVERLAPS_RELEASE_DIR"), "expected verify overlap reason");
    assert(res.receipt.reasonCodes.includes("HOST_ROOT_OVERLAPS_RELEASE_DIR"), "expected decision overlap reason");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`host_update.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
