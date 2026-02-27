/* src/cli/web_runtime_cli_smoke.test.ts */
/**
 * CLI web-runtime capture smoke tests.
 */

import { runCliCapture } from "./cli_test_runner";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-web-runtime-"));
const listStageResidue = (root: string): string[] => {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
    entries.forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.name.endsWith(".stage")) out.push(path.relative(root, full).split(path.sep).join("/"));
      if (entry.isDirectory()) walk(full);
    });
  };
  walk(root);
  out.sort();
  return out;
};

const writeFixture = (root: string): string => {
  const inputDir = path.join(root, "web_input");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(
    path.join(inputDir, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      "    <meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' https://cdn.example.com; require-trusted-types-for 'script'\">",
      "    <title>fixture</title>",
      "  </head>",
      "  <body>",
      "    <script src=\"./app.js\" integrity=\"sha256-demo\"></script>",
      "    <script>setTimeout(\"console.log('t')\", 1); document.write('ok');</script>",
      "    <script src=\"https://cdn.example.com/lib.js\"></script>",
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(inputDir, "app.js"),
    ["console.log('fixture');", "eval('1+1');", "const s=document.createElement('script');", ""].join("\n"),
    "utf8"
  );
  return inputDir;
};

suite("cli/web-runtime-capture", () => {
  register("web-runtime help usage prints and exits 1", async () => {
    const res = await runCliCapture(["web-runtime", "--help"]);
    assertEq(res.status, 1, `expected exit 1\n${res.stderr}`);
    const text = `${res.stdout}\n${res.stderr}`;
    assert(text.includes("weftend web-runtime capture"), "expected web-runtime usage text");
  });

  register("web-runtime capture is deterministic for same input", async () => {
    const tmp = makeTempDir();
    const inputDir = writeFixture(tmp);
    const outA = path.join(tmp, "out_a");
    const outB = path.join(tmp, "out_b");

    const a = await runCliCapture(["web-runtime", "capture", inputDir, "--mode", "strict_replay", "--out", outA]);
    assertEq(a.status, 0, `expected first capture success\n${a.stderr}`);

    const b = await runCliCapture(["web-runtime", "capture", inputDir, "--mode", "strict_replay", "--out", outB]);
    assertEq(b.status, 0, `expected second capture success\n${b.stderr}`);

    const inventoryAPath = path.join(outA, "web_runtime_inventory_v0.json");
    const inventoryBPath = path.join(outB, "web_runtime_inventory_v0.json");
    const summaryAPath = path.join(outA, "web_runtime_summary.txt");
    const summaryBPath = path.join(outB, "web_runtime_summary.txt");
    assert(fs.existsSync(inventoryAPath), "expected inventory output A");
    assert(fs.existsSync(inventoryBPath), "expected inventory output B");
    assert(fs.existsSync(summaryAPath), "expected summary output A");
    assert(fs.existsSync(summaryBPath), "expected summary output B");

    const inventoryA = fs.readFileSync(inventoryAPath, "utf8");
    const inventoryB = fs.readFileSync(inventoryBPath, "utf8");
    const summaryA = fs.readFileSync(summaryAPath, "utf8");
    const summaryB = fs.readFileSync(summaryBPath, "utf8");
    assertEq(inventoryA, inventoryB, "expected deterministic runtime inventory output");
    assertEq(summaryA, summaryB, "expected deterministic runtime summary output");

    const parsed = JSON.parse(inventoryA);
    assertEq(parsed.schema, "weftend.webRuntimeInventory/0", "schema mismatch");
    assertEq(parsed.captureMode, "strict_replay", "capture mode mismatch");
    assert(Array.isArray(parsed.scripts) && parsed.scripts.length >= 2, "expected multiple script records");
    assert(!inventoryA.includes("https://cdn.example.com/lib.js"), "inventory must not include raw URLs");
    assertEq(listStageResidue(outA).length, 0, "output A must not include staged residue");
    assertEq(listStageResidue(outB).length, 0, "output B must not include staged residue");
  });

  register("web-runtime capture supports live_observe mode", async () => {
    const tmp = makeTempDir();
    const inputDir = writeFixture(tmp);
    const outDir = path.join(tmp, "out_live");
    const res = await runCliCapture(["web-runtime", "capture", inputDir, "--mode", "live_observe", "--out", outDir]);
    assertEq(res.status, 0, `expected live_observe success\n${res.stderr}`);
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, "web_runtime_inventory_v0.json"), "utf8"));
    assertEq(parsed.captureMode, "live_observe", "expected live_observe mode in inventory");
  });

  register("web-runtime capture unsupported input writes evidence and exits 40", async () => {
    const tmp = makeTempDir();
    const inputPath = path.join(tmp, "plain.txt");
    const outDir = path.join(tmp, "out_unsupported");
    fs.writeFileSync(inputPath, "plain text", "utf8");
    const res = await runCliCapture(["web-runtime", "capture", inputPath, "--out", outDir]);
    assertEq(res.status, 40, `expected unsupported exit 40\n${res.stderr}`);
    const inventoryPath = path.join(outDir, "web_runtime_inventory_v0.json");
    const summaryPath = path.join(outDir, "web_runtime_summary.txt");
    assert(fs.existsSync(inventoryPath), "unsupported run must still write inventory");
    assert(fs.existsSync(summaryPath), "unsupported run must still write summary");
    const parsed = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
    assert(
      Array.isArray(parsed.reasonCodes) && parsed.reasonCodes.includes("WEB_RUNTIME_CAPTURE_UNSUPPORTED"),
      "unsupported run must emit WEB_RUNTIME_CAPTURE_UNSUPPORTED reason"
    );
    assertEq(listStageResidue(outDir).length, 0, "unsupported output must not include staged residue");
  });

  register("web-runtime capture fails closed when out path is an existing file", async () => {
    const tmp = makeTempDir();
    const inputDir = writeFixture(tmp);
    const outFile = path.join(tmp, "out.txt");
    fs.writeFileSync(outFile, "keep", "utf8");
    const res = await runCliCapture(["web-runtime", "capture", inputDir, "--out", outFile]);
    assertEq(res.status, 40, `expected out-file fail-closed exit\n${res.stderr}`);
    assert(res.stderr.includes("WEB_RUNTIME_OUT_PATH_NOT_DIRECTORY"), "expected out-file fail-closed code");
    assertEq(fs.readFileSync(outFile, "utf8"), "keep", "existing out file must remain unchanged");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`web_runtime_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}

