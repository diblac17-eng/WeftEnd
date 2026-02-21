// scripts/proofcheck_release.js
// Strict proofcheck wrapper that enforces real release smoke.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const releaseDirEnv = process.env.WEFTEND_RELEASE_DIR || "tests/fixtures/release_demo";
const releaseDirAbs = path.resolve(root, releaseDirEnv);

if (!fs.existsSync(releaseDirAbs) || !fs.statSync(releaseDirAbs).isDirectory()) {
  console.error(`Missing strict release fixture directory: ${releaseDirEnv}`);
  process.exit(40);
}

const result = spawnSync(process.execPath, [path.join("scripts", "proofcheck.js")], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    WEFTEND_RELEASE_DIR: releaseDirEnv,
    WEFTEND_ALLOW_SKIP_RELEASE: "",
  },
});

process.exit(typeof result.status === "number" ? result.status : 1);
