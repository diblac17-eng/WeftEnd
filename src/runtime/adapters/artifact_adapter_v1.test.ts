/* src/runtime/adapters/artifact_adapter_v1.test.ts */

import { captureTreeV0 } from "../examiner/capture_tree_v0";
import { runArtifactAdapterV1 } from "./artifact_adapter_v1";

declare const require: any;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
};

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-adapter-v1-"));

const runCmd = (cmd: string, args: string[], cwd?: string): { ok: boolean; stdout: string; stderr: string } => {
  const res = childProcess.spawnSync(cmd, args, {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: typeof res.status === "number" && res.status === 0,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
};

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

const writeSimpleTar = (outPath: string, files: Array<{ name: string; text: string }>): void => {
  const blocks: any[] = [];
  const pushHeader = (name: string, size: number) => {
    const header = Buffer.alloc(512, 0);
    const nameBuf = Buffer.from(name, "utf8");
    nameBuf.copy(header, 0, 0, Math.min(nameBuf.length, 100));
    Buffer.from("0000777\0", "ascii").copy(header, 100);
    Buffer.from("0000000\0", "ascii").copy(header, 108);
    Buffer.from("0000000\0", "ascii").copy(header, 116);
    const sizeOct = size.toString(8).padStart(11, "0");
    Buffer.from(`${sizeOct}\0`, "ascii").copy(header, 124);
    Buffer.from("00000000000\0", "ascii").copy(header, 136);
    for (let i = 148; i < 156; i += 1) header[i] = 0x20; // checksum placeholder
    header[156] = "0".charCodeAt(0);
    Buffer.from("ustar\0", "ascii").copy(header, 257);
    Buffer.from("00", "ascii").copy(header, 263);
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    const chk = sum.toString(8).padStart(6, "0");
    Buffer.from(`${chk}\0 `, "ascii").copy(header, 148);
    blocks.push(header);
  };
  files.forEach((file) => {
    const data = Buffer.from(file.text, "utf8");
    pushHeader(file.name.replace(/\\/g, "/"), data.length);
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad, 0));
  });
  blocks.push(Buffer.alloc(1024, 0));
  fs.writeFileSync(outPath, Buffer.concat(blocks));
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
    const wfDir = path.join(tmp, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "pinned.yml"),
      "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567\n",
      "utf8"
    );
    const capture = captureTreeV0(tmp, limits);
    const res = runArtifactAdapterV1({ selection: "cicd", enabledPlugins: [], inputPath: tmp, capture });
    assert(res.ok, "cicd adapter should succeed for pinned workflow");
    assertEq(res.summary?.sourceClass, "cicd", "expected cicd class for pinned workflow");
    assertEq(res.summary?.counts.cicdUnpinnedActionCount, 0, "pinned action should not increment unpinned count");
    assert((res.summary?.counts.cicdActionRefCount ?? 0) > 0, "action ref count should be captured");
  }

  {
    const tmp = mkTmp();
    const tf = path.join(tmp, "main.tf");
    fs.writeFileSync(
      tf,
      "module \"vpc\" {\n  source = \"git::https://github.com/acme/terraform-vpc.git\"\n}\n",
      "utf8"
    );
    const capture = captureTreeV0(tf, limits);
    const res = runArtifactAdapterV1({ selection: "iac", enabledPlugins: [], inputPath: tf, capture });
    assert(res.ok, "iac adapter should succeed for terraform file");
    assertEq(res.summary?.sourceClass, "iac", "expected iac class");
    assert((res.summary?.reasonCodes ?? []).includes("IAC_REMOTE_MODULE_REFERENCE"), "expected remote module reason");
    assert((res.summary?.counts.remoteModulePatternCount ?? 0) > 0, "expected remote module pattern count");
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

  {
    const tmp = mkTmp();
    const docm = path.join(tmp, "demo.docm");
    writeStoredZip(docm, [
      { name: "word/document.xml", text: "<w:document/>" },
      { name: "word/vbaProject.bin", text: "macro-data" },
      { name: "word/embeddings/oleObject1.bin", text: "ole-data" },
      {
        name: "word/_rels/document.xml.rels",
        text: "<Relationships><Relationship TargetMode=\"External\" Target=\"https://cdn.example.test/payload\"/></Relationships>",
      },
    ]);
    const capture = captureTreeV0(docm, limits);
    const res = runArtifactAdapterV1({ selection: "document", enabledPlugins: [], inputPath: docm, capture });
    assert(res.ok, "document adapter should parse docm zip signals");
    assertEq(res.summary?.sourceClass, "document", "docm source class mismatch");
    assert((res.summary?.counts.activeContentCount ?? 0) > 0, "docm active content count missing");
    assert((res.summary?.counts.embeddedObjectCount ?? 0) > 0, "docm embedded object count missing");
    assert((res.summary?.counts.externalLinkCount ?? 0) > 0, "docm external link count missing");
  }

  {
    const tmp = mkTmp();
    const ociDir = path.join(tmp, "oci_layout");
    fs.mkdirSync(path.join(ociDir, "blobs", "sha256"), { recursive: true });
    fs.writeFileSync(path.join(ociDir, "oci-layout"), "{\"imageLayoutVersion\":\"1.0.0\"}\n", "utf8");
    fs.writeFileSync(
      path.join(ociDir, "index.json"),
      JSON.stringify({ schemaVersion: 2, manifests: [{ mediaType: "x" }, { mediaType: "y" }] }),
      "utf8"
    );
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "a"), "x", "utf8");
    fs.writeFileSync(path.join(ociDir, "blobs", "sha256", "b"), "y", "utf8");
    const capture = captureTreeV0(ociDir, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: ociDir, capture });
    assert(res.ok, "container adapter should parse oci layout counts");
    assert((res.summary?.counts.ociManifestCount ?? 0) === 2, "oci manifest count mismatch");
    assert((res.summary?.counts.ociBlobCount ?? 0) === 2, "oci blob count mismatch");
  }

  {
    const tmp = mkTmp();
    const tarPath = path.join(tmp, "container.tar");
    writeSimpleTar(tarPath, [
      { name: "manifest.json", text: "[]" },
      { name: "repositories", text: "{}" },
      { name: "layer.tar", text: "layer-bytes" },
    ]);
    const capture = captureTreeV0(tarPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: tarPath, capture });
    assert(res.ok, "container adapter should parse container tar entries");
    assert((res.summary?.counts.tarballScanPresent ?? 0) === 1, "container tar flag mismatch");
    assert((res.summary?.counts.tarEntryCount ?? 0) >= 3, "container tar entry count missing");
  }

  {
    const tmp = mkTmp();
    const sbomPath = path.join(tmp, "demo.spdx.json");
    fs.writeFileSync(
      sbomPath,
      JSON.stringify({
        SPDXID: "SPDXRef-DOCUMENT",
        packages: [{ name: "a" }, { name: "b" }, { name: "c" }],
      }),
      "utf8"
    );
    const capture = captureTreeV0(sbomPath, limits);
    const res = runArtifactAdapterV1({ selection: "container", enabledPlugins: [], inputPath: sbomPath, capture });
    assert(res.ok, "container adapter should parse sbom package count");
    assert((res.summary?.counts.sbomPresent ?? 0) === 1, "sbom present flag mismatch");
    assert((res.summary?.counts.sbomPackageCount ?? 0) === 3, "sbom package count mismatch");
  }

  {
    const tmp = mkTmp();
    const pem = path.join(tmp, "chain.pem");
    fs.writeFileSync(
      pem,
      [
        "-----BEGIN CERTIFICATE-----",
        "MIIB",
        "-----END CERTIFICATE-----",
        "-----BEGIN CERTIFICATE-----",
        "MIIC",
        "-----END CERTIFICATE-----",
        "# timestamp countersignature present",
      ].join("\n"),
      "utf8"
    );
    const capture = captureTreeV0(pem, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: pem, capture });
    assert(res.ok, "signature adapter should parse pem chain");
    assertEq(res.summary?.sourceClass, "signature", "signature class mismatch");
    assert((res.summary?.counts.pemCertificateCount ?? 0) === 2, "pem certificate count mismatch");
    assert((res.summary?.counts.chainPresent ?? 0) === 1, "chain presence flag mismatch");
    assert((res.summary?.counts.timestampPresent ?? 0) === 1, "timestamp presence flag mismatch");
    assert((res.summary?.reasonCodes ?? []).includes("SIGNER_PRESENT"), "missing SIGNER_PRESENT reason");
  }

  {
    const tmp = mkTmp();
    const p7b = path.join(tmp, "sample.p7b");
    const bytes = Buffer.concat([
      Buffer.from([0x30, 0x82, 0x00, 0x10]),
      Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]), // cms signedData oid
      Buffer.from([0x06, 0x08, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x08]), // timestamp EKU oid
    ]);
    fs.writeFileSync(p7b, bytes);
    const capture = captureTreeV0(p7b, limits);
    const res = runArtifactAdapterV1({ selection: "signature", enabledPlugins: [], inputPath: p7b, capture });
    assert(res.ok, "signature adapter should parse binary oid hints");
    assert((res.summary?.counts.cmsSignedDataOidCount ?? 0) > 0, "cms signedData oid count missing");
    assert((res.summary?.counts.timestampOidCount ?? 0) > 0, "timestamp oid count missing");
    assert((res.summary?.counts.signerPresent ?? 0) === 1, "signer presence should be set");
  }

  {
    const tmp = mkTmp();
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo, { recursive: true });
    const gitAvailable = runCmd("git", ["--version"]).ok;
    if (!gitAvailable) {
      fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
      fs.writeFileSync(path.join(repo, "a.txt"), "x", "utf8");
      const capture = captureTreeV0(repo, limits);
      const res = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture });
      assert(res.ok, "scm adapter should still produce unresolved evidence without git binary");
      assertEq(res.summary?.counts.commitResolved, 0, "commit should be unresolved without git");
    } else {
      assert(runCmd("git", ["init"], repo).ok, "git init failed");
      fs.writeFileSync(path.join(repo, "a.txt"), "x", "utf8");
      assert(runCmd("git", ["add", "a.txt"], repo).ok, "git add failed");
      assert(
        runCmd(
          "git",
          ["-c", "user.name=weft", "-c", "user.email=weft@example.invalid", "-c", "commit.gpgSign=false", "commit", "-m", "init"],
          repo
        ).ok,
        "git commit failed"
      );
      const capture = captureTreeV0(repo, limits);
      const res = runArtifactAdapterV1({ selection: "scm", enabledPlugins: [], inputPath: repo, capture });
      assert(res.ok, "scm adapter should capture git repo evidence");
      assertEq(res.summary?.sourceClass, "scm", "scm source class mismatch");
      assertEq(res.summary?.counts.commitResolved, 1, "commit should resolve");
      assert((res.summary?.counts.treeEntryCount ?? 0) >= 1, "tree entry count missing");
      assert((res.summary?.counts.branchRefCount ?? 0) >= 1, "branch ref count missing");
      assert((res.summary?.reasonCodes ?? []).includes("SCM_TREE_CAPTURED"), "missing SCM_TREE_CAPTURED reason");
    }
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
