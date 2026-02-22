/* src/runtime/host/host_update_cli_smoke.test.ts */
/**
 * Host update + status CLI smoke tests.
 */

import { runCliCapture } from "../../cli/cli_test_runner";
import { validateOperatorReceiptV0 } from "../../core/validate";
import { runPrivacyLintV0 } from "../privacy_lint";
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

suite("runtime/host update cli", () => {
  register("host install + status works", async () => {
    const hostRoot = makeTempDir();
    const trustRootPath = path.join(hostRoot, "trust_root.json");
    const keyId = "host-demo-key";
    const secret = "host-update-demo";
    const publicKey = deriveDemoPublicKey(secret);
    fs.writeFileSync(trustRootPath, JSON.stringify({ keyId, publicKey }), "utf8");
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const outDir = path.join(hostRoot, "receipts");

    const env = { WEFTEND_HOST_ROOT: hostRoot, WEFTEND_HOST_TRUST_ROOT: trustRootPath, WEFTEND_HOST_OUT_ROOT: outDir };
    const install = await runCliCapture(
      [
        "host",
        "install",
        releaseDir,
        "--root",
        hostRoot,
        "--trust-root",
        trustRootPath,
        "--out",
        outDir,
        "--signing-secret",
        secret,
      ],
      { env }
    );
    assertEq(install.status, 0, `expected install exit 0\n${install.stderr}`);
    const operatorPath = path.join(outDir, "operator_receipt.json");
    assert(fs.existsSync(operatorPath), "expected operator_receipt.json");
    assert(!fs.existsSync(`${operatorPath}.stage`), "operator receipt stage file must not remain after finalize");
    const operator = JSON.parse(fs.readFileSync(operatorPath, "utf8"));
    const opIssues = validateOperatorReceiptV0(operator, "operatorReceipt");
    assertEq(opIssues.length, 0, "expected operator receipt to validate");
    const installCombined = `${install.stdout}\n${install.stderr}`;
    assert(installCombined.includes("privacyLint=PASS"), "expected privacy lint summary for install");

    const status = await runCliCapture(
      [
        "host",
        "status",
        "--root",
        hostRoot,
        "--trust-root",
        trustRootPath,
      ],
      { env }
    );
    assertEq(status.status, 0, `expected status exit 0\n${status.stderr}`);
    const statusCombined = `${status.stdout}\n${status.stderr}`;
    assert(statusCombined.includes("privacyLint=PASS"), "expected privacy lint summary for status");
    const parsed = JSON.parse(status.stdout.trim());
    assertEq(parsed.status, "OK", "expected host status OK");

    const privacy = runPrivacyLintV0({ root: outDir });
    assertEq(privacy.report.verdict, "PASS", "expected privacy lint pass");
  });

  register("host install fails closed when out overlaps release dir", async () => {
    const hostRoot = makeTempDir();
    const trustRootPath = path.join(hostRoot, "trust_root.json");
    const keyId = "host-demo-key";
    const secret = "host-update-demo";
    const publicKey = deriveDemoPublicKey(secret);
    fs.writeFileSync(trustRootPath, JSON.stringify({ keyId, publicKey }), "utf8");
    const tmp = makeTempDir();
    const releaseDir = path.join(tmp, "release_demo_js");
    copyDir(path.join(process.cwd(), "tests", "fixtures", "release_demo_js"), releaseDir);
    const outDir = path.join(releaseDir, "receipts");

    const env = { WEFTEND_HOST_ROOT: hostRoot, WEFTEND_HOST_TRUST_ROOT: trustRootPath, WEFTEND_HOST_OUT_ROOT: outDir };
    const install = await runCliCapture(
      [
        "host",
        "install",
        releaseDir,
        "--root",
        hostRoot,
        "--trust-root",
        trustRootPath,
        "--out",
        outDir,
        "--signing-secret",
        secret,
      ],
      { env }
    );
    assertEq(install.status, 40, `expected fail-closed exit code\n${install.stderr}`);
    assert(install.stderr.includes("HOST_OUT_CONFLICTS_RELEASE_DIR"), "expected host out/release conflict code");
    assert(!fs.existsSync(path.join(outDir, "host_update_receipt.json")), "must not write host update receipt into release dir");
    assert(!fs.existsSync(path.join(outDir, "operator_receipt.json")), "must not write operator receipt into release dir");
  });

  register("host install fails closed when out path is a file", async () => {
    const hostRoot = makeTempDir();
    const trustRootPath = path.join(hostRoot, "trust_root.json");
    const keyId = "host-demo-key";
    const secret = "host-update-demo";
    const publicKey = deriveDemoPublicKey(secret);
    fs.writeFileSync(trustRootPath, JSON.stringify({ keyId, publicKey }), "utf8");
    const releaseDir = path.join(process.cwd(), "tests", "fixtures", "release_demo_js");
    const outFile = path.join(makeTempDir(), "host_out_root_file.txt");
    fs.writeFileSync(outFile, "x", "utf8");

    const env = { WEFTEND_HOST_ROOT: hostRoot, WEFTEND_HOST_TRUST_ROOT: trustRootPath, WEFTEND_HOST_OUT_ROOT: outFile };
    const install = await runCliCapture(
      [
        "host",
        "install",
        releaseDir,
        "--root",
        hostRoot,
        "--trust-root",
        trustRootPath,
        "--out",
        outFile,
        "--signing-secret",
        secret,
      ],
      { env }
    );
    assertEq(install.status, 40, `expected fail-closed out-file exit code\n${install.stderr}`);
    assert(install.stderr.includes("HOST_OUT_PATH_NOT_DIRECTORY"), "expected HOST_OUT_PATH_NOT_DIRECTORY");
    assert(!fs.existsSync(path.join(outFile, "host_update_receipt.json")), "must not create host update receipt under host out-file path");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`host_update_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
