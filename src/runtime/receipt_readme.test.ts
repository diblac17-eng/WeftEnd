/* src/runtime/receipt_readme.test.ts */
/**
 * Receipt README write-path tests (deterministic).
 */

import { buildReceiptReadmeV0, writeReceiptReadmeV0 } from "./receipt_readme";

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-readme-"));

suite("runtime/receipt_readme", () => {
  register("build output is deterministic and ordered", () => {
    const build = {
      algo: "sha256",
      digest: "sha256:11111111",
      source: "NODE_MAIN_JS",
      reasonCodes: ["BETA", "ALPHA", "ALPHA"],
    } as any;
    const a = buildReceiptReadmeV0(build, 0);
    const b = buildReceiptReadmeV0(build, 0);
    assertEq(a, b, "README text must be deterministic");
    assert(a.includes("weftendBuild.reasonCodes=ALPHA,BETA"), "reason codes must be stable and unique");
  });

  register("write path uses staged finalize with no stage residue", () => {
    const outRoot = makeTempDir();
    const target = path.join(outRoot, "weftend", "README.txt");
    const stagePath = `${target}.stage`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "stale", "utf8");
    fs.writeFileSync(stagePath, "stale-stage", "utf8");

    const build = { algo: "sha256", digest: "sha256:22222222", source: "NODE_MAIN_JS" } as any;
    const writtenPath = writeReceiptReadmeV0(outRoot, build, 0);
    assertEq(path.normalize(writtenPath), path.normalize(target), "write target path mismatch");
    assert(fs.existsSync(target), "expected final README");
    assert(!fs.existsSync(stagePath), "README stage file must not remain after finalize");

    const text = fs.readFileSync(target, "utf8");
    assert(text.includes("schemaVersion=0"), "expected schemaVersion line");
    assert(text.includes("weftendBuild.digest=sha256:22222222"), "expected digest line");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`receipt_readme.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}

