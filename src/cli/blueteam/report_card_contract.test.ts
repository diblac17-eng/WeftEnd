/* src/cli/blueteam/report_card_contract.test.ts */
/**
 * Blue Team: report card contract (status banner + no path leaks).
 */

export {};

declare const require: any;
declare const process: any;

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-blue-report-"));

const resolvePowerShellExe = (): string => {
  const windir = String(process.env?.WINDIR || "").trim();
  if (windir.length > 0) {
    const candidate = path.join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
};

const runWrapper = (targetPath: string, outRoot: string, repoRoot: string) => {
  const ps = resolvePowerShellExe();
  const scriptPath = path.join(process.cwd(), "tools", "windows", "shell", "weftend_safe_run.ps1");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Target",
    targetPath,
    "-RepoRoot",
    repoRoot,
    "-OutRoot",
    outRoot,
    "-Open",
    "0",
  ];
  const env = { ...process.env, WEFTEND_LIBRARY_ROOT: outRoot };
  return spawnSync(ps, args, { encoding: "utf8", env });
};

const findLatestRunDir = (libraryRoot: string): string => {
  const targets = fs.readdirSync(libraryRoot, { withFileTypes: true }).filter((d: any) => d.isDirectory && d.isDirectory());
  assert(targets.length > 0, "expected target dir");
  const targetDir = path.join(libraryRoot, String(targets[0].name));
  const runDirs = fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((d: any) => d.isDirectory && d.isDirectory())
    .map((d: any) => String(d.name))
    .filter((name: string) => name.startsWith("run_"))
    .sort((a: string, b: string) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
  assert(runDirs.length > 0, "expected run dirs");
  return path.join(targetDir, runDirs[runDirs.length - 1]);
};

suite("blueteam/report-card", () => {
  register("report_card.txt contains status banner and no absolute paths", () => {
    if (process.platform !== "win32") return;

    const temp = makeTempDir();
    const outRoot = path.join(temp, "OutRoot");
    const libraryRoot = path.join(outRoot, "Library");
    const inputPath = path.join(process.cwd(), "tests", "fixtures", "intake", "native_app_stub", "app.exe");

    const res = runWrapper(inputPath, outRoot, process.cwd());
    if (res.error && (res.error.code === "EPERM" || res.error.code === "EACCES")) {
      console.log("report_card_contract: SKIP (powershell spawn blocked)");
      return;
    }
    assertEq(res.status, 0, `expected wrapper exit 0\n${res.stderr || ""}`);

    const latestRun = findLatestRunDir(libraryRoot);
    const report = fs.readFileSync(path.join(latestRun, "report_card.txt"), "utf8");
    assert(report.includes("STATUS:"), "expected STATUS in report card");
    assert(report.includes("BASELINE:"), "expected BASELINE in report card");
    assert(report.includes("LATEST:"), "expected LATEST in report card");
    assert(report.includes("FINGERPRINT:"), "expected FINGERPRINT in report card");
    assert(report.includes("HISTORY:"), "expected HISTORY in report card");
    assert(report.includes("EVIDENCE TAGS:"), "expected evidence tags legend in report card");
    assert(report.includes("evidence.classification=[INF]"), "expected classification evidence mapping in report card");
    assert(report.includes("evidence.observed=[OBS]"), "expected observed evidence mapping in report card");
    assert(report.includes("evidence.posture=[POL]"), "expected posture evidence mapping in report card");
    assert(report.includes("evidence.privacyLint=[SYS]"), "expected privacy evidence mapping in report card");
    assert(report.includes("evidence.buildDigest=[SYS]"), "expected build evidence mapping in report card");
    assert(!/[A-Za-z]:\\/.test(report), "report card must not include absolute Windows paths");
    assert(!/\/Users\//.test(report), "report card must not include user paths");
    assert(!/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/.test(report), "report card must not include wall-clock timestamp strings");
    assert(!/\btimestampMs=/.test(report), "report card must not include runtime timestamp counters");

    const reportJson = fs.readFileSync(path.join(latestRun, "report_card_v0.json"), "utf8");
    assert(!/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/.test(reportJson), "report card json must not include wall-clock timestamp strings");
    assert(!/"createdAt"\s*:/.test(reportJson), "report card json must not include createdAt fields");
    assert(!/"updatedAt"\s*:/.test(reportJson), "report card json must not include updatedAt fields");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`report_card_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
