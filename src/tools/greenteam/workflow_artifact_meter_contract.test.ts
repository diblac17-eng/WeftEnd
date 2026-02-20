/* src/tools/greenteam/workflow_artifact_meter_contract.test.ts */
/**
 * Green Team: GitHub Actions artifact-meter workflow contract.
 */

export {};

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

type TestFn = () => void | Promise<void>;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
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

const readWorkflow = (): string => {
  const relPath = ".github/workflows/weftend_artifact_meter.yml";
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing workflow file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
};

suite("greenteam/workflow-artifact-meter-contract", () => {
  register("workflow keeps analysis-only artifact meter contract", () => {
    const text = readWorkflow();
    assert(text.includes("name: weftend-artifact-meter"), "workflow name mismatch");
    assert(text.includes("--withhold-exec"), "workflow must enforce analysis-only safe-run");
    assert(text.includes("actions/upload-artifact@v4"), "workflow must upload deterministic outputs");
    assert(text.includes("out/ci_meter"), "workflow artifact path must be out/ci_meter");
    assert(!/\bdocker\s+pull\b/i.test(text), "workflow must not perform docker pull");
    assert(!/\bdocker\s+login\b/i.test(text), "workflow must not perform docker login");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`workflow_artifact_meter_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
