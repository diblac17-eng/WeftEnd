/* src/cli/windows_shell_wrapper_smoke.test.ts */
export {};

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const isWin = process.platform === "win32";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-shell-wrapper-"));

const containsPathLeak = (text: string): boolean => /[A-Za-z]:\\/.test(text) || /\\Users\\/.test(text);

const findFirstFile = (root: string, fileName: string): string | null => {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = String(stack.pop() || "");
    let entries: any[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return full;
      }
    }
  }
  return null;
};

const readJsonUtf8 = (filePath: string): any => {
  const raw = fs.readFileSync(filePath, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(text);
};

const run = async () => {
  if (!isWin) {
    console.log("windows_shell_wrapper_smoke: SKIP (non-windows)");
    return;
  }

  const windir = String(process.env.WINDIR || "C:\\Windows");
  const powershellExe = path.join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (!fs.existsSync(powershellExe)) {
    console.log("windows_shell_wrapper_smoke: SKIP (powershell host unavailable)");
    return;
  }

  const repoRoot = process.cwd();
  const wrapperPath = path.join(repoRoot, "tools", "windows", "shell", "weftend_safe_run.ps1");
  assert(fs.existsSync(wrapperPath), "missing weftend_safe_run.ps1");
  assert(fs.existsSync(path.join(repoRoot, "README.md")), "missing README.md");

  const tmp = makeTempDir();
  const outRoot = path.join(tmp, "Library");
  fs.mkdirSync(outRoot, { recursive: true });

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    wrapperPath,
    "-TargetPath",
    "README.md",
    "-RepoRoot",
    repoRoot,
    "-OutRoot",
    outRoot,
    "-Open",
    "0",
  ];
  const r = spawnSync(powershellExe, args, { encoding: "utf8", cwd: repoRoot });
  assert(r.status === 0, `wrapper run failed status=${String(r.status)} stderr=${String(r.stderr || "").trim()}`);

  const wrapperResultPath = findFirstFile(outRoot, "wrapper_result.txt");
  assert(wrapperResultPath, "expected wrapper_result.txt");
  const wrapperResult = fs.readFileSync(String(wrapperResultPath), "utf8");
  assert(wrapperResult.includes("snapshotRef=SNAPSHOT_REFERENCE_WRITTEN"), "expected snapshot reference write status in wrapper_result.txt");
  assert(!containsPathLeak(wrapperResult), "wrapper_result.txt must not contain absolute path identifiers");

  const runDir = path.dirname(String(wrapperResultPath));
  const targetDir = path.dirname(runDir);
  const targetKey = path.basename(targetDir);
  const runId = path.basename(runDir);

  const reportCardPath = path.join(runDir, "report_card.txt");
  assert(fs.existsSync(reportCardPath), "expected report_card.txt");
  const reportCard = fs.readFileSync(reportCardPath, "utf8");
  assert(reportCard.includes("STATUS:"), "expected STATUS line in report card");
  assert(reportCard.includes("FINGERPRINT:"), "expected FINGERPRINT line in report card");
  assert(reportCard.includes("result="), "expected result line in report card");
  assert(reportCard.includes("receipt=safe_run_receipt.json"), "expected receipt reference in report card");
  assert(!containsPathLeak(reportCard), "report_card.txt must not contain absolute path identifiers");

  const operatorReceiptPath = path.join(runDir, "operator_receipt.json");
  assert(fs.existsSync(operatorReceiptPath), "expected operator_receipt.json");

  const snapshotLatestPath = path.join(outRoot, "SnapshotTrust", "buckets", targetKey, "snapshot_ref_latest.json");
  assert(fs.existsSync(snapshotLatestPath), "expected snapshot_ref_latest.json");
  const snapshotRaw = fs.readFileSync(snapshotLatestPath, "utf8");
  assert(!containsPathLeak(snapshotRaw), "snapshot_ref_latest.json must not contain absolute path identifiers");
  const snapshot = readJsonUtf8(snapshotLatestPath);
  assert(String(snapshot.schema || "") === "weftend.snapshotReference/0", "unexpected snapshot schema");
  assert(String(snapshot.targetKey || "") === targetKey, "snapshot targetKey mismatch");
  assert(String(snapshot.runId || "") === runId, "snapshot runId mismatch");
  const identity = (snapshot && snapshot.identity) ? snapshot.identity : {};
  assert(/^sha256:[0-9a-f]{64}$/.test(String(identity.artifactDigest || "")), "expected identity.artifactDigest sha256");
  assert(/^sha256:[0-9a-f]{64}$/.test(String(identity.reportCardDigest || "")), "expected identity.reportCardDigest sha256");
  assert(/^sha256:[0-9a-f]{64}$/.test(String(identity.safeReceiptDigest || "")), "expected identity.safeReceiptDigest sha256");
};

run()
  .then(() => {
    console.log("windows_shell_wrapper_smoke: PASS");
  })
  .catch((err) => {
    const msg = err?.message ? `\n${err.message}` : "";
    throw new Error(`windows_shell_wrapper_smoke.test failed${msg}`);
  });
