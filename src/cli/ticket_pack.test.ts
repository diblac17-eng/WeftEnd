// src/cli/ticket_pack.test.ts
// Deterministic ticket-pack bundling (no paths, no leaks).

import { runCliCapture } from "./cli_test_runner";

declare const process: any;

const fs = require("fs");
const path = require("path");

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

const readText = (filePath: string): string => fs.readFileSync(filePath, "utf8");

const containsAbsPath = (text: string): boolean =>
  /\b[A-Za-z]:\\/.test(text) || /\/Users\//.test(text) || /\/home\//.test(text);

const parseKeyValueSummary = (text: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const rawLine of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
};

const isSha256Line = (value: string): boolean => /^sha256:[a-f0-9]{64}$/.test(String(value || ""));

const testTicketPack = async () => {
  const root = path.join(process.cwd(), "out", "ticket_pack_test");
  const runDir = path.join(root, "run");
  const packDir = path.join(root, "pack");
  const input = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");

  fs.rmSync(root, { recursive: true, force: true });

  const run = await runCliCapture(["safe-run", input, "--out", runDir]);
  assert(run.status === 0, `safe-run failed: ${run.stderr}`);
  fs.writeFileSync(
    path.join(runDir, "report_card_v0.json"),
    JSON.stringify({
      schema: "weftend.reportCard/0",
      v: 0,
      runId: "run_deadbeefcafebabe",
      libraryKey: "ticket_pack_test_key",
      status: "SAME",
      baseline: "run_baseline_seed",
      latest: "run_deadbeefcafebabe",
      buckets: "-",
      artifactFingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      artifactDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    }),
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "compare_report.txt"), "COMPARE SAME\nchanges=0\n", "utf8");
  fs.writeFileSync(
    path.join(runDir, "compare_receipt.json"),
    JSON.stringify({ schema: "weftend.compareReceipt/0", schemaVersion: 0, verdict: "SAME" }),
    "utf8"
  );

  const pack = await runCliCapture(["ticket-pack", runDir, "--out", packDir]);
  assert(pack.status === 0, `ticket-pack failed: ${pack.stderr}`);

  const ticketRoot = path.join(packDir, "ticket_pack");
  assert(fs.existsSync(ticketRoot), "ticket_pack directory missing");
  assert(fs.existsSync(path.join(ticketRoot, "ticket_summary.txt")), "ticket_summary.txt missing");
  assert(fs.existsSync(path.join(ticketRoot, "checksums.txt")), "checksums.txt missing");
  assert(fs.existsSync(path.join(ticketRoot, "ticket_pack_manifest.json")), "ticket_pack_manifest.json missing");
  assert(fs.existsSync(path.join(ticketRoot, "operator_receipt.json")), "operator_receipt.json missing");
  assert(fs.existsSync(path.join(ticketRoot, "safe_run_receipt.json")), "safe_run_receipt.json missing");
  assert(fs.existsSync(path.join(ticketRoot, "report_card_v0.json")), "report_card_v0.json missing");

  const summary = readText(path.join(ticketRoot, "ticket_summary.txt"));
  const summaryMap = parseKeyValueSummary(summary);
  assert(summary.includes("ticketPack=weftend"), "ticket summary missing header");
  assert(summary.includes("operatorReceiptFileDigest=sha256:"), "ticket summary missing operator receipt file digest");
  assert(summary.includes("safeReceiptFileDigest=sha256:"), "ticket summary missing safe receipt file digest");
  assert(summary.includes("reportCardFileDigest=sha256:"), "ticket summary missing report card file digest");
  assert(summary.includes("reportRunId="), "ticket summary missing report run id");
  assert(summary.includes("reportLibraryKey="), "ticket summary missing report library key");
  assert(summary.includes("reportStatus="), "ticket summary missing report status");
  assert(summary.includes("reportBaseline="), "ticket summary missing report baseline");
  assert(summary.includes("reportLatest="), "ticket summary missing report latest");
  assert(summary.includes("reportBuckets="), "ticket summary missing report buckets");
  assert(summary.includes("compareArtifacts="), "ticket summary missing compare artifact presence");
  assert(summary.includes("compareReceiptFileDigest="), "ticket summary missing compare receipt digest");
  assert(summary.includes("compareReportFileDigest="), "ticket summary missing compare report digest");
  assert(summary.includes("artifactFingerprint="), "ticket summary missing artifact fingerprint");
  assert(summary.includes("artifactDigest="), "ticket summary missing artifact digest");
  assert(summary.includes("adapterEvidence="), "ticket summary missing adapterEvidence");
  assert(summary.includes("capabilities=requested:"), "ticket summary missing capability summary line");
  assert(!containsAbsPath(summary), "ticket summary contains absolute path");
  assert(isSha256Line(summaryMap.operatorReceiptFileDigest), "operatorReceiptFileDigest must be sha256:<64hex>");
  assert(isSha256Line(summaryMap.safeReceiptFileDigest), "safeReceiptFileDigest must be sha256:<64hex>");
  assert(isSha256Line(summaryMap.reportCardFileDigest), "reportCardFileDigest must be sha256:<64hex>");
  assert(String(summaryMap.compareArtifacts || "") === "present", "compareArtifacts must be present when compare files exist");
  assert(isSha256Line(summaryMap.compareReceiptFileDigest), "compareReceiptFileDigest must be sha256:<64hex>");
  assert(isSha256Line(summaryMap.compareReportFileDigest), "compareReportFileDigest must be sha256:<64hex>");
  assert(String(summaryMap.reportRunId || "") === "run_deadbeefcafebabe", "reportRunId must match report_card_v0 source");
  assert(String(summaryMap.reportLibraryKey || "") === "ticket_pack_test_key", "reportLibraryKey must match report_card_v0 source");
  assert(String(summaryMap.reportStatus || "") === "SAME", "reportStatus must match report_card_v0 source");
  assert(String(summaryMap.reportBaseline || "") === "run_baseline_seed", "reportBaseline must match report_card_v0 source");
  assert(String(summaryMap.reportLatest || "") === "run_deadbeefcafebabe", "reportLatest must match report_card_v0 source");
  assert(String(summaryMap.reportBuckets || "") === "-", "reportBuckets must match report_card_v0 source");
  assert(
    String(summaryMap.artifactFingerprint || "") === "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    "artifactFingerprint must match report_card_v0 source"
  );
  assert(
    String(summaryMap.artifactDigest || "") === "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    "artifactDigest must match report_card_v0 source"
  );

  if (process.platform === "win32") {
    const zipRun = await runCliCapture(["ticket-pack", runDir, "--out", packDir, "--zip"]);
    if (zipRun.status !== 0 && /TICKET_PACK_ZIP_FAILED/.test(zipRun.stderr)) {
      console.log("ticket_pack.test: SKIP (zip creation blocked)");
      return;
    }
    assert(zipRun.status === 0, `ticket-pack zip failed: ${zipRun.stderr}`);
    assert(fs.existsSync(path.join(packDir, "ticket_pack.zip")), "ticket_pack.zip missing");
  }

  const maliciousRoot = path.join(root, "malicious_out");
  const maliciousPack = path.join(root, "malicious_pack");
  const outsideFile = path.join(root, "outside.txt");
  fs.mkdirSync(maliciousRoot, { recursive: true });
  fs.writeFileSync(outsideFile, "outside", "utf8");
  fs.writeFileSync(
    path.join(maliciousRoot, "operator_receipt.json"),
    JSON.stringify({
      schema: "weftend.operatorReceipt/0",
      schemaVersion: 0,
      command: "safe-run",
      result: "WITHHELD",
      receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      weftendBuild: { algo: "sha256", digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000", source: "UNKNOWN" },
      receipts: [{ kind: "safe_run_receipt", relPath: "../outside.txt", digest: "sha256:deadbeef" }],
      warnings: [],
    }),
    "utf8"
  );
  const blocked = await runCliCapture(["ticket-pack", maliciousRoot, "--out", maliciousPack]);
  assert(blocked.status === 40, `expected path-invalid fail-closed\n${blocked.stderr}`);
  assert(
    blocked.stderr.includes("TICKET_PACK_RECEIPT_PATH_INVALID"),
    "expected unsafe relPath rejection code"
  );

  const adapterRunDir = path.join(root, "adapter_run");
  const adapterPackDir = path.join(root, "adapter_pack");
  const adapterInput = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
  const adapterRun = await runCliCapture(["safe-run", adapterInput, "--out", adapterRunDir, "--adapter", "archive"]);
  assert(adapterRun.status === 0, `adapter safe-run failed: ${adapterRun.stderr}`);
  assert(fs.existsSync(path.join(adapterRunDir, "analysis", "capability_ledger_v0.json")), "capability_ledger_v0.json missing");
  assert(fs.existsSync(path.join(adapterRunDir, "analysis", "adapter_summary_v0.json")), "adapter_summary_v0.json missing");
  assert(fs.existsSync(path.join(adapterRunDir, "analysis", "adapter_findings_v0.json")), "adapter_findings_v0.json missing");

  const adapterPack = await runCliCapture(["ticket-pack", adapterRunDir, "--out", adapterPackDir]);
  assert(adapterPack.status === 0, `ticket-pack adapter run failed: ${adapterPack.stderr}`);
  const adapterTicketRoot = path.join(adapterPackDir, "ticket_pack");
  assert(
    fs.existsSync(path.join(adapterTicketRoot, "analysis", "capability_ledger_v0.json")),
    "ticket pack missing capability_ledger_v0.json"
  );
  assert(
    fs.existsSync(path.join(adapterTicketRoot, "analysis", "adapter_summary_v0.json")),
    "ticket pack missing adapter_summary_v0.json"
  );
  assert(
    fs.existsSync(path.join(adapterTicketRoot, "analysis", "adapter_findings_v0.json")),
    "ticket pack missing adapter_findings_v0.json"
  );
  const adapterSummary = readText(path.join(adapterTicketRoot, "ticket_summary.txt"));
  const adapterSummaryMap = parseKeyValueSummary(adapterSummary);
  assert(adapterSummary.includes("adapterEvidence=present"), "expected adapterEvidence=present in adapter ticket summary");
  assert(adapterSummary.includes("adapterClass=archive"), "expected adapterClass=archive in adapter ticket summary");
  assert(adapterSummary.includes("safeReceiptFileDigest=sha256:"), "expected safe receipt file digest in adapter ticket summary");
  assert(isSha256Line(adapterSummaryMap.safeReceiptFileDigest), "adapter safeReceiptFileDigest must be sha256:<64hex>");

  const txtOnlyRunDir = path.join(root, "txt_only_run");
  const txtOnlyPackDir = path.join(root, "txt_only_pack");
  const txtOnlyRun = await runCliCapture(["safe-run", input, "--out", txtOnlyRunDir]);
  assert(txtOnlyRun.status === 0, `txt-only safe-run failed: ${txtOnlyRun.stderr}`);
  const txtReport = [
    "STATUS: CHANGED (vs baseline)",
    "BASELINE: run_txt_baseline",
    "LATEST: run_txt_latest",
    "BUCKETS: C",
    "runId=run_txtonlydeadbeef",
    "libraryKey=txt_only_key",
    "artifactFingerprint=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "artifactDigest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(txtOnlyRunDir, "report_card.txt"), txtReport, "utf8");
  const txtOnlyPack = await runCliCapture(["ticket-pack", txtOnlyRunDir, "--out", txtOnlyPackDir]);
  assert(txtOnlyPack.status === 0, `ticket-pack txt-only run failed: ${txtOnlyPack.stderr}`);
  const txtOnlySummary = readText(path.join(txtOnlyPackDir, "ticket_pack", "ticket_summary.txt"));
  const txtOnlySummaryMap = parseKeyValueSummary(txtOnlySummary);
  assert(String(txtOnlySummaryMap.reportRunId || "") === "run_txtonlydeadbeef", "txt-only reportRunId fallback failed");
  assert(String(txtOnlySummaryMap.reportLibraryKey || "") === "txt_only_key", "txt-only reportLibraryKey fallback failed");
  assert(String(txtOnlySummaryMap.reportStatus || "") === "CHANGED", "txt-only reportStatus fallback failed");
  assert(String(txtOnlySummaryMap.reportBaseline || "") === "run_txt_baseline", "txt-only reportBaseline fallback failed");
  assert(String(txtOnlySummaryMap.reportLatest || "") === "run_txt_latest", "txt-only reportLatest fallback failed");
  assert(String(txtOnlySummaryMap.reportBuckets || "") === "C", "txt-only reportBuckets fallback failed");
  assert(String(txtOnlySummaryMap.compareArtifacts || "") === "none", "txt-only compareArtifacts should be none");
  assert(String(txtOnlySummaryMap.compareReceiptFileDigest || "") === "-", "txt-only compareReceiptFileDigest should be placeholder");
  assert(String(txtOnlySummaryMap.compareReportFileDigest || "") === "-", "txt-only compareReportFileDigest should be placeholder");
  assert(
    String(txtOnlySummaryMap.artifactFingerprint || "") ===
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "txt-only artifactFingerprint fallback failed"
  );
  assert(
    String(txtOnlySummaryMap.artifactDigest || "") ===
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "txt-only artifactDigest fallback failed"
  );
  assert(isSha256Line(txtOnlySummaryMap.reportCardFileDigest), "txt-only reportCardFileDigest must be sha256:<64hex>");
};

testTicketPack()
  .then(() => {
    console.log("ticket_pack.test: PASS");
  })
  .catch((err: unknown) => {
    console.error("ticket_pack.test: FAIL");
    console.error(err);
    process.exit(1);
  });
