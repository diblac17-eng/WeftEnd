/* src/tools/greenteam/verify_release_managed_contract.test.ts */
/**
 * Green Team: managed strict release helper contract.
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
  const relPath = "scripts/verify_360_release_managed.js";
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing script file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
};

suite("greenteam/verify-release-managed-contract", () => {
  register("managed release helper keeps strict preflight and no env leakage contract", () => {
    const text = readScript();
    assert(text.includes("adapter_maintenance.generated.json"), "managed policy file contract missing");
    assert(text.includes("const outBase = path.join(root, \"out\");"), "managed verify must derive canonical repo out/ base");
    assert(
      text.includes("Managed verify out-root must stay under repo out/:"),
      "managed verify must fail closed when WEFTEND_360_OUT_ROOT escapes repo out/"
    );
    assert(
      text.includes("process.exit(40);"),
      "managed verify must use precondition exit code for out-root path guard"
    );
    assert(text.includes("--include-missing-plugins"), "managed policy generation must include missing plugins");
    assert(
      text.includes("Managed adapter policy file missing after doctor write"),
      "managed verify must fail closed if generated adapter policy file is missing"
    );
    assert(
      text.includes("Managed adapter policy stage residue present"),
      "managed verify must fail closed on generated adapter policy stage residue"
    );
    assert(text.includes("const policyStagePath = `${policyPath}.stage`;"), "managed verify must check policy .stage residue path");
    assert(
      text.includes("WEFTEND_ADAPTER_DISABLE_FILE: policyPath"),
      "strict adapter doctor preflight must use generated maintenance policy"
    );
    assert(text.includes("WEFTEND_360_FAIL_ON_PARTIAL: \"1\""), "managed verify must enforce fail-on-partial");
    assert(text.includes("WEFTEND_360_AUDIT_STRICT: \"1\""), "managed verify must enforce strict audit");
    assert(text.includes("WEFTEND_RELEASE_DIR: releaseDirEnv"), "managed verify must enforce explicit release fixture path");
    assert(
      text.includes("WEFTEND_ALLOW_SKIP_RELEASE: \"\""),
      "managed verify must clear skip-release override to prevent silent release-smoke skip"
    );
    assert(
      text.includes("Missing strict release fixture directory"),
      "managed verify must fail closed when strict release fixture directory is missing"
    );
    assert(
      text.includes("\"tests/fixtures/release_demo\""),
      "managed verify default release fixture path must stay canonicalized (forward slash) for privacy-lint stability"
    );

    const verifyInvocationIdx = text.indexOf("[path.join(\"scripts\", \"verify_360.js\")]");
    assert(verifyInvocationIdx >= 0, "managed verify invocation missing");
    const verifySlice = text.slice(verifyInvocationIdx, Math.min(text.length, verifyInvocationIdx + 700));
    assert(
      !verifySlice.includes("WEFTEND_ADAPTER_DISABLE_FILE"),
      "managed verify invocation must not leak adapter disable policy into full verify env"
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
        throw new Error(`verify_release_managed_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
