/* src/cli/launchpad_cli_smoke.test.ts */
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

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-launchpad-"));

const containsPathLeak = (text: string): boolean => /[A-Za-z]:\\/.test(text) || /\\Users\\/.test(text);

const run = async () => {
  if (!isWin) {
    console.log("launchpad_cli_smoke: SKIP (non-windows)");
    return;
  }

  const root = makeTempDir();
  const targets = path.join(root, "Library", "Launchpad", "Targets");
  fs.mkdirSync(targets, { recursive: true });
  const fileTarget = path.join(targets, "demo_app.exe");
  fs.writeFileSync(fileTarget, "stub", "utf8");
  const folderTarget = path.join(targets, "demo_folder");
  fs.mkdirSync(folderTarget, { recursive: true });

  const result = await runCliCapture(["launchpad", "sync"], {
    env: { WEFTEND_LIBRARY_ROOT: root },
  });
  assert(result.status === 0, "expected launchpad sync exit 0");
  assert(!containsPathLeak(result.stdout), "stdout must not contain absolute paths");
  assert(!containsPathLeak(result.stderr), "stderr must not contain absolute paths");

  const shortcutsDir = path.join(root, "Library", "Launchpad", "Shortcuts");
  const shortcuts = fs.readdirSync(shortcutsDir).filter((n: string) => n.toLowerCase().endsWith(".lnk"));
  assert(shortcuts.length >= 2, "expected at least two shortcuts");
};

run()
  .then(() => {
    console.log("launchpad_cli_smoke: PASS");
  })
  .catch((err) => {
    const msg = err?.message ? `\n${err.message}` : "";
    throw new Error(`launchpad_cli_smoke.test failed${msg}`);
  });
