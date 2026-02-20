// scripts/verify_360_release_managed.js
// Strict release gate with managed adapter maintenance policy.
// Flow:
// 1) clean dedicated out-root
// 2) compile dist
// 3) generate adapter maintenance policy (disable missing-plugin adapters)
// 4) run strict adapter doctor preflight with generated policy
// 5) run verify:360 strict gate without leaking adapter-disable policy into full test env

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const outRoot = process.env.WEFTEND_360_OUT_ROOT
  ? path.resolve(root, process.env.WEFTEND_360_OUT_ROOT)
  : path.join(root, "out", "verify_360_release_managed");
const policyPath = path.join(outRoot, "adapter_maintenance.generated.json");

const run = (cmd, args, envExtra = {}) => {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ...envExtra },
  });
  return typeof res.status === "number" ? res.status : 1;
};

const npmCli = String(process.env.npm_execpath || "");
if (!npmCli) {
  console.error("Missing npm_execpath.");
  process.exit(1);
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

const compileStatus = run(process.execPath, [npmCli, "run", "compile", "--silent"]);
if (compileStatus !== 0) process.exit(compileStatus);

const doctorStatus = run(process.execPath, [
  path.join("dist", "src", "cli", "main.js"),
  "adapter",
  "doctor",
  "--write-policy",
  policyPath,
  "--include-missing-plugins",
]);
if (doctorStatus !== 0) process.exit(doctorStatus);

const strictDoctorStatus = run(
  process.execPath,
  [path.join("dist", "src", "cli", "main.js"), "adapter", "doctor", "--strict"],
  { WEFTEND_ADAPTER_DISABLE_FILE: policyPath }
);
if (strictDoctorStatus !== 0) process.exit(strictDoctorStatus);

const verifyStatus = run(
  process.execPath,
  [path.join("scripts", "verify_360.js")],
  {
    WEFTEND_360_OUT_ROOT: outRoot,
    WEFTEND_360_FAIL_ON_PARTIAL: "1",
    WEFTEND_360_AUDIT_STRICT: "1",
  }
);
process.exit(verifyStatus);
