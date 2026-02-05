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

  const pack = await runCliCapture(["ticket-pack", runDir, "--out", packDir]);
  assert(pack.status === 0, `ticket-pack failed: ${pack.stderr}`);

  const ticketRoot = path.join(packDir, "ticket_pack");
  assert(fs.existsSync(ticketRoot), "ticket_pack directory missing");
  assert(fs.existsSync(path.join(ticketRoot, "ticket_summary.txt")), "ticket_summary.txt missing");
  assert(fs.existsSync(path.join(ticketRoot, "checksums.txt")), "checksums.txt missing");
  assert(fs.existsSync(path.join(ticketRoot, "ticket_pack_manifest.json")), "ticket_pack_manifest.json missing");
  assert(fs.existsSync(path.join(ticketRoot, "operator_receipt.json")), "operator_receipt.json missing");
  assert(fs.existsSync(path.join(ticketRoot, "safe_run_receipt.json")), "safe_run_receipt.json missing");

  const summary = readText(path.join(ticketRoot, "ticket_summary.txt"));
  assert(summary.includes("ticketPack=weftend"), "ticket summary missing header");
  assert(!containsAbsPath(summary), "ticket summary contains absolute path");

  if (process.platform === "win32") {
    const zipRun = await runCliCapture(["ticket-pack", runDir, "--out", packDir, "--zip"]);
    assert(zipRun.status === 0, `ticket-pack zip failed: ${zipRun.stderr}`);
    assert(fs.existsSync(path.join(packDir, "ticket_pack.zip")), "ticket_pack.zip missing");
  }
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
