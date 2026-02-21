/* src/tools/greenteam/workflow_verify360_contract.test.ts */
/**
 * Green Team: verify360 workflow contract.
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
  const relPath = ".github/workflows/weftend_verify360.yml";
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing workflow file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
};

suite("greenteam/workflow-verify360-contract", () => {
  register("verify360 workflow keeps strict managed gate contract", () => {
    const text = readWorkflow();
    assert(text.includes("name: weftend-verify360"), "workflow name mismatch");
    assert(text.includes("workflow_dispatch"), "verify360 workflow must be manually triggerable");
    assert(text.includes("npm run verify:360:release:managed"), "verify360 workflow must run strict managed verify gate");
    assert(
      text.includes("WEFTEND_RELEASE_DIR: tests/fixtures/release_demo"),
      "verify360 workflow must pin strict release fixture path"
    );
    assert(
      text.includes("WEFTEND_ALLOW_SKIP_RELEASE: \"\""),
      "verify360 workflow must clear skip-release override"
    );
    assert(text.includes("actions/upload-artifact@v4"), "verify360 workflow must upload gate artifacts");
    assert(text.includes("out/verify_360_release_managed"), "verify360 workflow artifact path mismatch");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`workflow_verify360_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
