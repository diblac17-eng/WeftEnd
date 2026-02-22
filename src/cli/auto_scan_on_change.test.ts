/* src/cli/auto_scan_on_change.test.ts */
export {};

import { runCliCapture } from "./cli_test_runner";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const assert = (cond: any, msg: string) => {
  if (!cond) throw new Error(msg);
};

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-watch-"));

const runWatchOnce = async (options: {
  target: string;
  outRoot: string;
  env?: Record<string, string>;
  debounceMs?: number;
}): Promise<number> =>
  new Promise((resolve, reject) => {
    const mainPath = path.join(process.cwd(), "dist", "src", "cli", "main.js");
    const args = [mainPath, "watch", options.target, "--out-root", options.outRoot, "--mode", "safe-run"];
    if (options.debounceMs) {
      args.push("--debounce-ms", String(options.debounceMs));
    }
    const env = {
      ...process.env,
      WEFTEND_WATCH_EXIT_AFTER_ONE: "1",
      WEFTEND_WATCH_DISABLE_POPUP: "1",
      ...(options.env || {}),
    };
    const child = spawn(process.execPath, args, { env, stdio: "ignore" });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error("watch timeout"));
    }, 10000);
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

suite("auto scan on change triggers safe-run", async () => {
  const root = makeTempDir();
  const target = path.join(root, "input");
  fs.mkdirSync(target, { recursive: true });
  const filePath = path.join(target, "sample.txt");
  fs.writeFileSync(filePath, "alpha", "utf8");

  const watchPromise = runWatchOnce({ target, outRoot: root, debounceMs: 200 });
  setTimeout(() => {
    fs.writeFileSync(filePath, "alpha beta", "utf8");
  }, 200);

  const exitCode = await watchPromise;
  assert(exitCode === 0, `expected watch exit 0, got ${exitCode}`);

  const libraryRoot = path.join(root, "Library");
  const runDir = findRunDir(libraryRoot);
  const triggerPath = path.join(runDir, "watch_trigger.txt");
  assert(fs.existsSync(triggerPath), "watch_trigger.txt missing");
  assert(!fs.existsSync(`${triggerPath}.stage`), "watch trigger stage file must not remain after finalize");
  const text = fs.readFileSync(triggerPath, "utf8");
  assert(text.includes("trigger=WATCH"), "expected trigger=WATCH");
});

suite("watch fails closed when out-root overlaps target", async () => {
  const root = makeTempDir();
  const target = path.join(root, "input");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "sample.txt"), "alpha", "utf8");

  const res = await runCliCapture(["watch", target, "--out-root", target, "--mode", "safe-run"]);
  assert(res.status === 40, `expected watch out-root overlap fail-closed\n${res.stderr}`);
  assert(
    res.stderr.includes("WATCH_OUT_ROOT_CONFLICTS_TARGET"),
    "expected watch out-root overlap explicit rejection code"
  );
  assert(!fs.existsSync(path.join(target, "Library")), "watch overlap conflict must not create Library inside target");
});

suite("watch fails closed when explicit out-root path is an existing file", async () => {
  const root = makeTempDir();
  const target = path.join(root, "input");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "sample.txt"), "alpha", "utf8");
  const outRootFile = path.join(root, "watch_out.txt");
  fs.writeFileSync(outRootFile, "keep", "utf8");

  const res = await runCliCapture(["watch", target, "--out-root", outRootFile, "--mode", "safe-run"]);
  assert(res.status === 40, `expected watch out-root file fail-closed\n${res.stderr}`);
  assert(res.stderr.includes("WATCH_OUT_ROOT_PATH_NOT_DIRECTORY"), "expected watch out-root file rejection code");
  assert(fs.readFileSync(outRootFile, "utf8") === "keep", "watch must not replace existing out-root file");
  assert(!fs.existsSync(path.join(root, "watch_out.txt", "Library")), "watch must not create Library under file out-root");
});

suite("watch fails closed when parent of explicit out-root path is a file", async () => {
  const root = makeTempDir();
  const target = path.join(root, "input");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "sample.txt"), "alpha", "utf8");
  const parentFile = path.join(root, "watch-parent.txt");
  fs.writeFileSync(parentFile, "keep", "utf8");
  const outRootPath = path.join(parentFile, "nested");

  const res = await runCliCapture(["watch", target, "--out-root", outRootPath, "--mode", "safe-run"]);
  assert(res.status === 40, `expected watch out-root parent-file fail-closed\n${res.stderr}`);
  assert(res.stderr.includes("WATCH_OUT_ROOT_PATH_PARENT_NOT_DIRECTORY"), "expected watch out-root parent-file rejection code");
  assert(fs.readFileSync(parentFile, "utf8") === "keep", "watch must not modify out-root parent file");
});
