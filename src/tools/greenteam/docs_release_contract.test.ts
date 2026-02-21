/* src/tools/greenteam/docs_release_contract.test.ts */
/**
 * Green Team: release-facing docs sync contract.
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

suite("greenteam/docs-release-contract", () => {
  register("release-facing docs keep verify workflow and guide links in sync", () => {
    const readme = readText("README.md");
    const quickstart = readText("docs/QUICKSTART.txt");
    const releaseNotes = readText("docs/RELEASE_NOTES.txt");
    const actionsGuide = readText("docs/GITHUB_ACTIONS.md");
    const releaseChecklist = readText("docs/RELEASE_CHECKLIST_ALPHA.md");

    assert(
      readme.includes(".github/workflows/weftend_artifact_meter.yml"),
      "README missing artifact meter workflow reference"
    );
    assert(
      readme.includes(".github/workflows/weftend_verify360.yml"),
      "README missing verify360 workflow reference"
    );
    assert(readme.includes("docs/GITHUB_ACTIONS.md"), "README missing GitHub Actions guide reference");

    assert(
      quickstart.includes(".github/workflows/weftend_artifact_meter.yml"),
      "QUICKSTART missing artifact meter workflow reference"
    );
    assert(
      quickstart.includes(".github/workflows/weftend_verify360.yml"),
      "QUICKSTART missing verify360 workflow reference"
    );
    assert(
      quickstart.includes("npm run verify:360:release:managed"),
      "QUICKSTART missing managed verify command reference"
    );

    assert(
      releaseNotes.includes(".github/workflows/weftend_artifact_meter.yml"),
      "RELEASE_NOTES missing artifact meter workflow reference"
    );
    assert(
      releaseNotes.includes(".github/workflows/weftend_verify360.yml"),
      "RELEASE_NOTES missing verify360 workflow reference"
    );

    assert(
      actionsGuide.includes(".github/workflows/weftend_artifact_meter.yml"),
      "GITHUB_ACTIONS guide missing artifact meter workflow reference"
    );
    assert(
      actionsGuide.includes(".github/workflows/weftend_verify360.yml"),
      "GITHUB_ACTIONS guide missing verify360 workflow reference"
    );
    assert(
      actionsGuide.includes("npm run verify:360:release:managed"),
      "GITHUB_ACTIONS guide missing managed verify command reference"
    );

    assert(
      releaseChecklist.includes(".github/workflows/weftend_artifact_meter.yml"),
      "RELEASE_CHECKLIST_ALPHA missing artifact meter workflow reference"
    );
    assert(
      releaseChecklist.includes(".github/workflows/weftend_verify360.yml"),
      "RELEASE_CHECKLIST_ALPHA missing verify360 workflow reference"
    );
    assert(
      releaseChecklist.includes("npm run verify:360:release:managed"),
      "RELEASE_CHECKLIST_ALPHA missing managed verify command reference"
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
        throw new Error(`docs_release_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
