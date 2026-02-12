/* src/runtime/privacy_lint.test.ts */
/**
 * Privacy lint tests (deterministic).
 */

import { runPrivacyLintV0, formatPrivacyLintSummary } from "./privacy_lint";

declare const require: any;

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-privacy-lint-"));

suite("runtime/privacy lint", () => {
  register("README allows reasonCodes WEFTEND_ only on approved line", () => {
    const root = makeTempDir();
    const readmeDir = path.join(root, "weftend");
    fs.mkdirSync(readmeDir, { recursive: true });
    const readmePath = path.join(readmeDir, "README.txt");
    const contents = [
      "schemaVersion=0",
      "weftendBuild.digest=UNAVAILABLE",
      "weftendBuild.reasonCodes=WEFTEND_BUILD_DIGEST_UNAVAILABLE",
      "warning=Receipts missing schemaVersion/weftendBuild are old-contract.",
      "",
    ].join("\n");
    fs.writeFileSync(readmePath, contents, "utf8");

    const fixedBuild = { algo: "sha256", digest: "sha256:22222222", source: "NODE_MAIN_JS" } as any;
    const result = runPrivacyLintV0({ root, weftendBuild: fixedBuild });
    assertEq(result.report.verdict, "PASS", "expected PASS verdict for README reasonCodes line");
    assertEq(result.report.violations.length, 0, "expected no violations");
  });

  register("README fails when WEFTEND_ appears outside reasonCodes line", () => {
    const root = makeTempDir();
    const readmeDir = path.join(root, "weftend");
    fs.mkdirSync(readmeDir, { recursive: true });
    const readmePath = path.join(readmeDir, "README.txt");
    const contents = ["schemaVersion=0", "note=WEFTEND_HOST_OUT_ROOT", ""].join("\n");
    fs.writeFileSync(readmePath, contents, "utf8");

    const fixedBuild = { algo: "sha256", digest: "sha256:22222222", source: "NODE_MAIN_JS" } as any;
    const result = runPrivacyLintV0({ root, weftendBuild: fixedBuild });
    assertEq(result.report.verdict, "FAIL", "expected FAIL verdict for WEFTEND_ in README");
    assert(result.report.violations.some((v) => v.code === "WEFTEND_TOKEN"), "expected WEFTEND_TOKEN violation");
  });

  register("lint fails on absolute path with deterministic report", () => {
    const root = makeTempDir();
    const receiptPath = path.join(root, "run_receipt.json");
    const bad = {
      schema: "weftend.runReceipt/0",
      v: 0,
      schemaVersion: 0,
      weftendBuild: { algo: "sha256", digest: "sha256:11111111", source: "NODE_MAIN_JS" },
      note: "C:\\\\Users\\\\alice\\\\secret",
    };
    fs.writeFileSync(receiptPath, JSON.stringify(bad), "utf8");

    const fixedBuild = { algo: "sha256", digest: "sha256:22222222", source: "NODE_MAIN_JS" } as any;
    const a = runPrivacyLintV0({ root, weftendBuild: fixedBuild });
    const b = runPrivacyLintV0({ root, weftendBuild: fixedBuild });

    assertEq(a.report.verdict, "FAIL", "expected FAIL verdict");
    assert(a.report.violations.some((v) => v.code === "ABS_PATH_WIN"), "expected ABS_PATH_WIN");
    assertEq(JSON.stringify(a.report), JSON.stringify(b.report), "expected deterministic report");

    const summary = formatPrivacyLintSummary(a.report);
    assert(summary.startsWith("privacy_lint: FAIL"), "expected fail summary");
    assert(!/[A-Za-z]:\\/.test(summary), "summary must not include absolute paths");
    assert(!/\/Users\//.test(summary), "summary must not include user paths");

    const reportPath = path.join(root, "weftend", "privacy_lint_v0.json");
    assert(fs.existsSync(reportPath), "expected privacy lint report");
  });

  register("lint fails when JSON key contains absolute path", () => {
    const root = makeTempDir();
    const receiptPath = path.join(root, "run_receipt.json");
    const bad = {
      schema: "weftend.runReceipt/0",
      v: 0,
      schemaVersion: 0,
      weftendBuild: { algo: "sha256", digest: "sha256:11111111", source: "NODE_MAIN_JS" },
    } as any;
    bad["C:\\\\Users\\\\bob\\\\secret"] = "ok";
    fs.writeFileSync(receiptPath, JSON.stringify(bad), "utf8");

    const fixedBuild = { algo: "sha256", digest: "sha256:22222222", source: "NODE_MAIN_JS" } as any;
    const result = runPrivacyLintV0({ root, weftendBuild: fixedBuild });
    assertEq(result.report.verdict, "FAIL", "expected FAIL verdict for path in key");
    assert(result.report.violations.some((v) => v.code === "ABS_PATH_WIN"), "expected ABS_PATH_WIN");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`privacy_lint.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
