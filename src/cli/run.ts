// src/cli/run.ts
// CLI handler for `weftend run` (v0 orchestrator).

declare const require: any;
declare const process: any;
declare const __dirname: string;

const fs = require("fs");
const path = require("path");

import { canonicalJSON } from "../core/canon";
import { canonicalizeWeftEndPolicyV1 } from "../core/intake_policy_v1";
import { cmpStrV0 } from "../core/order";
import { stableSortUniqueReasonsV0 } from "../core/trust_algebra_v0";
import {
  computePathDigestV0,
  computeReleaseIdV0,
  computeRunReceiptDigestV0,
  validateMintPackageV1,
  validateRunReceiptV0,
  validateWeftEndPolicyV1,
} from "../core/validate";
import type {
  ExecutionMode,
  IntakeDecisionV1,
  MintProfileV1,
  PlanSnapshotV0,
  ReleaseManifestV0,
  RunExecutionStatusV0,
  RunReceiptV0,
  StrictExecuteResultV0,
  StrictVerifyResultV0,
  WeftendMintPackageV1,
} from "../core/types";
import { examineArtifactV1 } from "../runtime/examiner/examine";
import { buildIntakeDecisionV1 } from "../runtime/examiner/intake_decision_v1";
import { ArtifactStoreV0, computeArtifactDigestV0 } from "../runtime/store/artifact_store";
import { devkitLoadStrict } from "../devkit/strict_loader";
import { deriveDemoPublicKey, isDemoCryptoAllowed, makeDemoCryptoPort } from "../ports/crypto-demo";
import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";
import { writeReceiptReadmeV0 } from "../runtime/receipt_readme";
import { buildOperatorReceiptV0, writeOperatorReceiptV0 } from "../runtime/operator_receipt";
import { buildContentSummaryV0 } from "../runtime/examiner/content_summary_v0";
import { classifyArtifactKindV0 } from "../runtime/classify/artifact_kind_v0";

export interface RunCliOptionsV0 {
  inputPath: string;
  outDir: string;
  policyPath: string;
  profile: MintProfileV1;
  mode: ExecutionMode;
  scriptPath?: string;
}

const readTextFile = (filePath: string): string => fs.readFileSync(filePath, "utf8");

const writeFile = (filePath: string, contents: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
};

const digestText = (value: string): string => computeArtifactDigestV0(value ?? "");

const pickStrictEntry = (capture: ReturnType<typeof examineArtifactV1>["capture"]) => {
  if (capture.kind === "zip") return null;
  const jsExts = new Set([".js", ".mjs", ".cjs"]);
  const entries = capture.entries
    .filter((entry) => jsExts.has(path.extname(entry.path).toLowerCase()))
    .sort((a, b) => cmpStrV0(a.path, b.path));
  if (entries.length === 0) return null;
  const entry = entries[0];
  const absPath = capture.kind === "dir" ? path.join(capture.basePath, entry.path) : capture.basePath;
  return { entryPath: entry.path, absPath };
};

