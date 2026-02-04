/* src/runtime/purpleteam/purple_baseline_block_flow.test.ts */
/**
 * Purple Team: baseline compare flow surfaces CHANGED + buckets in report card.
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-purple-"));

const copyDir = (src: string, dst: string) => {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  entries.forEach((entry: any) => {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory && entry.isDirectory()) {
      copyDir(from, to);
      return;
    }
    fs.copyFileSync(from, to);
  });
};

const runWrapper = (targetPath: string, outRoot: string, repoRoot: string) => {
  const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
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
  assert(targets.length > 0, "expected at least one target dir");
  const targetDir = path.join(libraryRoot, String(targets[0].name));
  const runDirs = fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((d: any) => d.isDirectory && d.isDirectory())
    .map((d: any) => String(d.name))
    .filter((name: string) => name.startsWith("run_"))
    .sort((a: string, b: string) => a.localeCompare(b));
  assert(runDirs.length > 0, "expected run dirs");
  return path.join(targetDir, runDirs[runDirs.length - 1]);
};

suite("purpleteam/baseline-block-flow", () => {
  register("report card shows CHANGED + buckets after digest change", () => {
    if (process.platform !== "win32") return;

    const temp = makeTempDir();
    const outRoot = path.join(temp, "OutRoot");
    const libraryRoot = path.join(outRoot, "Library");
    const inputSrc = path.join(process.cwd(), "tests", "fixtures", "intake", "web_export_stub");
    const inputDir = path.join(temp, "input");
    copyDir(inputSrc, inputDir);

    const first = runWrapper(inputDir, outRoot, process.cwd());
    assertEq(first.status, 0, `expected wrapper exit 0\n${first.stderr || ""}`);

    fs.appendFileSync(path.join(inputDir, "index.html"), "\n<!-- purple-change -->\n", "utf8");

    const second = runWrapper(inputDir, outRoot, process.cwd());
    assertEq(second.status, 0, `expected wrapper exit 0\n${second.stderr || ""}`);

    const latestRun = findLatestRunDir(libraryRoot);
    const reportCard = fs.readFileSync(path.join(latestRun, "report_card.txt"), "utf8");
    assert(reportCard.includes("STATUS: CHANGED"), "expected STATUS: CHANGED");
    assert(/BUCKETS:.*C/.test(reportCard), "expected C bucket");
    assert(/BUCKETS:.*D/.test(reportCard), "expected D bucket");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`purple_baseline_block_flow.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
