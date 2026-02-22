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
const outBase = path.join(root, "out");
const outRoot = process.env.WEFTEND_360_OUT_ROOT
  ? path.resolve(root, process.env.WEFTEND_360_OUT_ROOT)
  : path.join(outBase, "verify_360_release_managed");
const policyPath = path.join(outRoot, "adapter_maintenance.generated.json");
const releaseDirEnv = process.env.WEFTEND_RELEASE_DIR || "tests/fixtures/release_demo";
const releaseDirAbs = path.resolve(root, releaseDirEnv);

const run = (cmd, args, envExtra = {}, options = {}) => {
  const quiet = Boolean(options && options.quiet);
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: quiet ? "pipe" : "inherit",
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...envExtra },
  });
  if (quiet && (typeof res.status !== "number" || res.status !== 0)) {
    if (res.stdout) process.stdout.write(String(res.stdout));
    if (res.stderr) process.stderr.write(String(res.stderr));
  }
  return typeof res.status === "number" ? res.status : 1;
};

const npmCli = String(process.env.npm_execpath || "");
if (!npmCli) {
  console.error("Missing npm_execpath.");
  process.exit(1);
}

const outBaseResolved = path.resolve(outBase);
const outRootResolved = path.resolve(outRoot);
const outBasePrefix = outBaseResolved.endsWith(path.sep) ? outBaseResolved : `${outBaseResolved}${path.sep}`;
if (!(outRootResolved === outBaseResolved || outRootResolved.startsWith(outBasePrefix))) {
  console.error(`Managed verify out-root must stay under repo out/: ${path.relative(root, outRootResolved) || outRootResolved}`);
  process.exit(40);
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

if (!fs.existsSync(releaseDirAbs) || !fs.statSync(releaseDirAbs).isDirectory()) {
  console.error(`Missing strict release fixture directory: ${releaseDirEnv}`);
  process.exit(40);
}

const compileStatus = run(process.execPath, [npmCli, "run", "compile", "--silent"]);
if (compileStatus !== 0) process.exit(compileStatus);

const doctorStatus = run(process.execPath, [
  path.join("dist", "src", "cli", "main.js"),
  "adapter",
  "doctor",
  "--write-policy",
  policyPath,
  "--include-missing-plugins",
], {}, { quiet: true });
if (doctorStatus !== 0) process.exit(doctorStatus);
if (!fs.existsSync(policyPath) || !fs.statSync(policyPath).isFile()) {
  console.error(`Managed adapter policy file missing after doctor write: ${path.basename(policyPath)}`);
  process.exit(1);
}
const policyStagePath = `${policyPath}.stage`;
if (fs.existsSync(policyStagePath)) {
  console.error(`Managed adapter policy stage residue present: ${path.basename(policyStagePath)}`);
  process.exit(1);
}

const strictDoctorStatus = run(
  process.execPath,
  [path.join("dist", "src", "cli", "main.js"), "adapter", "doctor", "--strict"],
  { WEFTEND_ADAPTER_DISABLE_FILE: policyPath },
  { quiet: true }
);
if (strictDoctorStatus !== 0) process.exit(strictDoctorStatus);

const verifyStatus = run(
  process.execPath,
  [path.join("scripts", "verify_360.js")],
  {
    WEFTEND_360_OUT_ROOT: outRoot,
    WEFTEND_360_FAIL_ON_PARTIAL: "1",
    WEFTEND_360_AUDIT_STRICT: "1",
    WEFTEND_RELEASE_DIR: releaseDirEnv,
    WEFTEND_ALLOW_SKIP_RELEASE: "",
  }
);
process.exit(verifyStatus);
