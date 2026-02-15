/* src/runtime/adapters/artifact_adapter_v1.test.ts */

import { captureTreeV0 } from "../examiner/capture_tree_v0";
import { runArtifactAdapterV1 } from "./artifact_adapter_v1";

declare const require: any;
declare const process: any;
declare const Buffer: any;

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

const writeStoredZip = (outPath: string, files: Array<{ name: string; text: string }>): void => {
  const localParts: any[] = [];
  const centralParts: any[] = [];
  let localOffset = 0;
  files.forEach((file) => {
    const nameBuf = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const dataBuf = Buffer.from(file.text, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mtime
    local.writeUInt16LE(0, 12); // mdate
    local.writeUInt32LE(0, 14); // crc32 (not required for adapter parser)
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12); // mtime
    central.writeUInt16LE(0, 14); // mdate
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuf);

    localOffset += local.length + nameBuf.length + dataBuf.length;
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(files.length, 8); // records on disk
  eocd.writeUInt16LE(files.length, 10); // total records
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(localOffset, 16); // central offset
  eocd.writeUInt16LE(0, 20); // comment len
  fs.writeFileSync(outPath, Buffer.concat([...localParts, ...centralParts, eocd]));
};

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

  {
    const tmp = mkTmp();
    const vsix = path.join(tmp, "demo.vsix");
    writeStoredZip(vsix, [
      {
        name: "extension/manifest.json",
        text: JSON.stringify({
          manifest_version: 3,
          name: "demozip",
          version: "1.0.0",
          permissions: ["storage"],
          host_permissions: ["https://example.test/*"],
          content_scripts: [{ matches: ["https://example.test/*"], js: ["content.js"] }],
          update_url: "https://updates.example.test/service/update2/crx",
        }),
      },
    ]);
    const capture = captureTreeV0(vsix, limits);
    const res = runArtifactAdapterV1({ selection: "extension", enabledPlugins: [], inputPath: vsix, capture });
    assert(res.ok, "extension adapter should parse zipped manifest");
    assertEq(res.summary?.sourceClass, "extension", "zipped extension class mismatch");
    assert((res.summary?.counts.permissionCount ?? 0) > 0, "zipped extension permission count missing");
  }

  {
    const tmp = mkTmp();
    const msix = path.join(tmp, "demo.msix");
    writeStoredZip(msix, [
      {
        name: "AppxManifest.xml",
        text: "<Package><Capabilities><Capability Name=\"internetClient\"/></Capabilities></Package>",
      },
      {
        name: "scripts/install.ps1",
        text: "Write-Host install",
      },
    ]);
    const capture = captureTreeV0(msix, limits);
    const res = runArtifactAdapterV1({ selection: "package", enabledPlugins: [], inputPath: msix, capture });
    assert(res.ok, "package adapter should parse msix metadata");
    assertEq(res.summary?.sourceClass, "package", "msix package class mismatch");
    assert((res.summary?.counts.manifestCount ?? 0) > 0, "msix manifest count missing");
    assert((res.summary?.counts.scriptHintCount ?? 0) > 0, "msix script hint count missing");
    assert((res.summary?.counts.permissionHintCount ?? 0) > 0, "msix permission hint count missing");
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