const buildPlanSnapshotForRun = (
  planDigest: string,
  policyDigest: string,
  blockHash: string,
  expectedSourceDigest: string
): PlanSnapshotV0 => ({
  schema: "weftend.plan/0",
  graphDigest: `graph:${planDigest}`,
  artifacts: [{ nodeId: blockHash, contentHash: expectedSourceDigest }],
  policyDigest,
  evidenceDigests: [],
  grants: [{ blockHash, eligibleCaps: [] }],
  mode: "strict",
  tier: "T1",
  pathSummary: {
    schema: "weftend.pathSummary/0",
    v: 0,
    pipelineId: "WEFTEND_RUN_V0",
    weftendVersion: "0.0.0",
    publishInputHash: planDigest,
    trustPolicyHash: policyDigest,
    anchors: {
      a1Hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      a2Hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      a3Hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    plan: {
      planHash: planDigest,
      trustHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    bundle: {
      bundleHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    packages: [],
    artifacts: [{ ref: blockHash, digest: expectedSourceDigest }],
  },
});

const buildDemoReleaseManifest = (
  planDigest: string,
  policyDigest: string,
  blockHash: string,
  pathDigest: string,
  keyId: string,
  cryptoPort: { sign?: (payload: string, keyId: string) => { algo: string; keyId: string; sig: string } }
): ReleaseManifestV0 => {
  const manifestBody: ReleaseManifestV0["manifestBody"] = {
    planDigest,
    policyDigest,
    blocks: [blockHash],
    pathDigest,
  };
  const releaseId = computeReleaseIdV0(manifestBody);
  const payloadCanonical = canonicalJSON(manifestBody);
  const sig = cryptoPort.sign ? cryptoPort.sign(payloadCanonical, keyId) : null;
  return {
    schema: "weftend.release/0",
    releaseId,
    manifestBody,
    signatures: sig
      ? [
          {
            sigKind: sig.algo,
            keyId: sig.keyId,
            sigB64: sig.sig,
          },
        ]
      : [],
  };
};

const strictExecEnabled = (): boolean => process?.env?.WEFTEND_ALLOW_STRICT_EXEC === "1";

const buildStrictResults = async (
  mint: WeftendMintPackageV1,
  policyId: string,
  action: IntakeDecisionV1["action"],
  mode: ExecutionMode,
  capture: ReturnType<typeof examineArtifactV1>["capture"]
): Promise<{
  verify: StrictVerifyResultV0;
  execute: StrictExecuteResultV0;
  executeRequested: boolean;
}> => {
  const strictAllowed = strictExecEnabled();
  const demoAllowed = isDemoCryptoAllowed(process?.env);
  const executeSkipReasons: string[] = [];
  if (mode !== "strict") executeSkipReasons.push("NOT_IMPLEMENTED_IN_V0");
  else if (action !== "APPROVE") executeSkipReasons.push("INTAKE_NOT_APPROVED");
  else {
    if (!strictAllowed) executeSkipReasons.push("STRICT_EXEC_DISABLED");
    if (!demoAllowed) executeSkipReasons.push("DEMO_CRYPTO_DISABLED");
  }
  const executeRequested = executeSkipReasons.length === 0;

  const entry = pickStrictEntry(capture);
  if (!entry) {
    const verify: StrictVerifyResultV0 = {
      verdict: "DENY",
      reasonCodes: stableSortUniqueReasonsV0(["STRICT_ENTRY_MISSING"]),
      releaseStatus: "UNVERIFIED",
      releaseReasonCodes: stableSortUniqueReasonsV0(["RELEASE_MANIFEST_MISSING"]),
    };
    const execute: StrictExecuteResultV0 = {
      attempted: false,
      result: "SKIP",
      reasonCodes: stableSortUniqueReasonsV0(["STRICT_ENTRY_MISSING"]),
    };
    return { verify, execute, executeRequested: false };
  }

  let sourceText = "";
  try {
    sourceText = readTextFile(entry.absPath);
  } catch {
    const verify: StrictVerifyResultV0 = {
      verdict: "DENY",
      reasonCodes: stableSortUniqueReasonsV0(["STRICT_ENTRY_READ_FAILED"]),
      releaseStatus: "UNVERIFIED",
      releaseReasonCodes: stableSortUniqueReasonsV0(["RELEASE_MANIFEST_MISSING"]),
    };
    const execute: StrictExecuteResultV0 = {
      attempted: false,
      result: "SKIP",
      reasonCodes: stableSortUniqueReasonsV0(["STRICT_ENTRY_READ_FAILED"]),
    };
    return { verify, execute, executeRequested: false };
  }

  const planDigest = mint.digests.mintDigest;
  const blockHash = `block:${mint.input.rootDigest}`;
  const policyDigest = policyId;
  const expectedSourceDigest = computeArtifactDigestV0(sourceText);
  const store = new ArtifactStoreV0({ planDigest, blockHash });
  const put = store.put(expectedSourceDigest, sourceText);
  if (!put?.ok) {
    const verify: StrictVerifyResultV0 = {
      verdict: "DENY",
      reasonCodes: stableSortUniqueReasonsV0(put?.reasonCodes ?? ["ARTIFACT_INPUT_INVALID"]),
      releaseStatus: "UNVERIFIED",
      releaseReasonCodes: stableSortUniqueReasonsV0(["RELEASE_MANIFEST_MISSING"]),
    };
    const execute: StrictExecuteResultV0 = {
      attempted: false,
      result: "SKIP",
      reasonCodes: stableSortUniqueReasonsV0(["ARTIFACT_INPUT_INVALID"]),
    };
    return { verify, execute, executeRequested: false };
  }

  const planSnapshot = buildPlanSnapshotForRun(planDigest, policyDigest, blockHash, expectedSourceDigest);
  const pathDigest = computePathDigestV0(planSnapshot.pathSummary);
  const demoKeyId = "weftend-demo-key";
  const demoCrypto = makeDemoCryptoPort("weftend-run-demo");
  const releaseManifest = buildDemoReleaseManifest(
    planDigest,
    policyDigest,
    blockHash,
    pathDigest,
    demoKeyId,
    demoCrypto
  );
  const releaseKeyAllowlist: Record<string, string> = {
    [demoKeyId]: deriveDemoPublicKey("weftend-run-demo"),
  };

  const workerScript = path.resolve(__dirname, "..", "runtime", "strict", "sandbox_bootstrap.js");
  const result = await devkitLoadStrict({
    workerScript,
    planDigest,
    policyDigest,
    callerBlockHash: blockHash,
    sourceText,
    entryExportName: "main",
    expectedSourceDigest,
    artifactStore: store,
    releaseManifest,
    releaseKeyAllowlist,
    cryptoPort: demoCrypto,
    planSnapshot,
    executeRequested,
  });

  const rawVerifyVerdict = result?.verify?.verdict;
  const verifyVerdict =
    rawVerifyVerdict === "ALLOW" || rawVerifyVerdict === "DENY" || rawVerifyVerdict === "QUARANTINE"
      ? rawVerifyVerdict
      : "DENY";
  const rawReleaseStatus = result?.verify?.releaseStatus;
  const releaseStatus =
    rawReleaseStatus === "OK" || rawReleaseStatus === "UNVERIFIED" || rawReleaseStatus === "MAYBE"
      ? rawReleaseStatus
      : "UNVERIFIED";
  const releaseId = typeof (result as any)?.verify?.releaseId === "string" ? (result as any).verify.releaseId : undefined;
  const verify: StrictVerifyResultV0 = {
    verdict: verifyVerdict,
    reasonCodes: stableSortUniqueReasonsV0(result?.verify?.reasonCodes ?? []),
    releaseStatus,
    releaseReasonCodes: stableSortUniqueReasonsV0(result?.verify?.releaseReasonCodes ?? []),
    ...(releaseId ? { releaseId } : {}),
  };
  let execute: StrictExecuteResultV0 = {
    attempted: Boolean(result?.execute?.attempted),
    result:
      result?.execute?.result === "ALLOW" || result?.execute?.result === "DENY" || result?.execute?.result === "SKIP"
        ? result.execute.result
        : "SKIP",
    reasonCodes: stableSortUniqueReasonsV0(result?.execute?.reasonCodes ?? []),
  };
  if (!executeRequested) {
    execute = {
      attempted: false,
      result: "SKIP",
      reasonCodes: stableSortUniqueReasonsV0(executeSkipReasons),
    };
  }
  return { verify, execute, executeRequested };
};

const buildRunReceipt = (
  mint: WeftendMintPackageV1,
  decision: IntakeDecisionV1,
  weftendBuild: RunReceiptV0["weftendBuild"],
  modeRequested: ExecutionMode,
  modeEffective: ExecutionMode,
  execution: { status: RunExecutionStatusV0; reasonCodes: string[] },
  strictVerify: StrictVerifyResultV0,
  strictExecute: StrictExecuteResultV0,
  envGates: { strictExecAllowed: boolean; demoCryptoAllowed: boolean },
  artifactsWritten: Array<{ name: string; digest: string }>,
  contentSummary: RunReceiptV0["contentSummary"]
): RunReceiptV0 => {
  const receipt: RunReceiptV0 = {
    schema: "weftend.runReceipt/0",
    v: 0,
    schemaVersion: 0,
    weftendBuild,
    modeRequested,
    modeEffective,
    profile: mint.profile,
    inputDigest: mint.input.rootDigest,
    contentSummary,
    policyId: decision.policyId,
    mintDigest: mint.digests.mintDigest,
    intakeDecisionDigest: decision.decisionDigest,
    intakeAction: decision.action,
    intakeGrade: decision.grade,
    envGates,
    strictVerify: {
      verdict: strictVerify.verdict,
      reasonCodes: stableSortUniqueReasonsV0(strictVerify.reasonCodes ?? []),
      releaseStatus: strictVerify.releaseStatus,
      releaseReasonCodes: stableSortUniqueReasonsV0(strictVerify.releaseReasonCodes ?? []),
      ...(strictVerify.releaseId ? { releaseId: strictVerify.releaseId } : {}),
    },
    strictExecute: {
      attempted: strictExecute.attempted,
      result: strictExecute.result,
      reasonCodes: stableSortUniqueReasonsV0(strictExecute.reasonCodes ?? []),
    },
    artifactsWritten,
    execution: {
      status: execution.status,
      reasonCodes: stableSortUniqueReasonsV0(execution.reasonCodes ?? []),
    },
    receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  receipt.receiptDigest = computeRunReceiptDigestV0(receipt);
  return receipt;
};

export const runWeftendRun = async (options: RunCliOptionsV0): Promise<number> => {
  let policyRaw: unknown;
  try {
    policyRaw = JSON.parse(readTextFile(options.policyPath));
  } catch {
    console.error("[POLICY_INVALID] policy must be valid JSON.");
    return 40;
  }
  const policyIssues = validateWeftEndPolicyV1(policyRaw, "policy");
  if (policyIssues.length > 0) {
    console.error("[POLICY_INVALID]");
    policyIssues.forEach((issue) => {
      const loc = issue.path ? ` (${issue.path})` : "";
      console.error(`${issue.code}: ${issue.message}${loc}`);
    });
    return 40;
  }
  const policy = canonicalizeWeftEndPolicyV1(policyRaw as any);

  let scriptText: string | undefined;
  if (options.scriptPath) {
    try {
      scriptText = readTextFile(options.scriptPath);
    } catch {
      console.error("[SCRIPT_INVALID] unable to read script file.");
      return 40;
    }
  }

  const result = examineArtifactV1(options.inputPath, {
    profile: options.profile,
    scriptText,
  });

  const mintIssues = validateMintPackageV1(result.mint, "mint");
  if (mintIssues.length > 0) {
    console.error("[MINT_INVALID]");
    mintIssues.forEach((issue) => {
      const loc = issue.path ? ` (${issue.path})` : "";
      console.error(`${issue.code}: ${issue.message}${loc}`);
    });
    return 40;
  }

  const output = buildIntakeDecisionV1(result.mint, policy, { scriptText });
  const classified = classifyArtifactKindV0(options.inputPath, result.capture);
  const policyMatch = {
    selectedPolicy: path.basename(options.policyPath),
    reasonCodes: ["POLICY_EXPLICIT"],
  };
  const contentSummary = buildContentSummaryV0({
    inputPath: options.inputPath,
    capture: result.capture,
    observations: result.mint.observations,
    artifactKind: classified.artifactKind,
    policyMatch,
  });
  const strictResults = await buildStrictResults(
    result.mint,
    output.decision.policyId,
    output.decision.action,
    options.mode,
    result.capture
  );
  const modeEffective = options.mode;
  const envGates = {
    strictExecAllowed: strictExecEnabled(),
    demoCryptoAllowed: isDemoCryptoAllowed(process?.env),
  };

  const mintJson = `${canonicalJSON(result.mint)}\n`;
  const mintTxt = `${result.report}\n`;
  const decisionJson = `${canonicalJSON(output.decision)}\n`;
  const disclosureTxt = `${output.disclosure}\n`;
  const appealJson = `${canonicalJSON(output.appeal)}\n`;

  const executionStatus: RunExecutionStatusV0 =
    strictResults.execute.result === "ALLOW"
      ? "ALLOW"
      : strictResults.execute.result === "DENY"
        ? "DENY"
        : strictResults.verify.verdict === "QUARANTINE"
          ? "QUARANTINE"
          : "SKIP";
  const execution = {
    status: executionStatus,
    reasonCodes: strictResults.execute.reasonCodes,
  };
  const artifactsWritten = [
    { name: "appeal_bundle.json", digest: digestText(appealJson) },
    { name: "disclosure.txt", digest: digestText(disclosureTxt) },
    { name: "intake_decision.json", digest: digestText(decisionJson) },
    { name: "weftend_mint_v1.json", digest: digestText(mintJson) },
    { name: "weftend_mint_v1.txt", digest: digestText(mintTxt) },
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : cmpStrV0(a.digest, b.digest)));

  const weftendBuild = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  const receipt = buildRunReceipt(
    result.mint,
    output.decision,
    weftendBuild,
    options.mode,
    modeEffective,
    execution,
    strictResults.verify,
    strictResults.execute,
    envGates,
    artifactsWritten,
    contentSummary
  );

  const receiptIssues = validateRunReceiptV0(receipt, "runReceipt");
  if (receiptIssues.length > 0) {
    console.error("[RUN_RECEIPT_INVALID]");
    receiptIssues.forEach((issue) => {
      const loc = issue.path ? ` (${issue.path})` : "";
      console.error(`${issue.code}: ${issue.message}${loc}`);
    });
    return 1;
  }

  fs.mkdirSync(options.outDir, { recursive: true });
  writeFile(path.join(options.outDir, "weftend_mint_v1.json"), mintJson);
  writeFile(path.join(options.outDir, "weftend_mint_v1.txt"), mintTxt);
  writeFile(path.join(options.outDir, "intake_decision.json"), decisionJson);
  writeFile(path.join(options.outDir, "disclosure.txt"), disclosureTxt);
  writeFile(path.join(options.outDir, "appeal_bundle.json"), appealJson);
  writeFile(path.join(options.outDir, "run_receipt.json"), `${canonicalJSON(receipt)}\n`);
  writeReceiptReadmeV0(options.outDir, receipt.weftendBuild, receipt.schemaVersion);

  const warnings = [
    ...(receipt.weftendBuild.reasonCodes ?? []),
    ...(envGates.strictExecAllowed ? [] : ["STRICT_EXEC_DISABLED"]),
    ...(envGates.demoCryptoAllowed ? [] : ["DEMO_CRYPTO_DISABLED"]),
    ...(receipt.strictExecute.reasonCodes?.includes("STRICT_COMPARTMENT_UNAVAILABLE")
      ? ["STRICT_COMPARTMENT_UNAVAILABLE"]
      : []),
  ];
  const operatorReceipt = buildOperatorReceiptV0({
    command: "run",
    weftendBuild: receipt.weftendBuild,
    schemaVersion: receipt.schemaVersion,
    entries: [
      {
        kind: "run_receipt",
        relPath: "run_receipt.json",
        digest: receipt.receiptDigest,
      },
    ],
    warnings,
    contentSummary,
  });
  writeOperatorReceiptV0(options.outDir, operatorReceipt);

  const buildSummary = formatBuildDigestSummaryV0(receipt.weftendBuild);
  const privacy = runPrivacyLintV0({ root: options.outDir, weftendBuild: receipt.weftendBuild });
  const privacySummary = `privacyLint=${privacy.report.verdict}`;
  console.log(`RUN ${execution.status} intake=${output.decision.action} ${buildSummary} ${privacySummary}`);

  if (
    strictResults.execute.attempted &&
    strictResults.execute.result === "SKIP" &&
    strictResults.execute.reasonCodes.includes("STRICT_COMPARTMENT_UNAVAILABLE") &&
    strictResults.executeRequested
  ) {
    return 40;
  }
  return 0;
};
