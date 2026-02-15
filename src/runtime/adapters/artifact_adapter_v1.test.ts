/* src/runtime/adapters/artifact_adapter_v1.test.ts */

import { captureTreeV0 } from "../examiner/capture_tree_v0";
import { runArtifactAdapterV1 } from "./artifact_adapter_v1";

declare const require: any;
declare const process: any;

const fs = require("fs");
const os = require("os");
const path = require("path");

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
};

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-adapter-v1-"));

const limits = {
  maxFiles: 20000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxPathBytes: 256,
};

const run = (): void => {
  {
    const input = path.join(process.cwd(), "tests", "fixtures", "intake", "tampered_manifest", "tampered.zip");
    const captureA = captureTreeV0(input, limits);
    const captureB = captureTreeV0(input, limits);
    const resA = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: input, capture: captureA });
    const resB = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: input, capture: captureB });
    assert(resA.ok, "archive adapter should succeed");
    assert(resB.ok, "archive adapter should succeed");
    assertEq(JSON.stringify(resA.summary), JSON.stringify(resB.summary), "archive adapter summary should be deterministic");
    assertEq(resA.adapter?.adapterId, "archive_adapter_v1", "archive adapter id mismatch");
  }

  {
    const tmp = mkTmp();
    const tgz = path.join(tmp, "sample.tgz");
    fs.writeFileSync(tgz, "not-a-real-tgz", "utf8");
    const capture = captureTreeV0(tgz, limits);
    const res = runArtifactAdapterV1({ selection: "archive", enabledPlugins: [], inputPath: tgz, capture });
    assert(!res.ok, "archive tgz without plugin should fail closed");
    assertEq(res.failCode, "ARCHIVE_PLUGIN_REQUIRED", "expected plugin required code");
  }

  {
    const tmp = mkTmp();
    fs.writeFileSync(
      path.join(tmp, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "demo",
        version: "1.0.0",
        permissions: ["storage"],
        host_permissions: ["https://example.com/*"],
        content_scripts: [{ matches: ["https://example.com/*"], js: ["content.js"] }],
        update_url: "https://updates.example.com/service/update2/crx",
      }),
      "utf8"
    );
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: tmp, capture });
    assert(res.ok, "extension adapter should succeed for unpacked manifest dir");
    assertEq(res.adapter?.adapterId, "extension_adapter_v1", "extension adapter id mismatch");
    assert((res.summary?.counts.permissionCount ?? 0) > 0, "expected permission count");
  }

  {
    const tmp = mkTmp();
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "build.yml"),
      "name: ci\non: [push]\njobs:\n  build:\n    runs-on: self-hosted\n    steps:\n      - uses: actions/checkout@main\n      - run: echo ${{ secrets.TOKEN }}\n",
      "utf8"
    );
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "cicd", enabledPlugins: [], inputPath: tmp, capture });
    assert(res.ok, "iac/cicd adapter should succeed for workflow");
    assertEq(res.summary?.sourceClass, "cicd", "expected cicd source class");
    assert((res.summary?.reasonCodes ?? []).includes("CICD_ADAPTER_V1"), "expected CICD_ADAPTER_V1 reason");
  }
};

try {
  run();
  console.log("artifact_adapter_v1.test: PASS");
} catch (error) {
  console.error("artifact_adapter_v1.test: FAIL");
  console.error(error);
  process.exit(1);
}
