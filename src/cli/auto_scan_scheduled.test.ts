/* src/cli/auto_scan_scheduled.test.ts */
export {};

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const assert = (cond: any, msg: string) => {
  if (!cond) throw new Error(msg);
};

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-watch-poll-"));

const runWatchOnce = async (options: {
  target: string;
  outRoot: string;
  env?: Record<string, string>;
}): Promise<number> =>
  new Promise((resolve, reject) => {
    const mainPath = path.join(process.cwd(), "dist", "src", "cli", "main.js");
    const args = [mainPath, "watch", options.target, "--out-root", options.outRoot, "--mode", "safe-run"];
    const env = {
      ...process.env,
      WEFTEND_WATCH_EXIT_AFTER_ONE: "1",
      WEFTEND_WATCH_DISABLE_POPUP: "1",
      WEFTEND_WATCH_FORCE_POLL: "1",
      WEFTEND_WATCH_POLL_INTERVAL_MS: "250",
      ...(options.env || {}),
    };
    const child = spawn(process.execPath, args, { env, stdio: "ignore" });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error("watch poll timeout"));
    }, 12000);
    child.on("exit", (code: number | null) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

const findRunDir = (libraryRoot: string): string => {
  const targets = fs.readdirSync(libraryRoot);
  assert(targets.length > 0, "expected target folder");
  const targetDir = path.join(libraryRoot, targets[0]);
  const runs = fs.readdirSync(targetDir).filter((name: string) => name.startsWith("run_"));
  assert(runs.length > 0, "expected run folder");
  return path.join(targetDir, runs[0]);
};

const suite = (name: string, fn: () => Promise<void> | void) => {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch((err) => {
      console.error(`not ok - ${name}`);
      throw err;
    });
};

suite("auto scan poll mode triggers safe-run", async () => {
  const root = makeTempDir();
  const target = path.join(root, "input");
  fs.mkdirSync(target, { recursive: true });
  const filePath = path.join(target, "sample.txt");
  fs.writeFileSync(filePath, "alpha", "utf8");

  const watchPromise = runWatchOnce({ target, outRoot: root });
  setTimeout(() => {
    fs.writeFileSync(filePath, "alpha beta", "utf8");
  }, 400);

  const exitCode = await watchPromise;
  assert(exitCode === 0, `expected watch exit 0, got ${exitCode}`);

  const libraryRoot = path.join(root, "Library");
  const runDir = findRunDir(libraryRoot);
  const triggerPath = path.join(runDir, "watch_trigger.txt");
  assert(fs.existsSync(triggerPath), "watch_trigger.txt missing");
  assert(!fs.existsSync(`${triggerPath}.stage`), "watch trigger stage file must not remain after finalize");
  const text = fs.readFileSync(triggerPath, "utf8");
  assert(text.includes("watchMode=POLL"), "expected poll watchMode");
});
