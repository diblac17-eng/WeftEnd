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
const readJson = (filePath: string): any => JSON.parse(readText(filePath));
const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-email-"));

suite("cli/email", () => {
  register("email unpack writes deterministic normalized folder", async () => {
    const temp = makeTempDir();
    const outA = path.join(temp, "runA");
    const outB = path.join(temp, "runB");
    const input = path.join(process.cwd(), "tests", "fixtures", "email", "simple_html.eml");
    const resultA = await runCliCapture(["email", "unpack", input, "--out", outA]);
    const resultB = await runCliCapture(["email", "unpack", input, "--out", outB]);
    assertEq(resultA.status, 0, `expected email unpack success\n${resultA.stderr}`);
    assertEq(resultB.status, 0, `expected email unpack success\n${resultB.stderr}`);

    const exportA = path.join(outA, "email_export");
    const exportB = path.join(outB, "email_export");
    const files = [
      "adapter_manifest.json",
      "headers.json",
      "body.txt",
      "body.html.txt",
      "links.txt",
      path.join("attachments", "manifest.json"),
    ];
    files.forEach((file) => {
      assert(fs.existsSync(path.join(exportA, file)), `missing ${file} in runA`);
      assert(fs.existsSync(path.join(exportB, file)), `missing ${file} in runB`);
      assertEq(readText(path.join(exportA, file)), readText(path.join(exportB, file)), `${file} must be deterministic`);
    });
    const html = readText(path.join(exportA, "body.html.txt"));
    assert(!/<script/i.test(html), "sanitized html should not contain script tags");
    const links = readText(path.join(exportA, "links.txt"));
    assert(links.includes("https://status.example.com/report"), "expected extracted link");
  });

  register("email unpack finalizes staged output and replaces stale roots", async () => {
    const temp = makeTempDir();
    const outDir = path.join(temp, "run");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "stale.txt"), "stale", "utf8");
    const input = path.join(process.cwd(), "tests", "fixtures", "email", "simple_html.eml");
    const result = await runCliCapture(["email", "unpack", input, "--out", outDir]);
    assertEq(result.status, 0, `expected email unpack success\n${result.stderr}`);
    assert(fs.existsSync(path.join(outDir, "email_export", "adapter_manifest.json")), "expected adapter manifest after finalize");
    assert(!fs.existsSync(path.join(outDir, "stale.txt")), "stale out-root file must be replaced during finalize");
    assert(!fs.existsSync(`${outDir}.stage`), "email unpack stage directory must not remain after finalize");
  });

  register("email unpack selects message from mbox index", async () => {
    const temp = makeTempDir();
    const outDir = path.join(temp, "run");
    const input = path.join(process.cwd(), "tests", "fixtures", "email", "sample.mbox");
    const result = await runCliCapture(["email", "unpack", input, "--index", "1", "--out", outDir]);
    assertEq(result.status, 0, `expected mbox unpack success\n${result.stderr}`);
    const headers = readJson(path.join(outDir, "email_export", "headers.json"));
    const flat = JSON.stringify(headers);
    assert(flat.includes("mbox-2@example.com"), "expected second message selection");
  });

  register("email unpack accepts .msg input and emits marker", async () => {
    const temp = makeTempDir();
    const msgPath = path.join(temp, "mail.msg");
    fs.writeFileSync(
      msgPath,
      "Subject: MSG sample\nFrom: sender@example.com\nVisit https://example.com/msg\n<html><body>ok</body></html>",
      "utf8"
    );
    const outDir = path.join(temp, "out");
    const result = await runCliCapture(["email", "unpack", msgPath, "--out", outDir]);
    assertEq(result.status, 0, `expected msg unpack success\n${result.stderr}`);
    const manifest = readJson(path.join(outDir, "email_export", "adapter_manifest.json"));
    assertEq(manifest.sourceFormat, "msg", "expected msg source format");
    assert(manifest.markers.includes("EMAIL_MSG_EXPERIMENTAL_PARSE"), "expected msg marker");
  });

  register("email unpack marks oversized body truncation", async () => {
    const temp = makeTempDir();
    const body = "A".repeat(1024 * 1024 + 2048);
    const emlPath = path.join(temp, "oversized.eml");
    fs.writeFileSync(emlPath, `Subject: Oversized\nContent-Type: text/plain; charset=utf-8\n\n${body}`, "utf8");
    const outDir = path.join(temp, "out");
    const result = await runCliCapture(["email", "unpack", emlPath, "--out", outDir]);
    assertEq(result.status, 0, `expected oversized unpack success\n${result.stderr}`);
    const manifest = readJson(path.join(outDir, "email_export", "adapter_manifest.json"));
    assert(manifest.markers.includes("EMAIL_BODY_TEXT_TRUNCATED"), "expected text truncation marker");
  });

  register("email safe-run pipeline writes receipts and passes privacy lint", async () => {
    const temp = makeTempDir();
    const outDir = path.join(temp, "run");
    const input = path.join(process.cwd(), "tests", "fixtures", "email", "with_attachment.eml");
    const result = await runCliCapture(["email", "safe-run", input, "--out", outDir]);
    assertEq(result.status, 0, `expected email safe-run success\n${result.stderr}`);
    assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "safe_run_receipt.json missing");
    assert(fs.existsSync(path.join(outDir, "operator_receipt.json")), "operator_receipt.json missing");
    const receipt = readJson(path.join(outDir, "safe_run_receipt.json"));
    assertEq(receipt.contentSummary.artifactKind, "webBundle", "expected web bundle summary");
    const operator = readJson(path.join(outDir, "operator_receipt.json"));
    const warnings = Array.isArray(operator?.warnings) ? operator.warnings : [];
    assert(!warnings.includes("SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT"), "email safe-run should not self-trigger orphan warning");
    const lint = runPrivacyLintV0({ root: outDir, writeReport: false });
    assertEq(lint.report.verdict, "PASS", "email safe-run output must pass privacy lint");
  });

  register("email unpack handles attachment-only mail deterministically", async () => {
    const temp = makeTempDir();
    const input = path.join(process.cwd(), "tests", "fixtures", "email", "attachment_only.eml");
    const outDir = path.join(temp, "run");
    const result = await runCliCapture(["email", "unpack", input, "--out", outDir]);
    assertEq(result.status, 0, `expected attachment-only unpack success\n${result.stderr}`);
    const manifest = readJson(path.join(outDir, "email_export", "attachments", "manifest.json"));
    assert(Array.isArray(manifest.entries), "expected attachment entries");
    assertEq(manifest.entries.length, 1, "expected one attachment");
    assertEq(manifest.entries[0].name, "sample.bin", "expected attachment name");
    const body = readText(path.join(outDir, "email_export", "body.txt")).trim();
    assertEq(body, "", "expected empty body text for attachment-only mail");
  });

  register("email safe-run rejects malformed normalized artifacts", async () => {
    const temp = makeTempDir();
    const malformed = path.join(temp, "email_export");
    fs.mkdirSync(malformed, { recursive: true });
    fs.writeFileSync(path.join(malformed, "body.txt"), "x", "utf8");
    const outDir = path.join(temp, "run");
    const result = await runCliCapture(["email", "safe-run", malformed, "--out", outDir]);
    assertEq(result.status, 40, "expected fail-closed for malformed normalized artifact");
    assert(result.stderr.includes("ADAPTER_NORMALIZATION_INVALID"), "expected normalization error");
  });

  register("email safe-run rejects normalized requiredFiles traversal", async () => {
    const temp = makeTempDir();
    const malformed = path.join(temp, "email_export");
    fs.mkdirSync(path.join(malformed, "attachments"), { recursive: true });
    const outside = path.join(temp, "outside.txt");
    fs.writeFileSync(outside, "outside", "utf8");
    fs.writeFileSync(path.join(malformed, "headers.json"), "{}", "utf8");
    fs.writeFileSync(path.join(malformed, "body.txt"), "", "utf8");
    fs.writeFileSync(path.join(malformed, "body.html.txt"), "", "utf8");
    fs.writeFileSync(path.join(malformed, "links.txt"), "", "utf8");
    fs.writeFileSync(path.join(malformed, "attachments", "manifest.json"), "{}", "utf8");
    fs.writeFileSync(
      path.join(malformed, "adapter_manifest.json"),
      JSON.stringify({
        schema: "weftend.normalizedArtifact/0",
        schemaVersion: 0,
        adapterId: "email_v0",
        kind: "email",
        sourceFormat: "eml",
        rootDir: "email_export",
        requiredFiles: ["../outside.txt"],
        markers: [],
      }),
      "utf8"
    );
    const outDir = path.join(temp, "run");
    const result = await runCliCapture(["email", "safe-run", malformed, "--out", outDir]);
    assertEq(result.status, 40, "expected fail-closed for traversal in normalized requiredFiles");
    assert(result.stderr.includes("ADAPTER_NORMALIZATION_INVALID"), "expected normalization invalid code");
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
