/* src/tools/greenteam/verify_360_audit_stage_residue.test.ts */
/**
 * Green Team: verify_360_audit stage-residue fail-closed behavior.
 */

export {};

declare const require: any;
declare const process: any;

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

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

const runAudit = (outRoot: string): { status: number; stdout: string; stderr: string } => {
  const env = {
    ...process.env,
    WEFTEND_360_OUT_ROOT: outRoot,
    WEFTEND_360_AUDIT_ALLOW_EMPTY: "1",
    WEFTEND_360_AUDIT_STRICT: "1",
  };
  const res = spawnSync(process.execPath, [path.join("scripts", "verify_360_audit.js")], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: typeof res.status === "number" ? res.status : 1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
};

suite("greenteam/verify-360-audit-stage-residue", () => {
  register("audit fails closed on .stage residue and passes after cleanup", () => {
    const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weftend-audit-stage-residue-"));
    const historyRoot = path.join(outRoot, "history");
    fs.mkdirSync(historyRoot, { recursive: true });
    const stageProbe = path.join(outRoot, "probe.stage");
    fs.mkdirSync(stageProbe, { recursive: true });
    fs.writeFileSync(path.join(stageProbe, "marker.txt"), "stage residue\n", "utf8");

    try {
      const failRun = runAudit(outRoot);
      const failText = `${failRun.stdout}\n${failRun.stderr}`;
      assert(failRun.status !== 0, "expected strict audit to fail when .stage residue is present");
      assert(
        failText.includes("VERIFY360_AUDIT_STAGE_RESIDUE_PRESENT"),
        "expected stage residue fail code in audit output"
      );

      fs.rmSync(stageProbe, { recursive: true, force: true });
      const passRun = runAudit(outRoot);
      const passText = `${passRun.stdout}\n${passRun.stderr}`;
      assert(passRun.status === 0, "expected strict audit to pass after stage residue cleanup");
      assert(passText.includes("verify:360:audit PASS"), "expected strict audit pass summary");
    } finally {
      fs.rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`verify_360_audit_stage_residue.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}

