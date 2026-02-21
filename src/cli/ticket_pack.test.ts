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

const testTicketPack = async () => {
  const root = path.join(process.cwd(), "out", "ticket_pack_test");
  const runDir = path.join(root, "run");
  const packDir = path.join(root, "pack");
  const input = path.join(process.cwd(), "tests", "fixtures", "intake", "safe_no_caps");

  fs.rmSync(root, { recursive: true, force: true });

  const run = await runCliCapture(["safe-run", input, "--out", runDir]);
  assert(run.status === 0, `safe-run failed: ${run.stderr}`);
  fs.writeFileSync(path.join(runDir, "report_card_v0.json"), JSON.stringify({ schema: "weftend.reportCard/0", v: 0 }), "utf8");

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
  assert(summary.includes("ticketPack=weftend"), "ticket summary missing header");
  assert(!containsAbsPath(summary), "ticket summary contains absolute path");

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
