const fs = require("fs");
const path = require("path");

const { devkitLoadStrict } = require("../../dist/src/devkit/strict_loader");
const {
  ArtifactStoreV0,
  computeArtifactDigestV0,
} = require("../../dist/src/runtime/store/artifact_store");
const {
  makeReleaseManifest,
  makeReleaseCryptoPort,
  releaseKeyAllowlist,
} = require("../../dist/src/runtime/test_support/release_manifest");

const planDigest = "plan-hello-mod-v1";
const policyDigest = "policy-hello-mod-v1";
const blockHash = "hello-mod-block";

const blockPath = path.resolve(__dirname, "block.js");
const sourceText = fs.readFileSync(blockPath, "utf8");
const expectedSourceDigest = computeArtifactDigestV0(sourceText);

const scenarioArg = process.argv.find((arg) => arg.startsWith("--scenario="));
const scenario = scenarioArg ? scenarioArg.split("=")[1] : "ok";

const tamperSource = (text) => {
  if (!text) return text;
  const idx = Math.min(5, text.length - 1);
  const ch = text[idx];
  const next = ch === "a" ? "b" : "a";
  return text.slice(0, idx) + next + text.slice(idx + 1);
};

const workerScript = path.resolve(
  __dirname,
  "..",
  "..",
  "dist",
  "src",
  "runtime",
  "strict",
  "sandbox_bootstrap.js"
);

const store = new ArtifactStoreV0({ planDigest, blockHash });
if (scenario === "tamper_no_recovery") {
  const tampered = tamperSource(sourceText);
  store.current.set(expectedSourceDigest, tampered);
} else if (scenario === "tamper_recovered") {
  store.put(expectedSourceDigest, sourceText);
  const tampered = tamperSource(sourceText);
  store.current.set(expectedSourceDigest, tampered);
} else {
  store.put(expectedSourceDigest, sourceText);
}

const releaseManifest = makeReleaseManifest(planDigest, [blockHash], policyDigest);

devkitLoadStrict({
  workerScript,
  planDigest,
  policyDigest,
  callerBlockHash: blockHash,
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
    const verdict = result?.verdict || "DENY";
    const exitOk = verdict === "ALLOW";
    console.log("DevKit strict load result:");
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = exitOk ? 0 : 1;
  })
  .catch((err) => {
    console.error("Strict load failed:");
    console.error(err);
    process.exitCode = 1;
  });
