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

const readText = (relPath: string): string => {
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing required file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
};

suite("greenteam/release-bundle", () => {
  register("release bundle script and checklist exist", () => {
    expectFile("tools/windows/weftend_release_zip.ps1");
    expectFile("scripts/proofcheck_release.js");
    expectFile("docs/RELEASE_CHECKLIST_ALPHA.md");
    expectFile("docs/RELEASE_HISTORY.md");
  });

  register("release zip script keeps immutable change-log sidecar contract", () => {
    const script = readText("weftend_release_zip.ps1");
    assert(script.includes("Set-StrictMode -Version Latest"), "release zip script must enforce strict mode");
    assert(script.includes("${zipPath}.stage"), "release zip output must stage/finalize zip path");
    assert(script.includes("${shaPath}.stage"), "release zip output must stage/finalize sha sidecar path");
    assert(script.includes("function Copy-SidecarFileAtomic"), "release zip script must provide atomic sidecar copy helper");
    assert(
      script.includes("function Copy-RequiredSidecarFileAtomic"),
      "release zip script must provide fail-closed required sidecar copy helper"
    );
    assert(
      script.includes("Required release sidecar missing:"),
      "release zip script must fail closed when required sidecar docs are missing"
    );
    assert(
      script.includes("function Assert-NoReleaseStageResidue"),
      "release zip script must enforce no-stage-residue invariant helper"
    );
    assert(
      script.includes("function Remove-ReleaseStageDirIfPresent"),
      "release zip script must provide best-effort release stage cleanup helper"
    );
    assert(script.includes("function Assert-ReleaseBundleSet"), "release zip script must enforce post-prune bundle-set contract");
    assert(
      script.includes("Release bundle set mismatch after prune."),
      "release zip script must fail closed on stale/missing release zip/hash set after prune"
    );
    assert(script.includes("} finally {"), "release zip script must use finally cleanup for stage dirs");
    assert(
      script.includes("Remove-ReleaseStageDirIfPresent -PathToRemove $portableStagePath"),
      "release zip script finally cleanup must include portable stage dir"
    );
    assert(
      script.includes("Remove-ReleaseStageDirIfPresent -PathToRemove $stagePath"),
      "release zip script finally cleanup must include standard stage dir"
    );
    assert(
      script.includes("-Recurse -File -Filter \"*.stage\""),
      "release zip script must scan release output for staged file residue"
    );
    assert(
      script.includes("-Directory -Filter \"__stage_release*\""),
      "release zip script must scan release output for staged directory residue"
    );
    assert(script.includes("${DestinationPath}.stage"), "release zip script sidecar copies must stage before finalize");
    assert(
      script.includes("Assert-NoReleaseStageResidue -OutDirPath $outAbs"),
      "release zip script must check stage residue around release output flow"
    );
    assert(
      script.includes("Assert-ReleaseBundleSet -OutDirPath $outAbs -ExpectedZipNames $keepZips -ExpectedHashNames $keepHashes"),
      "release zip script must validate exact release zip/hash set after prune"
    );
    assert(script.includes("\"CHANGELOG.md\","), "release zip includeSingles must include CHANGELOG.md");
    assert(script.includes("-Label \"CHANGELOG.md\""), "release zip sidecar copy must include CHANGELOG.md");
    assert(script.includes("-Label \"RELEASE_NOTES.txt\""), "release zip sidecar copy must include RELEASE_NOTES.txt");
    assert(
      script.includes("-Label \"RELEASE_ANNOUNCEMENT.txt\""),
      "release zip sidecar copy must include RELEASE_ANNOUNCEMENT.txt"
    );
    assert(script.includes("-Label \"QUICKSTART.txt\""), "release zip sidecar copy must include QUICKSTART.txt");
    assert(
      script.includes("-Label \"RELEASE_CHECKLIST_ALPHA.md\""),
      "release zip sidecar copy must include RELEASE_CHECKLIST_ALPHA.md"
    );
    assert(script.includes("-Label \"RELEASE_HISTORY.md\""), "release zip sidecar copy must include RELEASE_HISTORY.md");
    assert(
      !script.includes("docs/RELEASE_NOTES.txt not found, skipping"),
      "release zip script must not silently skip release notes sidecar"
    );
    assert(
      !script.includes("docs/RELEASE_ANNOUNCEMENT.txt not found, skipping"),
      "release zip script must not silently skip release announcement sidecar"
    );
    assert(
      !script.includes("docs/QUICKSTART.txt not found, skipping"),
      "release zip script must not silently skip quickstart sidecar"
    );
    assert(
      !script.includes("docs/RELEASE_CHECKLIST_ALPHA.md not found, skipping"),
      "release zip script must not silently skip release checklist sidecar"
    );
    assert(
      !script.includes("docs/RELEASE_HISTORY.md not found, skipping"),
      "release zip script must not silently skip release history sidecar"
    );
    assert(!script.includes("CHANGELOG.md not found, skipping"), "release zip script must not silently skip changelog sidecar");

    const checklist = readText("docs/RELEASE_CHECKLIST_ALPHA.md");
    assert(checklist.includes("CHANGELOG.md"), "release checklist required artifact set must include CHANGELOG.md");
    assert(checklist.includes("RELEASE_NOTES.txt"), "release checklist required artifact set must include RELEASE_NOTES.txt");
    assert(
      checklist.includes("RELEASE_ANNOUNCEMENT.txt"),
      "release checklist required artifact set must include RELEASE_ANNOUNCEMENT.txt"
    );
    assert(checklist.includes("QUICKSTART.txt"), "release checklist required artifact set must include QUICKSTART.txt");
    assert(
      checklist.includes("RELEASE_CHECKLIST_ALPHA.md"),
      "release checklist required artifact set must include RELEASE_CHECKLIST_ALPHA.md"
    );
    assert(checklist.includes("RELEASE_HISTORY.md"), "release checklist required artifact set must include RELEASE_HISTORY.md");
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
