/* src/cli/container_scan_cli_smoke.test.ts */
/**
 * CLI container scan smoke tests (local-only, fail-closed preconditions).
 */

import { runCliCapture } from "./cli_test_runner";

declare const require: any;
declare const process: any;

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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-container-scan-"));
const listStageResidue = (root: string): string[] => {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
    entries.forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.name.endsWith(".stage")) out.push(path.relative(root, full).split(path.sep).join("/"));
      if (entry.isDirectory()) walk(full);
    });
  };
  walk(root);
  out.sort();
  return out;
};

suite("cli/container-scan", () => {
  register("container scan requires immutable digest reference", async () => {
    const outDir = makeTempDir();
    const res = await runCliCapture(["container", "scan", "ubuntu:latest", "--out", outDir]);
    assertEq(res.status, 40, `expected exit 40\n${res.stderr}`);
    const text = `${res.stdout}\n${res.stderr}`;
    assert(text.includes("[DOCKER_IMAGE_REF_NOT_IMMUTABLE]"), "expected immutable-ref denial");
    assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "receipt must be written when ref is mutable");
    assert(fs.existsSync(path.join(outDir, "operator_receipt.json")), "operator receipt must be written when ref is mutable");
    assert(fs.existsSync(path.join(outDir, "analysis", "capability_ledger_v0.json")), "capability ledger must be written when ref is mutable");
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    const capability = JSON.parse(fs.readFileSync(path.join(outDir, "analysis", "capability_ledger_v0.json"), "utf8"));
    assertEq(receipt.analysisVerdict, "DENY", "expected DENY analysis verdict for mutable ref");
    assertEq(capability.schema, "weftend.capabilityLedger/0", "expected capability ledger schema");
    assert(
      Array.isArray(capability.deniedCaps) &&
        capability.deniedCaps.some(
          (entry: any) =>
            entry?.capId === "adapter.selection.container" &&
            Array.isArray(entry?.reasonCodes) &&
            entry.reasonCodes.includes("DOCKER_IMAGE_REF_NOT_IMMUTABLE")
        ),
      "expected denied adapter selection capability for mutable ref"
    );
    const operator = JSON.parse(fs.readFileSync(path.join(outDir, "operator_receipt.json"), "utf8"));
    const entries = Array.isArray(operator?.receipts) ? operator.receipts : [];
    const hasReadmeEntry = entries.some((entry: any) => entry?.relPath === "weftend/README.txt");
    assert(hasReadmeEntry, "expected operator receipt to include README digest link");
    const warnings = Array.isArray(operator?.warnings) ? operator.warnings : [];
    assert(
      !warnings.includes("SAFE_RUN_EVIDENCE_DIGEST_MISMATCH"),
      "container evidence verification must not emit digest mismatch warnings in nominal fail-closed flow"
    );
    assert(!fs.existsSync(`${outDir}.stage`), "container scan stage directory must not remain after finalize");
    assertEq(listStageResidue(outDir).length, 0, "container scan output must not include staged file residue");
  });

  register("container scan blocks remote docker context", async () => {
    const outDir = makeTempDir();
    const immutableRef = `docker.io/library/ubuntu@sha256:${"a".repeat(64)}`;
    const res = await runCliCapture(["container", "scan", immutableRef, "--out", outDir], {
      env: { DOCKER_HOST: "tcp://example.invalid:2375" },
    });
    assertEq(res.status, 40, `expected exit 40\n${res.stderr}`);
    const text = `${res.stdout}\n${res.stderr}`;
    assert(text.includes("[DOCKER_REMOTE_CONTEXT_UNSUPPORTED]"), "expected remote-context denial");
    assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "receipt must be written on precondition failure");
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(receipt.analysisVerdict, "DENY", "expected DENY analysis verdict for remote context denial");
  });

  register("container scan fails closed when image is unavailable locally", async () => {
    const outDir = makeTempDir();
    const ref = `docker.io/library/weftend-never-local@sha256:${"b".repeat(64)}`;
    const res = await runCliCapture(["container", "scan", ref, "--out", outDir]);
    assertEq(res.status, 40, `expected exit 40\n${res.stderr}`);
    const text = `${res.stdout}\n${res.stderr}`;
    const expected =
      text.includes("[DOCKER_NOT_AVAILABLE]") ||
      text.includes("[DOCKER_IMAGE_NOT_LOCAL]") ||
      text.includes("[DOCKER_DAEMON_UNAVAILABLE]");
    assert(expected, `expected docker precondition code\n${text}`);
    assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "receipt must exist when scan preconditions fail");
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(receipt.analysisVerdict, "DENY", "expected DENY analysis verdict for local-image precondition failure");
  });

  register("container scan records orphan evidence warning on pre-existing unmanaged output", async () => {
    const outDir = makeTempDir();
    fs.writeFileSync(path.join(outDir, "stale_output.txt"), "stale", "utf8");
    const res = await runCliCapture(["container", "scan", "ubuntu:latest", "--out", outDir]);
    assertEq(res.status, 40, `expected exit 40\n${res.stderr}`);
    const operatorPath = path.join(outDir, "operator_receipt.json");
    assert(fs.existsSync(operatorPath), "operator receipt must exist");
    const operatorReceipt = JSON.parse(fs.readFileSync(operatorPath, "utf8"));
    const warnings = Array.isArray(operatorReceipt?.warnings) ? operatorReceipt.warnings : [];
    assert(
      warnings.includes("SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT"),
      "expected SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT warning for pre-existing unmanaged output"
    );
    assert(!fs.existsSync(path.join(outDir, "stale_output.txt")), "stale out-root files must be replaced during finalize");
    assert(!fs.existsSync(`${outDir}.stage`), "container scan stage directory must not remain after finalize");
    assertEq(listStageResidue(outDir).length, 0, "container scan output must not include staged file residue");
  });

  register("container scan fails closed when out path overlaps policy file", async () => {
    const tmp = makeTempDir();
    const outDir = path.join(tmp, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const policyPath = path.join(outDir, "policy.json");
    fs.copyFileSync(path.join(process.cwd(), "policies", "generic_default.json"), policyPath);
    const res = await runCliCapture(["container", "scan", "ubuntu@sha256:deadbeef", "--out", outDir, "--policy", policyPath]);
    assertEq(res.status, 40, `expected container policy/out conflict exit code\n${res.stderr}`);
    assert(res.stderr.includes("CONTAINER_SCAN_OUT_CONFLICTS_POLICY"), "expected container policy/out conflict code");
    assert(fs.existsSync(policyPath), "policy file must remain present after container policy/out conflict");
    assert(!fs.existsSync(`${outDir}.stage`), "container scan stage directory must not be created on policy/out conflict");
  });

  register("container scan fails closed when out path overlaps adapter maintenance policy file", async () => {
    const tmp = makeTempDir();
    const outDir = path.join(tmp, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const maintenancePolicyPath = path.join(outDir, "adapter_maintenance.json");
    fs.writeFileSync(maintenancePolicyPath, "{\"disabledAdapters\":[]}\n", "utf8");
    const res = await runCliCapture(["container", "scan", "ubuntu@sha256:deadbeef", "--out", outDir], {
      env: { WEFTEND_ADAPTER_DISABLE_FILE: maintenancePolicyPath },
    });
    assertEq(res.status, 40, `expected container adapter-policy-file/out conflict exit code\n${res.stderr}`);
    assert(
      res.stderr.includes("CONTAINER_SCAN_OUT_CONFLICTS_ADAPTER_POLICY_FILE"),
      "expected container adapter maintenance policy file conflict code"
    );
    assert(fs.existsSync(maintenancePolicyPath), "adapter maintenance policy file must remain present after conflict");
    assert(!fs.existsSync(`${outDir}.stage`), "container scan stage directory must not be created on adapter policy file conflict");
  });

  register("container scan honors maintenance disable policy", async () => {
    const outDir = makeTempDir();
    const immutableRef = `docker.io/library/ubuntu@sha256:${"c".repeat(64)}`;
    const res = await runCliCapture(["container", "scan", immutableRef, "--out", outDir], {
      env: { WEFTEND_ADAPTER_DISABLE: "container" },
    });
    assertEq(res.status, 40, `expected exit 40\n${res.stderr}`);
    const text = `${res.stdout}\n${res.stderr}`;
    assert(text.includes("[ADAPTER_TEMPORARILY_UNAVAILABLE]"), "expected maintenance disable denial");
    assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "receipt must exist when container adapter is disabled");
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, "safe_run_receipt.json"), "utf8"));
    assertEq(receipt.analysisVerdict, "DENY", "expected DENY analysis verdict for maintenance disable");
  });

  register("container scan fails closed on invalid maintenance file policy", async () => {
    const outDir = makeTempDir();
    const tmp = makeTempDir();
    const policyPath = path.join(tmp, "adapter_maintenance_invalid.json");
    fs.writeFileSync(policyPath, "{ invalid-json", "utf8");
    const immutableRef = `docker.io/library/ubuntu@sha256:${"d".repeat(64)}`;
    const res = await runCliCapture(["container", "scan", immutableRef, "--out", outDir], {
      env: { WEFTEND_ADAPTER_DISABLE_FILE: policyPath, WEFTEND_ADAPTER_DISABLE: undefined },
    });
    assertEq(res.status, 40, `expected exit 40\n${res.stderr}`);
    const text = `${res.stdout}\n${res.stderr}`;
    assert(text.includes("[ADAPTER_POLICY_INVALID]"), "expected invalid maintenance policy denial");
    assert(text.includes("[ADAPTER_POLICY_FILE_INVALID]"), "expected invalid maintenance file detail");
    assert(fs.existsSync(path.join(outDir, "safe_run_receipt.json")), "receipt must exist on invalid maintenance file policy");
  });

  register("container help usage prints and exits 1", async () => {
    const res = await runCliCapture(["container", "--help"]);
    assertEq(res.status, 1, `expected exit 1\n${res.stderr}`);
    const text = `${res.stdout}\n${res.stderr}`;
    assert(text.includes("weftend container scan"), "expected container usage text");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`container_scan_cli_smoke.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}

