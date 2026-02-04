// src/devkit/strict_loader.ts
// DevKit strict loader adapter (single truth engine).
// @ts-nocheck

import { stableSortUniqueReasonsV0 } from "../core/trust_algebra_v0";
import { computePathDigestV0 } from "../core/validate";
import { verifyReleaseManifestV0 } from "../runtime/release/release_loader";

const summarizeTartarus = (record) => {
  const summary = {
    total: 0,
    info: 0,
    warn: 0,
    deny: 0,
    quarantine: 0,
    kinds: {},
  };
  if (!record) return summary;

  summary.total = 1;
  if (record.severity === "INFO") summary.info = 1;
  if (record.severity === "WARN") summary.warn = 1;
  if (record.severity === "DENY") summary.deny = 1;
  if (record.severity === "QUARANTINE") summary.quarantine = 1;
  if (record.kind) summary.kinds[record.kind] = 1;
  return summary;
};

export async function devkitLoadStrict(input) {
  const executeRequested = input.executeRequested !== false;
  const hasNode =
    typeof process !== "undefined" &&
    process &&
    process.versions &&
    typeof process.versions.node === "string";
  if (!hasNode) {
    const verify = {
      verdict: "DENY",
      reasonCodes: ["STRICT_LOADER_UNAVAILABLE"],
      releaseStatus: "UNVERIFIED",
      releaseReasonCodes: ["STRICT_LOADER_UNAVAILABLE"],
    };
    const execute = {
      attempted: true,
      result: "SKIP",
      reasonCodes: ["STRICT_LOADER_UNAVAILABLE"],
    };
    return {
      verify,
      execute,
      verdict: "DENY",
      executionOk: false,
      reasonCodes: ["STRICT_LOADER_UNAVAILABLE"],
      planDigest: input.planDigest,
      policyDigest: input.policyDigest,
      evidenceDigests: [],
      expectedArtifactDigest: input.expectedSourceDigest ?? null,
      observedArtifactDigest: null,
      releaseId: undefined,
      rollback: undefined,
      tartarusSummary: summarizeTartarus(null),
      tartarusLatest: null,
    };
  }

  const { StrictExecutor } = await import("../runtime/strict/strict_executor");
  let artifactIncident;
  let artifactObservation;

  const expectedPathDigest = input.planSnapshot?.pathSummary
    ? computePathDigestV0(input.planSnapshot.pathSummary)
    : undefined;
  const releaseVerify = verifyReleaseManifestV0({
    manifest: input.releaseManifest ?? null,
    expectedPlanDigest: input.planDigest,
    expectedBlocks: [input.callerBlockHash],
    expectedPathDigest,
    cryptoPort: input.cryptoPort,
    keyAllowlist: input.releaseKeyAllowlist,
  });

  let artifactReasons = [];
  if (input.artifactStore && input.expectedSourceDigest) {
    artifactObservation = input.artifactStore.read(input.expectedSourceDigest);
    artifactReasons = Array.isArray(artifactObservation?.reasonCodes) ? artifactObservation.reasonCodes : [];
  }
  const verifyReasons = stableSortUniqueReasonsV0([
    ...(releaseVerify.reasonCodes ?? []),
    ...artifactReasons,
  ]);
  let verifyVerdict = verifyReasons.length > 0 ? "DENY" : "ALLOW";
  if (verifyReasons.includes("ARTIFACT_DIGEST_MISMATCH") && !artifactObservation?.recovered) {
    verifyVerdict = "QUARANTINE";
  }
  const verify = {
    verdict: verifyVerdict,
    reasonCodes: verifyReasons,
    releaseStatus: releaseVerify.status ?? "UNVERIFIED",
    releaseReasonCodes: stableSortUniqueReasonsV0(releaseVerify.reasonCodes ?? []),
    ...(releaseVerify.observedReleaseId ? { releaseId: releaseVerify.observedReleaseId } : {}),
  };

  let result = { ok: false, reasonCodes: [] };
  let executionOk = false;
  let execute = { attempted: false, result: "SKIP", reasonCodes: ["STRICT_EXEC_SKIPPED"] };
  if (executeRequested) {
    const exec = new StrictExecutor({
      workerScript: input.workerScript,
      planDigest: input.planDigest,
      callerBlockHash: input.callerBlockHash,
      grantedCaps: input.grantedCaps ?? [],
      sourceText: input.sourceText,
      entryExportName: input.entryExportName,
      artifactStore: input.artifactStore,
      expectedSourceDigest: input.expectedSourceDigest,
      onArtifactIncident: (record) => {
        artifactIncident = record;
      },
      onArtifactRead: (obs) => {
        artifactObservation = obs;
      },
      releaseManifest: input.releaseManifest,
      releaseKeyAllowlist: input.releaseKeyAllowlist,
      cryptoPort: input.cryptoPort,
      planSnapshot: input.planSnapshot,
      evidenceBundle: input.evidenceBundle,
      strictPolicy: input.strictPolicy,
      onPulse: input.onPulse,
    });

    result = await exec.run();
    await exec.terminate();
    const resultReasons = stableSortUniqueReasonsV0(result?.reasonCodes ?? []);
    if (resultReasons.includes("STRICT_COMPARTMENT_UNAVAILABLE")) {
      execute = {
        attempted: true,
        result: "SKIP",
        reasonCodes: ["STRICT_COMPARTMENT_UNAVAILABLE"],
      };
    } else {
      executionOk = result.ok === true;
      execute = {
        attempted: true,
        result: executionOk ? "ALLOW" : "DENY",
        reasonCodes: resultReasons,
      };
    }
  }

  const reasonCodes = stableSortUniqueReasonsV0([
    ...(execute?.reasonCodes ?? []),
    ...artifactReasons,
  ]);
  let verdict = execute?.result === "ALLOW" ? "ALLOW" : execute?.result === "SKIP" ? verifyVerdict : "DENY";
  if (verifyVerdict === "QUARANTINE") verdict = "QUARANTINE";

  let rollback;
  if (artifactObservation && artifactObservation.recovered) {
    rollback = {
      recovered: true,
      recoveredDigest: input.expectedSourceDigest,
      reasonCodes: stableSortUniqueReasonsV0(artifactObservation.reasonCodes ?? []),
    };
  }

  return {
    verify,
    execute,
    verdict,
    executionOk,
    reasonCodes,
    planDigest: input.planDigest,
    policyDigest: input.policyDigest,
    evidenceDigests: [],
    expectedArtifactDigest: input.expectedSourceDigest ?? null,
    observedArtifactDigest: artifactObservation?.observedDigest ?? null,
    releaseId: releaseVerify?.observedReleaseId,
    releaseStatus: releaseVerify?.status,
    releaseReasonCodes: releaseVerify?.reasonCodes ?? [],
    rollback,
    tartarusSummary: summarizeTartarus(artifactIncident),
    tartarusLatest: artifactIncident ?? null,
  };
}
