const fs = require("fs");
const path = require("path");

const { SteamUGCMock } = require("../dist/src/integrations/steamworkshop/steamugc_mock");
const {
  assessBrowsePointerV1,
  decodePointerV1,
  verifyInstalledWorkshopItemV1,
} = require("../dist/src/integrations/steamworkshop/weftend_workshop_v1");
const { devkitLoadStrict } = require("../dist/src/devkit/strict_loader");
const {
  ArtifactStoreV0,
  computeArtifactDigestV0,
} = require("../dist/src/runtime/store/artifact_store");
const {
  makeReleaseManifest,
  makeReleaseCryptoPort,
  releaseKeyAllowlist,
} = require("../dist/src/runtime/test_support/release_manifest");

const folderPath = path.resolve(__dirname, "..", "examples", "steamworkshop", "mod_hello");
const pointerPath = path.join(folderPath, "weftend", "metadata_pointer.txt");
const metadata = fs.readFileSync(pointerPath, "utf8").trim();

const ugc = new SteamUGCMock();
const { itemId } = ugc.createItem();
ugc.setItemContent(itemId, folderPath);
ugc.setItemMetadata(itemId, metadata);

const query = ugc.queryItems({ returnMetadata: true });
const item = query.results[0];
const browse = assessBrowsePointerV1(item.metadata);

console.log("BROWSE:");
console.log(JSON.stringify(browse, null, 2));

const decoded = decodePointerV1(item.metadata || "");
if (!decoded.ok || !decoded.pointer) {
  console.log("VERIFY:");
  console.log(JSON.stringify({ verdict: "REJECT", reasonCodes: [decoded.errorCode || "E_POINTER_INVALID"] }, null, 2));
  process.exit(0);
}

const verify = verifyInstalledWorkshopItemV1(
  fs,
  folderPath,
  decoded.pointer,
  { policyDigest: "policy-hello-mod-v1", requiredEvidenceKinds: ["signature.v1"] }
);

console.log("VERIFY:");
console.log(JSON.stringify(verify, null, 2));

if (verify.verdict !== "ACCEPT") {
  process.exit(0);
}

const blockPath = path.join(folderPath, "payload", "hello_mod_block.js");
const sourceText = fs.readFileSync(blockPath, "utf8");
const expectedSourceDigest = computeArtifactDigestV0(sourceText);
const workerScript = path.resolve(
  __dirname,
  "..",
  "dist",
  "src",
  "runtime",
  "strict",
  "sandbox_bootstrap.js"
);

const store = new ArtifactStoreV0({
  planDigest: "plan-hello-mod-v1",
  blockHash: "hello-mod-block",
});
store.put(expectedSourceDigest, sourceText);

const releaseManifest = makeReleaseManifest("plan-hello-mod-v1", ["hello-mod-block"], "policy-hello-mod-v1");

devkitLoadStrict({
  workerScript,
  planDigest: "plan-hello-mod-v1",
  policyDigest: "policy-hello-mod-v1",
  callerBlockHash: "hello-mod-block",
  sourceText,
  entryExportName: "main",
  expectedSourceDigest,
  artifactStore: store,
  grantedCaps: [],
  releaseManifest,
  releaseKeyAllowlist,
  cryptoPort: makeReleaseCryptoPort(),
})
  .then((result) => {
    console.log("STRICT LOAD:");
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error("STRICT LOAD FAILED:");
    console.error(err);
    process.exitCode = 1;
  });
