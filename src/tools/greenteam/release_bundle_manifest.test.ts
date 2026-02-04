/* src/tools/greenteam/release_bundle_manifest.test.ts */
/**
 * Green Team: release bundle scripts and checklist present.
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

const expectFile = (relPath: string) => {
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing required file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
};

suite("greenteam/release-bundle", () => {
  register("release bundle script and checklist exist", () => {
    expectFile("tools/windows/weftend_release_zip.ps1");
    expectFile("docs/RELEASE_CHECKLIST_ALPHA.md");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`release_bundle_manifest.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
