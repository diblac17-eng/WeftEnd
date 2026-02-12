/* src/core/mint_package_v1.test.ts */
/**
 * Mint Package v1 canonical + validation tests.
 */

import { canonicalJSON } from "./canon";
import { computeMintDigestV1, normalizeMintPackageV1 } from "./mint_digest";
import { validateMintPackageV1 } from "./validate";
import type { WeftendMintPackageV1 } from "./types";

declare const require: any;
declare const process: any;
const fs = require("fs");
const path = require("path");

type TestFn = () => void;

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

const makeFixture = (): WeftendMintPackageV1 => {
  const mint: WeftendMintPackageV1 = {
    schema: "weftend.mint/1",
    profile: "generic",
    input: {
      kind: "file",
      rootDigest: "sha256:aaaaaaaa",
      fileCount: 1,
      totalBytes: 12,
    },
    capture: {
      captureDigest: "sha256:bbbbbbbb",
      paths: ["a.txt"],
    },
    observations: {
      fileKinds: { html: 0, js: 0, css: 0, json: 0, wasm: 0, media: 0, binary: 1, other: 0 },
      externalRefs: [],
      scriptsDetected: false,
      wasmDetected: false,
    },
    executionProbes: {
      strictAvailable: true,
      loadOnly: {
        status: "OK",
        reasonCodes: [],
        deniedCaps: {},
        attemptedCaps: {},
      },
    },
    grade: {
      status: "OK",
      reasonCodes: [],
      receipts: [],
    },
    digests: {
      mintDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      inputDigest: "sha256:aaaaaaaa",
      policyDigest: "-",
    },
    limits: {
      maxFiles: 5000,
      maxTotalBytes: 100000,
      maxFileBytes: 256000,
      maxExternalRefs: 200,
      maxScriptBytes: 2048,
      maxScriptSteps: 50,
    },
  };
  mint.digests.mintDigest = computeMintDigestV1(mint);
  const normalized = normalizeMintPackageV1(mint);
  normalized.digests.mintDigest = computeMintDigestV1(normalized);
  return normalized;
};

suite("core/mint_package_v1", () => {
  register("validateMintPackageV1 accepts a minimal valid package", () => {
    const pkg = makeFixture();
    const issues = validateMintPackageV1(pkg, "mint");
    assertEq(issues.length, 0, "expected valid mint package");
  });

  register("canonical bytes match fixture", () => {
    const pkg = makeFixture();
    const canonical = canonicalJSON(pkg);
    const fixturePath = path.join(process.cwd(), "tests", "fixtures", "mint_v1", "mint_package_v1_fixture.json");
    const expected = fs.readFileSync(fixturePath, "utf8").trim();
    assertEq(canonical, expected, "canonical mint package must match fixture");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`mint_package_v1.test.ts: ${t.name} failed${detail}`);
    }
  }
}
