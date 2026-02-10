/* src/cli/email_cli_smoke.test.ts */
// CLI smoke tests for email adapter v0.

import { runCliCapture } from "./cli_test_runner";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";

declare const process: any;

const fs = require("fs");
const path = require("path");
const os = require("os");

type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];
const register = (name: string, fn: TestFn): void => {
  tests.push({ name, fn });
};
const suite = (_name: string, define: () => void): void => define();

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const assertEq = (actual: unknown, expected: unknown, message: string): void => {
  if (actual !== expected) throw new Error(`${message} (actual=${String(actual)} expected=${String(expected)})`);
};

const readText = (filePath: string): string => fs.readFileSync(filePath, "utf8");

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-email-"));

suite("cli/email", () => {
  register("email unpack writes deterministic export folder", async () => {
    const temp = makeTempDir();
    const outDir = path.join(temp, "run");
    const input = path.join(process.cwd(), "tests", "fixtures", "email", "simple_html.eml");
    const result = await runCliCapture(["email", "unpack", input, "--out", outDir]);
    assertEq(result.status, 0, `expected email unpack success\n${result.stderr}`);

    const exportDir = path.join(outDir, "email_export");
    assert(fs.existsSync(path.join(exportDir, "email_headers.txt")), "email_headers.txt missing");
    assert(fs.existsSync(path.join(exportDir, "email_body.txt")), "email_body.txt missing");
    assert(fs.existsSync(path.join(exportDir, "email_body.html")), "email_body.html missing");
    assert(fs.existsSync(path.join(exportDir, "links.txt")), "links.txt missing");
    assert(fs.existsSync(path.join(exportDir, "attachments", "manifest.json")), "attachments manifest missing");
    const html = readText(path.join(exportDir, "email_body.html"));
    assert(!/<script/i.test(html), "sanitized html should not contain script tags");
    const links = readText(path.join(exportDir, "links.txt"));
    assert(links.includes("https://status.example.com/report"), "expected extracted link");
  });

  register("email unpack selects message from mbox index", async () => {
    const temp = makeTempDir();
    const outDir = path.join(temp, "run");
    const input = path.join(process.cwd(), "tests", "fixtures", "email", "sample.mbox");
    const result = await runCliCapture(["email", "unpack", input, "--index", "1", "--out", outDir]);
    assertEq(result.status, 0, `expected mbox unpack success\n${result.stderr}`);
    const headers = readText(path.join(outDir, "email_export", "email_headers.txt"));
    assert(headers.includes("message-id: <mbox-2@example.com>"), "expected second message selection");
  });

  register("email safe-run pipeline writes receipts and passes privacy lint", async () => {
    const temp = makeTempDir();
    const outDir = path.join(temp, "run");
    const input = path.join(process.cwd(), "tests", "fixtures", "email", "with_attachment.eml");
    const result = await runCliCapture(["email", "safe-run", input, "--out", outDir]);
    assertEq(result.status, 0, `expected email safe-run success\n${result.stderr}`);
    assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "safe_run_receipt.json missing");
    assert(fs.existsSync(path.join(outDir, "operator_receipt.json")), "operator_receipt.json missing");
    assert(fs.existsSync(path.join(outDir, "email_export", "links.txt")), "email_export links missing");
    const receipt = JSON.parse(readText(path.join(outDir, "safe_run_receipt.json")));
    assert(typeof receipt?.contentSummary?.totalFiles === "number", "expected contentSummary totals");
    const lint = runPrivacyLintV0({ root: outDir, writeReport: false });
    assertEq(lint.report.verdict, "PASS", "email safe-run output must pass privacy lint");
  });
});

const run = async (): Promise<void> => {
  for (const test of tests) {
    try {
      await test.fn();
    } catch (error) {
      const detail = error instanceof Error ? `\n${error.message}` : "";
      throw new Error(`email_cli_smoke.test.ts: ${test.name} failed${detail}`);
    }
  }
};

run()
  .then(() => {
    console.log("email_cli_smoke.test: PASS");
  })
  .catch((error) => {
    console.error("email_cli_smoke.test: FAIL");
    console.error(error);
    process.exit(1);
  });
