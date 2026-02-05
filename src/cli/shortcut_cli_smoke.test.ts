/* src/cli/shortcut_cli_smoke.test.ts */
import { runCliCapture } from "./cli_test_runner";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const os = require("os");

const isWin = process.platform === "win32";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-shortcut-"));

const containsPathLeak = (text: string): boolean => /[A-Za-z]:\\/.test(text) || /\\Users\\/.test(text);

const run = async () => {
  if (!isWin) {
    console.log("shortcut_cli_smoke: SKIP (non-windows)");
    return;
  }

  const temp = makeTempDir();
  const target = path.join(temp, "demo_app.exe");
  fs.writeFileSync(target, "stub", "utf8");
  const outLnk = path.join(temp, "Demo App (WeftEnd).lnk");

  const result = await runCliCapture(["shortcut", "create", "--target", target, "--out", outLnk]);
  if (result.status !== 0 && /SHORTCUT_POWERSHELL_BLOCKED/.test(result.stderr)) {
    console.log("shortcut_cli_smoke: SKIP (powershell spawn blocked)");
    return;
  }
  assert(result.status === 0, "expected shortcut create exit 0");
  assert(fs.existsSync(outLnk), "expected .lnk created");
  assert(!containsPathLeak(result.stdout), "stdout must not contain absolute paths");
  assert(!containsPathLeak(result.stderr), "stderr must not contain absolute paths");
};

run()
  .then(() => {
    console.log("shortcut_cli_smoke: PASS");
  })
  .catch((err) => {
    const msg = err?.message ? `\n${err.message}` : "";
    throw new Error(`shortcut_cli_smoke.test failed${msg}`);
  });
