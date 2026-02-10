/* src/runtime/config_v0.test.ts */

import { loadWeftendConfigV0 } from "./config_v0";

declare const require: any;

const fs = require("fs");
const path = require("path");
const os = require("os");

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-config-"));

const writeConfig = (root: string, contents: string) => {
  const dir = path.join(root, ".weftend");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), contents, "utf8");
};

const assert = (cond: any, msg: string) => {
  if (!cond) throw new Error(msg);
};

const assertEq = (a: any, b: any, msg: string) => {
  if (a !== b) throw new Error(`${msg} (got ${a}, expected ${b})`);
};

const suite = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
};

suite("config_v0 defaults when missing", () => {
  const root = makeTempDir();
  const res = loadWeftendConfigV0(root);
  assert(res.ok, "expected ok");
  assertEq(res.exists, false, "expected exists=false");
  assertEq(res.config.autoScan.enabled, true, "expected autoScan.enabled default");
  assertEq(res.config.autoScan.debounceMs, 750, "expected debounce default");
  assertEq(res.config.autoScan.pollIntervalMs, 2000, "expected poll default");
  assertEq(res.config.gateMode.hostRun, "off", "expected gateMode off");
});

suite("config_v0 rejects unknown keys", () => {
  const root = makeTempDir();
  writeConfig(root, JSON.stringify({ nope: true }, null, 2));
  const res = loadWeftendConfigV0(root);
  assert(!res.ok, "expected invalid config");
  assertEq(res.reasonCodes[0], "CONFIG_INVALID", "expected CONFIG_INVALID");
});

suite("config_v0 bounds checks numbers", () => {
  const root = makeTempDir();
  writeConfig(
    root,
    JSON.stringify({ autoScan: { enabled: true, debounceMs: 20, pollIntervalMs: 60000 } }, null, 2)
  );
  const res = loadWeftendConfigV0(root);
  assert(!res.ok, "expected invalid bounds");
  assertEq(res.reasonCodes[0], "CONFIG_INVALID", "expected CONFIG_INVALID");
});

