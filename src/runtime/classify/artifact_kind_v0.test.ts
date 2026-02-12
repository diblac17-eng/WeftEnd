/* src/runtime/classify/artifact_kind_v0.test.ts */
/**
 * Artifact classifier v0 tests.
 */

import { classifyArtifactKindV0 } from "./artifact_kind_v0";
import type { CaptureTreeV0 } from "../examiner/capture_tree_v0";

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
  if (actual !== expected) fail(`${msg}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-kind-"));

suite("runtime/classify artifact kind", () => {
  register("classifies file extensions deterministically", () => {
    const root = makeTempDir();
    const exe = path.join(root, "thing.exe");
    const dll = path.join(root, "thing.dll");
    const sys = path.join(root, "thing.sys");
    const drv = path.join(root, "thing.drv");
    const msi = path.join(root, "thing.msi");
    const lnk = path.join(root, "thing.lnk");
    const ps1 = path.join(root, "thing.ps1");
    [exe, dll, sys, drv, msi, lnk, ps1].forEach((p) => fs.writeFileSync(p, "x", "utf8"));

    assertEq(classifyArtifactKindV0(exe).artifactKind, "NATIVE_EXE", "expected NATIVE_EXE");
    assertEq(classifyArtifactKindV0(dll).artifactKind, "NATIVE_EXE", "expected NATIVE_EXE for dll");
    assertEq(classifyArtifactKindV0(sys).artifactKind, "NATIVE_EXE", "expected NATIVE_EXE for sys");
    assertEq(classifyArtifactKindV0(drv).artifactKind, "NATIVE_EXE", "expected NATIVE_EXE for drv");
    assertEq(classifyArtifactKindV0(msi).artifactKind, "NATIVE_MSI", "expected NATIVE_MSI");
    assertEq(classifyArtifactKindV0(lnk).artifactKind, "SHORTCUT_LNK", "expected SHORTCUT_LNK");
    assertEq(classifyArtifactKindV0(ps1).artifactKind, "SCRIPT_PS1", "expected SCRIPT_PS1");
  });

  register("classifies release directory first", () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, "release_manifest.json"), "{}", "utf8");
    fs.writeFileSync(path.join(root, "runtime_bundle.json"), "{}", "utf8");
    const result = classifyArtifactKindV0(root);
    assertEq(result.artifactKind, "RELEASE_DIR", "expected release dir");
    assertEq(result.entryHint, "release_manifest.json", "expected release manifest hint");
  });

  register("uses capture hints for web dir", () => {
    const root = makeTempDir();
    const capture = {
      kind: "dir",
      basePath: root,
      rootDigest: "fnv1a32:1",
      captureDigest: "fnv1a32:2",
      fileCount: 1,
      totalBytes: 1,
      entries: [{ path: "index.html", size: 1, digest: "fnv1a32:3" }],
      pathsSample: ["index.html"],
      issues: [],
      truncated: false,
    } as CaptureTreeV0;
    const a = classifyArtifactKindV0(root, capture);
    const b = classifyArtifactKindV0(root, capture);
    assertEq(a.artifactKind, "WEB_DIR", "expected WEB_DIR");
    assertEq(a.entryHint, "index.html", "expected index.html hint");
    assertEq(JSON.stringify(a), JSON.stringify(b), "classifier must be deterministic");
    assert(a.reasonCodes.length > 0, "expected reason code");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`artifact_kind_v0.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
