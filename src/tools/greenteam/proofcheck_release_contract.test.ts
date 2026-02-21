/* src/tools/greenteam/proofcheck_release_contract.test.ts */
/**
 * Green Team: strict proofcheck release wrapper contract.
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

function readText(relPath: string): string {
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
}

suite("greenteam/proofcheck-release-contract", () => {
  register("strict proofcheck wrapper enforces release smoke and clears skip override", () => {
    const script = readText("scripts/proofcheck_release.js");
    assert(
      script.includes("\"tests/fixtures/release_demo\""),
      "proofcheck_release must default to canonical release fixture path"
    );
    assert(
      script.includes("WEFTEND_RELEASE_DIR: releaseDirEnv"),
      "proofcheck_release must set WEFTEND_RELEASE_DIR explicitly"
    );
    assert(
      script.includes("WEFTEND_ALLOW_SKIP_RELEASE: \"\""),
      "proofcheck_release must clear skip-release override"
    );
    assert(
      script.includes("Missing strict release fixture directory"),
      "proofcheck_release must fail closed when release fixture is missing"
    );
    assert(
      script.includes("path.join(\"scripts\", \"proofcheck.js\")"),
      "proofcheck_release must invoke core proofcheck"
    );
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`proofcheck_release_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
