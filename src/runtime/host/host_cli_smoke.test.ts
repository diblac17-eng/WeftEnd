/* src/runtime/host/host_cli_smoke.test.ts */
/**
 * Host CLI smoke tests (deterministic receipts).
 */

import { runCliCapture } from "../../cli/cli_test_runner";
import { validateHostRunReceiptV0, validateOperatorReceiptV0 } from "../../core/validate";
import { runPrivacyLintV0 } from "../privacy_lint";
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-host-cli-"));

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

suite("runtime/host cli", () => {
  register("host run writes receipt and exits deterministic code", async () => {
    const host = setupHostRoot();
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo");
    const outDir = makeTempDir();
    const res = await runCliCapture(
      ["host", "run", releaseDir, "--out", outDir, "--root", host.hostRoot, "--trust-root", host.trustRootPath],
      { env: { WEFTEND_HOST_ROOT: host.hostRoot, WEFTEND_HOST_TRUST_ROOT: host.trustRootPath } }
    );
    assertEq(res.status, 40, `expected expected-failure exit code\n${res.stderr}`);
    const receiptPath = path.join(outDir, "host_run_receipt.json");
    assert(fs.existsSync(receiptPath), "expected host_run_receipt.json");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const issues = validateHostRunReceiptV0(receipt, "receipt");
    assertEq(issues.length, 0, "expected receipt to validate");
    const operatorPath = path.join(outDir, "operator_receipt.json");
    assert(fs.existsSync(operatorPath), "expected operator_receipt.json");
    const operator = JSON.parse(fs.readFileSync(operatorPath, "utf8"));
    const opIssues = validateOperatorReceiptV0(operator, "operatorReceipt");
    assertEq(opIssues.length, 0, "expected operator receipt to validate");
    const combined = `${res.stdout}\n${res.stderr}`;
    assert(combined.includes("privacyLint=PASS"), "expected privacy lint summary");
    const privacy = runPrivacyLintV0({ root: outDir, weftendBuild: receipt.weftendBuild });
    assertEq(privacy.report.verdict, "PASS", "expected privacy lint pass");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`host_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
