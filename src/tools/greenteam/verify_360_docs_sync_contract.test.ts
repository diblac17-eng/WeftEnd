/* src/tools/greenteam/verify_360_docs_sync_contract.test.ts */
/**
 * Green Team: verify:360 docs-sync and etiquette target contract.
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

const readScript = (): string => {
  const relPath = "scripts/verify_360.js";
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing script file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
};

const readText = (relPath: string): string => {
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
};

suite("greenteam/verify360-docs-sync-contract", () => {
  register("verify:360 constrains WEFTEND_360_OUT_ROOT to repo out/", () => {
    const text = readScript();
    assert(text.includes("const OUT_BASE = path.join(root, \"out\");"), "verify_360 must define canonical repo out/ base");
    assert(
      text.includes("const assertOutRootWithinRepoOut = () => {"),
      "verify_360 must define out-root guard helper"
    );
    assert(
      text.includes("VERIFY360_OUT_ROOT_OUTSIDE_REPO_OUT:"),
      "verify_360 out-root guard must fail with explicit bounded reason token"
    );
    assert(text.includes("assertOutRootWithinRepoOut();"), "verify_360 must enforce out-root guard before run setup");
  });

  register("verify:360 keeps docs-sync and etiquette targets for immutable release discipline", () => {
    const text = readScript();

    assert(text.includes("CHANGELOG.md"), "verify_360 docs-sync/etiquette contract missing CHANGELOG.md target");
    assert(
      text.includes("docs/RELEASE_ANNOUNCEMENT.txt"),
      "verify_360 docs-sync/etiquette contract missing release announcement target"
    );
    assert(
      text.includes("docs/RELEASE_NOTES.txt"),
      "verify_360 docs-sync/etiquette contract missing release notes target"
    );
    assert(
      text.includes("docs/RELEASE_HISTORY.md"),
      "verify_360 docs-sync/etiquette contract missing release history target"
    );
    assert(text.includes("VERIFY360_DOC_SYNC_MISSING"), "verify_360 docs-sync fail code missing");
  });

  register("posting etiquette doc stays aligned with verify:360 etiquette targets", () => {
    const doc = readText("docs/GIT_POSTING_ETIQUETTE.md");
    assert(doc.includes("CHANGELOG.md"), "posting etiquette doc missing CHANGELOG target");
    assert(doc.includes("README.md"), "posting etiquette doc missing README target");
    assert(
      doc.includes("docs/RELEASE_ANNOUNCEMENT.txt"),
      "posting etiquette doc missing release announcement target"
    );
    assert(doc.includes("docs/RELEASE_NOTES.txt"), "posting etiquette doc missing release notes target");
    assert(doc.includes("docs/RELEASE_HISTORY.md"), "posting etiquette doc missing release history target");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`verify_360_docs_sync_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
