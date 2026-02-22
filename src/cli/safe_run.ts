// src/cli/safe_run.ts
// Safe-run wrapper: analyze + intake, then (if allowed) host execute.

declare const require: any;
declare const process: any;

import { canonicalJSON } from "../core/canon";
import { canonicalizeWeftEndPolicyV1, computeWeftEndPolicyIdV1 } from "../core/intake_policy_v1";
import { cmpStrV0 } from "../core/order";
import { stableSortUniqueReasonsV0 } from "../core/trust_algebra_v0";
import {
  computeEvidenceBundleDigestV0,
  computePathDigestV0,
  computeReleaseIdV0,
  computeSafeRunReceiptDigestV0,
  validateMintPackageV1,
  validateSafeRunReceiptV0,
  validateWeftEndPolicyV1,
} from "../core/validate";
import type {
  ArtifactKindV0,
  ExecutionMode,
  IntakeDecisionV1,
  MintProfileV1,
  OperatorReceiptEntryV0,
  PlanSnapshotV0,
  ReleaseManifestV0,
  RuntimeBundle,
  SafeRunAnalysisVerdictV0,
  SafeRunExecutionVerdictV0,
  SafeRunReceiptV0,
  WeftendMintPackageV1,
} from "../core/types";
import { examineArtifactV1 } from "../runtime/examiner/examine";
import { captureTreeV0 } from "../runtime/examiner/capture_tree_v0";
import { buildContentSummaryV0 } from "../runtime/examiner/content_summary_v0";
import { detectLayersV0 } from "../runtime/examiner/detect_layers_v0";
import { buildIntakeDecisionV1 } from "../runtime/examiner/intake_decision_v1";
import { computeArtifactDigestV0 } from "../runtime/store/artifact_store";
import { runHostStrictV0 } from "../runtime/host/host_runner";
import { deriveDemoPublicKey, makeDemoCryptoPort } from "../ports/crypto-demo";
import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";
import { buildReceiptReadmeV0 } from "../runtime/receipt_readme";
import { buildOperatorReceiptV0, writeOperatorReceiptV0 } from "../runtime/operator_receipt";
import { classifyArtifactKindV0 } from "../runtime/classify/artifact_kind_v0";
import { updateLibraryViewFromRunV0 } from "./library_state";
import { validateNormalizedArtifactV0 } from "../runtime/adapters/intake_adapter_v0";
import {
  ADAPTER_DISABLE_FILE_ENV_V1,
  runArtifactAdapterV1,
  type AdapterRunResultV1,
  type AdapterSelectionV1,
} from "../runtime/adapters/artifact_adapter_v1";

const fs = require("fs");
const path = require("path");
const MAX_RELEASE_INPUT_BYTES = 1024 * 1024;
const DEFAULT_CAPTURE_LIMITS = {
  maxFiles: 20000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxPathBytes: 256,
};
const DEFAULT_DETECT_LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxExternalRefs: 1000,
};

export interface SafeRunCliOptionsV0 {
  inputPath: string;
  outDir: string;
  policyPath?: string;
  profile: MintProfileV1;
  mode: ExecutionMode;
  scriptPath?: string;
  executeRequested?: boolean;
  withholdExec?: boolean;
  adapter?: AdapterSelectionV1;
  enablePlugins?: string[];
}

const readTextFile = (filePath: string): string => fs.readFileSync(filePath, "utf8");

const writeFile = (filePath: string, contents: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stagePath = `${filePath}.stage`;
  fs.rmSync(stagePath, { recursive: true, force: true });
  fs.writeFileSync(stagePath, contents, "utf8");
  fs.renameSync(stagePath, filePath);
};

const digestText = (value: string): string => computeArtifactDigestV0(value ?? "");

const listFilesRecursiveRel = (root: string, relStart: string): string[] => {
  const startPath = path.join(root, relStart);
  if (!fs.existsSync(startPath)) return [];
  const out: string[] = [];
  const stack: string[] = [relStart];
  while (stack.length > 0) {
    const rel = String(stack.pop() || "");
    const abs = path.join(root, rel);
    let stat: any = null;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat && stat.isDirectory && stat.isDirectory()) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(abs).map((n: string) => String(n));
      } catch {
        entries = [];
      }
      entries.sort((a, b) => cmpStrV0(a, b));
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const nextRel = path.join(rel, entries[i]).replace(/\\/g, "/");
        stack.push(nextRel);
      }
      continue;
    }
    if (stat && stat.isFile && stat.isFile()) {
      out.push(rel.replace(/\\/g, "/"));
    }
  }
  out.sort((a, b) => cmpStrV0(a, b));
  return out;
};

const prepareStagedOutRoot = (outDir: string): { ok: true; stageOutDir: string; hadPreexistingOutput: boolean } | { ok: false } => {
  const stageOutDir = `${outDir}.stage`;
  let hadPreexistingOutput = false;
  try {
    if (fs.existsSync(outDir)) hadPreexistingOutput = listFilesRecursiveRel(outDir, ".").length > 0;
    fs.rmSync(stageOutDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(stageOutDir), { recursive: true });
    fs.mkdirSync(stageOutDir, { recursive: true });
    return { ok: true, stageOutDir, hadPreexistingOutput };
  } catch {
    return { ok: false };
  }
};

const finalizeStagedOutRoot = (stageOutDir: string, outDir: string): boolean => {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(stageOutDir, outDir);
    return true;
  } catch {
    return false;
  }
};

const pathsOverlap = (aPath: string, bPath: string): boolean => {
  const a = path.resolve(process.cwd(), aPath || "");
  const b = path.resolve(process.cwd(), bPath || "");
  if (a === b) return true;
  const aPrefix = a.endsWith(path.sep) ? a : `${a}${path.sep}`;
  const bPrefix = b.endsWith(path.sep) ? b : `${b}${path.sep}`;
  return a.startsWith(bPrefix) || b.startsWith(aPrefix);
};

const evaluateEvidenceWarnings = (input: {
  outDir: string;
  receipt: SafeRunReceiptV0;
  operatorReceiptDigest: string;
  readmeText: string;
}): string[] => {
  const isPresenceOnlyEvidencePath = (relPath: string): boolean => {
    const normalized = String(relPath || "").replace(/\\/g, "/").toLowerCase();
    return normalized.endsWith("_receipt.json");
  };
  const expected = new Map<string, string>();
  expected.set("safe_run_receipt.json", input.receipt.receiptDigest);
  expected.set("operator_receipt.json", input.operatorReceiptDigest);
  expected.set("weftend/README.txt", digestText(input.readmeText));
  (input.receipt.subReceipts ?? []).forEach((entry) => {
    const relPath = String(entry.name || "").replace(/\\/g, "/");
    if (!relPath) return;
    expected.set(relPath, String(entry.digest || ""));
  });

  const actualSet = new Set<string>();
  listFilesRecursiveRel(input.outDir, ".").forEach((rel) => actualSet.add(rel));

  const warnings: string[] = [];
  expected.forEach((digest, relPath) => {
    const abs = path.join(input.outDir, relPath);
    if (!fs.existsSync(abs)) {
      warnings.push("SAFE_RUN_EVIDENCE_MISSING");
      return;
    }
    if (isPresenceOnlyEvidencePath(relPath)) return;
    let raw = "";
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      warnings.push("SAFE_RUN_EVIDENCE_MISSING");
      return;
    }
    if (digestText(raw) !== digest) warnings.push("SAFE_RUN_EVIDENCE_DIGEST_MISMATCH");
  });

  actualSet.forEach((relPath) => {
    if (!expected.has(relPath)) warnings.push("SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT");
  });

  return stableSortUniqueReasonsV0(warnings);
};

const readTextBounded = (filePath: string, reasons: string[], missingCode: string, invalidCode: string) => {
  if (!fs.existsSync(filePath)) {
    reasons.push(missingCode);
    return null;
  }
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_RELEASE_INPUT_BYTES) {
      reasons.push("HOST_INPUT_OVERSIZE");
      return null;
    }
  } catch {
    reasons.push(invalidCode);
    return null;
  }
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    reasons.push(invalidCode);
    return null;
  }
};

const parseJson = (raw: string | null, reasons: string[], invalidCode: string) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    reasons.push(invalidCode);
    return null;
  }
};

const loadReleaseMeta = (releaseDir: string): { ok: boolean; releaseId?: string; releaseDirDigest?: string; reasonCodes: string[] } => {
  const reasons: string[] = [];
  const manifestPath = path.join(releaseDir, "release_manifest.json");
  const bundlePath = path.join(releaseDir, "runtime_bundle.json");
  const evidencePath = path.join(releaseDir, "evidence.json");
  const keyPath = path.join(releaseDir, "release_public_key.json");

  const manifestRaw = readTextBounded(manifestPath, reasons, "RELEASE_MANIFEST_MISSING", "RELEASE_MANIFEST_INVALID");
  const bundleRaw = readTextBounded(bundlePath, reasons, "RUNTIME_BUNDLE_MISSING", "RUNTIME_BUNDLE_INVALID");
  const evidenceRaw = readTextBounded(evidencePath, reasons, "EVIDENCE_MISSING", "EVIDENCE_INVALID");
  const keyRaw = readTextBounded(keyPath, reasons, "PUBLIC_KEY_MISSING", "PUBLIC_KEY_INVALID");
  const manifestParsed = parseJson(manifestRaw, reasons, "RELEASE_MANIFEST_INVALID") as any;
  if (!manifestParsed || typeof manifestParsed.releaseId !== "string" || manifestParsed.releaseId.length === 0) {
    reasons.push("RELEASE_MANIFEST_INVALID");
  }

  if (reasons.length > 0) {
    return { ok: false, reasonCodes: stableSortUniqueReasonsV0(reasons) };
  }

  const manifestDigest = computeArtifactDigestV0(manifestRaw ?? "");
  const bundleDigest = computeArtifactDigestV0(bundleRaw ?? "");
  const evidenceDigest = computeArtifactDigestV0(evidenceRaw ?? "");
  const publicKeyDigest = computeArtifactDigestV0(keyRaw ?? "");
  const releaseDirDigest = computeArtifactDigestV0(
    canonicalJSON({
      releaseId: manifestParsed.releaseId ?? "",
      manifestDigest,
      bundleDigest,
      evidenceDigest,
      publicKeyDigest,
    })
  );

  return {
    ok: true,
    releaseId: manifestParsed.releaseId,
    releaseDirDigest,
    reasonCodes: [],
  };
};

const POLICY_MOD = path.join(process.cwd(), "policies", "mod_platform_default.json");
const POLICY_WEB = path.join(process.cwd(), "policies", "web_component_default.json");
const POLICY_GENERIC = path.join(process.cwd(), "policies", "generic_default.json");

const isHtmlFile = (name: string): boolean => {
  const ext = path.extname(name).toLowerCase();
  return ext === ".html" || ext === ".htm";
};

const hasHtmlEntry = (dir: string, maxFiles: number = 200): boolean => {
  const queue: string[] = [dir];
  let seen = 0;
  while (queue.length > 0 && seen < maxFiles) {
    const current = queue.shift();
    if (!current) break;
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true }) as any;
    } catch {
      continue;
    }
    entries.sort((a: any, b: any) => cmpStrV0(String(a.name), String(b.name)));
    for (const entry of entries) {
      const name = String(entry.name);
      const full = path.join(current, name);
      if (entry.isDirectory && entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      seen += 1;
      if (isHtmlFile(name)) return true;
      if (seen >= maxFiles) break;
    }
  }
  return false;
};

const selectPolicyPath = (
  inputPath: string,
  explicit?: string
): { ok: boolean; policyPath: string; reasonCodes: string[]; reason?: string } => {
  if (explicit) return { ok: true, policyPath: explicit, reasonCodes: ["POLICY_EXPLICIT"] };
  const normalized = path.resolve(process.cwd(), inputPath || "");
  const ext = path.extname(normalized).toLowerCase();
  try {
    if (ext === ".zip") {
      return { ok: true, policyPath: POLICY_MOD, reasonCodes: ["POLICY_AUTO_ZIP_MOD"] };
    }
    if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
      if (fs.existsSync(path.join(normalized, "manifest.json"))) {
        return { ok: true, policyPath: POLICY_MOD, reasonCodes: ["POLICY_AUTO_DIR_MANIFEST_MOD"] };
      }
      if (hasHtmlEntry(normalized)) {
        return { ok: true, policyPath: POLICY_WEB, reasonCodes: ["POLICY_AUTO_DIR_HTML_WEB"] };
      }
      return { ok: true, policyPath: POLICY_GENERIC, reasonCodes: ["POLICY_AUTO_GENERIC"] };
    }
    if (isHtmlFile(normalized)) {
      return { ok: true, policyPath: POLICY_WEB, reasonCodes: ["POLICY_AUTO_FILE_HTML_WEB"] };
    }
  } catch {
    return { ok: false, policyPath: "", reasonCodes: ["INPUT_INVALID"], reason: "INPUT_INVALID" };
  }
  return { ok: true, policyPath: POLICY_GENERIC, reasonCodes: ["POLICY_AUTO_GENERIC"] };
};

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
    pipelineId: "WEFTEND_SAFE_RUN_V0",
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

const buildReleaseManifest = (
  planDigest: string,
  policyDigest: string,
  blockHash: string,
  pathDigest: string,
  evidenceHead: string,
  keyId: string,
  cryptoPort: { sign?: (payload: string, keyId: string) => { algo: string; keyId: string; sig: string } }
): ReleaseManifestV0 => {
  const manifestBody: ReleaseManifestV0["manifestBody"] = {
    planDigest,
    policyDigest,
    blocks: [blockHash],
    pathDigest,
    evidenceJournalHead: evidenceHead,
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

const buildRuntimeBundle = (
  blockHash: string,
  policyDigest: string,
  sourceText: string,
  planSnapshot: PlanSnapshotV0
): RuntimeBundle => {
  const manifestId = `manifest-${blockHash}`;
  const pageId = "page:/safe-run";
  const pageNode = {
    id: pageId,
    class: "ui.static",
    dependencies: [{ id: blockHash, required: true, role: "entry" }],
    stamps: [],
    capabilityRequests: [],
  };
  const blockNode = {
    id: blockHash,
    class: "ui.static",
    dependencies: [],
    stamps: [],
    capabilityRequests: [],
    artifact: { kind: "inline", mime: "text/javascript", text: sourceText, entry: "main" },
    title: "safe-run",
  };
  const manifest = {
    id: manifestId,
    version: "2.6",
    rootPageId: pageId,
    nodes: [pageNode, blockNode],
    createdAt: "1970-01-01T00:00:00.000Z",
    createdBy: "weftend.safe-run",
  };
  const planBody = {
    manifestId,
    policyId: policyDigest,
    nodes: [
      { nodeId: blockHash, allowExecute: true, grantedCaps: [], tier: "cache.global" },
      { nodeId: pageId, allowExecute: true, grantedCaps: [], tier: "cache.global" },
    ],
  };
  const planHash = computeArtifactDigestV0(canonicalJSON(planBody));
  const plan = { ...planBody, planHash };
  const trustNodes = [
    {
      nodeId: blockHash,
      status: "trusted",
      reasons: [],
      grants: [],
      digest: { grantedCaps: [], inputsHash: null, outputHash: null, producerHash: null },
    },
    {
      nodeId: pageId,
      status: "trusted",
      reasons: [],
      grants: [],
      digest: { grantedCaps: [], inputsHash: null, outputHash: null, producerHash: null },
    },
  ];
  const trust = { manifestId, policyId: policyDigest, nodes: trustNodes };
  const compiler = {
    compilerId: "weftend.safe-run",
    compilerVersion: "0.0.0",
    builtAt: "1970-01-01T00:00:00.000Z",
    manifestHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    trustHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    planHash,
  };

  return { manifest, trust, plan, compiler, planSnapshot } as RuntimeBundle;
};

const buildLocalRelease = (
  mint: WeftendMintPackageV1,
  decision: IntakeDecisionV1,
  capture: ReturnType<typeof examineArtifactV1>["capture"],
  releaseDir: string
): { ok: boolean; reasonCodes?: string[] } => {
  const entry = pickStrictEntry(capture);
  if (!entry) return { ok: false, reasonCodes: ["SAFE_RUN_ENTRY_MISSING"] };

  let sourceText = "";
  try {
    sourceText = readTextFile(entry.absPath);
  } catch {
    return { ok: false, reasonCodes: ["SAFE_RUN_ENTRY_READ_FAILED"] };
  }

  const planDigest = mint.digests.mintDigest;
  const policyDigest = decision.policyId;
  const blockHash = `block:${mint.input.rootDigest}`;
  const expectedSourceDigest = computeArtifactDigestV0(sourceText);
  const planSnapshot = buildPlanSnapshotForRun(planDigest, policyDigest, blockHash, expectedSourceDigest);
  const pathDigest = computePathDigestV0(planSnapshot.pathSummary);

  const evidence = { schema: "weftend.evidence/0", records: [] };
  const evidenceHead = computeEvidenceBundleDigestV0(evidence);

  const demoKeyId = "weftend-safe-run-key";
  const demoCrypto = makeDemoCryptoPort("weftend-safe-run");
  const releaseManifest = buildReleaseManifest(
    planDigest,
    policyDigest,
    blockHash,
    pathDigest,
    evidenceHead,
    demoKeyId,
    demoCrypto
  );
  const publicKey = deriveDemoPublicKey("weftend-safe-run");

  const runtimeBundle = buildRuntimeBundle(blockHash, policyDigest, sourceText, planSnapshot);

  fs.mkdirSync(releaseDir, { recursive: true });
  writeFile(path.join(releaseDir, "release_manifest.json"), `${canonicalJSON(releaseManifest)}\n`);
  writeFile(path.join(releaseDir, "runtime_bundle.json"), `${canonicalJSON(runtimeBundle)}\n`);
  writeFile(path.join(releaseDir, "evidence.json"), `${canonicalJSON(evidence)}\n`);
  writeFile(path.join(releaseDir, "release_public_key.json"), `${canonicalJSON({ keyId: demoKeyId, publicKey })}\n`);
  return { ok: true };
};

const isReleaseDir = (inputPath: string): boolean => {
  try {
    const manifestPath = path.join(inputPath, "release_manifest.json");
    const bundlePath = path.join(inputPath, "runtime_bundle.json");
    return fs.existsSync(manifestPath) && fs.existsSync(bundlePath);
  } catch {
    return false;
  }
};

const buildSafeRunReceipt = (input: Omit<SafeRunReceiptV0, "receiptDigest">): SafeRunReceiptV0 => {
  const receipt: SafeRunReceiptV0 = {
    ...input,
    receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  receipt.receiptDigest = computeSafeRunReceiptDigestV0(receipt);
  return receipt;
};

const analysisVerdictFromAction = (action: string): SafeRunAnalysisVerdictV0 => {
  if (action === "APPROVE") return "ALLOW";
  if (action === "REJECT" || action === "HOLD") return "DENY";
  return "WITHHELD";
};

const summarizeInputKind = (artifactKind: ArtifactKindV0): string => {
  if (artifactKind === "RELEASE_DIR") return "release";
  if (artifactKind === "NATIVE_EXE" || artifactKind === "NATIVE_MSI") return "native";
  if (artifactKind === "SHORTCUT_LNK") return "shortcut";
  return "raw";
};

const summarizeSafeRun = (receipt: SafeRunReceiptV0, privacyVerdict: "PASS" | "FAIL"): string => {
  const reason = receipt.topReasonCode && receipt.topReasonCode.length > 0 ? receipt.topReasonCode : "-";
  const inputKind = summarizeInputKind(receipt.artifactKind);
  return `SAFE_RUN ${receipt.analysisVerdict} inputKind=${inputKind} kind=${receipt.artifactKind} exec=${receipt.executionVerdict} reason=${reason} ${formatBuildDigestSummaryV0(receipt.weftendBuild)} privacyLint=${privacyVerdict}`;
};

const toExecutionResult = (verdict: SafeRunExecutionVerdictV0): "ALLOW" | "DENY" | "SKIP" | "WITHHELD" =>
  verdict === "ALLOW" ? "ALLOW" : verdict === "DENY" ? "DENY" : "WITHHELD";

const topReason = (...arrays: Array<string[] | undefined>): string => {
  for (const arr of arrays) {
    if (!arr || arr.length === 0) continue;
    const sorted = stableSortUniqueReasonsV0(arr.filter((v) => typeof v === "string" && v.length > 0));
    if (sorted.length > 0) return sorted[0];
  }
  return "-";
};

type CapabilityLedgerEntryV0 = {
  capId: string;
  reasonCodes: string[];
};

type CapabilityLedgerV0 = {
  schema: "weftend.capabilityLedger/0";
  schemaVersion: 0;
  mode: "analysis_only";
  requestedCaps: CapabilityLedgerEntryV0[];
  grantedCaps: CapabilityLedgerEntryV0[];
  deniedCaps: CapabilityLedgerEntryV0[];
  reasonCodes: string[];
};

const sortSubReceipts = (items: Array<{ name: string; digest: string }>): Array<{ name: string; digest: string }> =>
  items
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : cmpStrV0(a.digest, b.digest)));

const normalizePluginList = (plugins: string[]): string[] =>
  Array.from(
    new Set(
      (Array.isArray(plugins) ? plugins : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => value.length > 0)
    )
  ).sort((a, b) => cmpStrV0(a, b));

const sortLedgerEntries = (entries: CapabilityLedgerEntryV0[]): CapabilityLedgerEntryV0[] =>
  entries
    .slice()
    .sort((a, b) => cmpStrV0(a.capId, b.capId))
    .map((entry) => ({ capId: entry.capId, reasonCodes: stableSortUniqueReasonsV0(entry.reasonCodes) }));

const mergeLedgerEntry = (map: Map<string, Set<string>>, capId: string, reasonCodes: string[] = []) => {
  if (!capId || capId.length === 0) return;
  if (!map.has(capId)) map.set(capId, new Set<string>());
  const bag = map.get(capId);
  if (!bag) return;
  reasonCodes.forEach((code) => {
    const normalized = String(code || "").trim();
    if (normalized.length > 0) bag.add(normalized);
  });
};

const materializeLedgerEntries = (map: Map<string, Set<string>>): CapabilityLedgerEntryV0[] => {
  const out: CapabilityLedgerEntryV0[] = [];
  map.forEach((reasons, capId) => {
    out.push({ capId, reasonCodes: stableSortUniqueReasonsV0(Array.from(reasons.values())) });
  });
  return sortLedgerEntries(out);
};

const adapterClassFromMeta = (adapterResult: AdapterRunResultV1, selection: AdapterSelectionV1): string => {
  const adapterId = String(adapterResult.adapter?.adapterId || "").trim().toLowerCase();
  if (adapterId.endsWith("_adapter_v1")) return adapterId.slice(0, -"_adapter_v1".length);
  if (selection === "auto") return "auto";
  return String(selection);
};

const buildCapabilityLedgerV0 = (input: {
  selection: AdapterSelectionV1;
  enabledPlugins: string[];
  adapterResult: AdapterRunResultV1;
}): CapabilityLedgerV0 => {
  const requested = new Map<string, Set<string>>();
  const granted = new Map<string, Set<string>>();
  const denied = new Map<string, Set<string>>();
  const selectionCapId = `adapter.selection.${input.selection}`;
  const resultReasons = stableSortUniqueReasonsV0(input.adapterResult.reasonCodes ?? []);
  const failCode = String(input.adapterResult.failCode || "").trim();
  const plugins = normalizePluginList(input.enabledPlugins);

  mergeLedgerEntry(requested, selectionCapId, []);
  if (input.selection !== "none") {
    mergeLedgerEntry(requested, `adapter.route.${adapterClassFromMeta(input.adapterResult, input.selection)}`, []);
  }
  plugins.forEach((name) => mergeLedgerEntry(requested, `plugin.command.${name}`, []));

  if (input.adapterResult.ok) {
    mergeLedgerEntry(granted, selectionCapId, ["ADAPTER_SELECTION_GRANTED"]);
    if (input.selection !== "none") {
      mergeLedgerEntry(granted, `adapter.route.${adapterClassFromMeta(input.adapterResult, input.selection)}`, resultReasons);
    }
    plugins.forEach((name) => {
      if (input.adapterResult.adapter?.mode === "plugin") {
        mergeLedgerEntry(granted, `plugin.command.${name}`, ["ADAPTER_PLUGIN_USED"]);
      } else {
        mergeLedgerEntry(denied, `plugin.command.${name}`, ["ADAPTER_PLUGIN_UNUSED"]);
      }
    });
  } else {
    const deniedReasons = stableSortUniqueReasonsV0([...(failCode ? [failCode] : []), ...resultReasons]);
    mergeLedgerEntry(denied, selectionCapId, deniedReasons);
    if (input.selection !== "none") {
      mergeLedgerEntry(denied, `adapter.route.${adapterClassFromMeta(input.adapterResult, input.selection)}`, deniedReasons);
    }
    plugins.forEach((name) => mergeLedgerEntry(denied, `plugin.command.${name}`, deniedReasons));
  }

  return {
    schema: "weftend.capabilityLedger/0",
    schemaVersion: 0,
    mode: "analysis_only",
    requestedCaps: materializeLedgerEntries(requested),
    grantedCaps: materializeLedgerEntries(granted),
    deniedCaps: materializeLedgerEntries(denied),
    reasonCodes: stableSortUniqueReasonsV0([...(failCode ? [failCode] : []), ...resultReasons]),
  };
};

export const runSafeRun = async (options: SafeRunCliOptionsV0): Promise<number> => {
  const weftendBuild = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  const withholdExec = Boolean(options.withholdExec);
  const executeRequested = Boolean(options.executeRequested) && !withholdExec;
  const adapterSelection: AdapterSelectionV1 = options.adapter ?? "auto";
  const enabledPlugins = Array.isArray(options.enablePlugins) ? options.enablePlugins : [];
  const resolvedInput = path.resolve(process.cwd(), options.inputPath || "");
  if (!options.inputPath || !fs.existsSync(resolvedInput)) {
    console.error("[INPUT_INVALID] input path missing.");
    return 40;
  }
  try {
    const stat = fs.lstatSync(resolvedInput);
    if (stat.isDirectory() && path.basename(resolvedInput).toLowerCase() === "email_export") {
      const manifestPath = path.join(resolvedInput, "adapter_manifest.json");
      if (!fs.existsSync(manifestPath)) {
        console.error("[ADAPTER_NORMALIZATION_INVALID] missing adapter manifest.");
        return 40;
      }
      const parsed = JSON.parse(readTextFile(manifestPath));
      const issues = validateNormalizedArtifactV0(parsed, "adapterManifest");
      if (issues.length > 0) {
        console.error("[ADAPTER_NORMALIZATION_INVALID] invalid adapter normalization markers.");
        return 40;
      }
      const required = Array.isArray(parsed.requiredFiles) ? parsed.requiredFiles : [];
      for (const rel of required) {
        if (typeof rel !== "string" || rel.length === 0 || !fs.existsSync(path.join(resolvedInput, rel))) {
          console.error("[ADAPTER_NORMALIZATION_INVALID] missing required normalized artifact file.");
          return 40;
        }
      }
    }
  } catch {
    console.error("[ADAPTER_NORMALIZATION_INVALID] failed to validate normalized artifact.");
    return 40;
  }
  const selected = selectPolicyPath(options.inputPath, options.policyPath);
  if (!selected.ok) {
    console.error("[INPUT_INVALID] unable to resolve policy for input.");
    return 40;
  }
  const policyPath = selected.policyPath;
  if (!policyPath || !fs.existsSync(policyPath)) {
    console.error("[POLICY_MISSING] default policy file not found.");
    return 40;
  }
  let policyRaw: unknown;
  try {
    policyRaw = JSON.parse(readTextFile(policyPath));
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
  const policyId = computeWeftEndPolicyIdV1(policy);
  const effectiveProfile: MintProfileV1 = options.policyPath ? options.profile : (policy.profile as MintProfileV1);
  const classified = classifyArtifactKindV0(options.inputPath);
  const policyMatch = {
    selectedPolicy: path.basename(policyPath),
    reasonCodes: selected.reasonCodes ?? [],
  };

  const finalOutDir = options.outDir;
  if (pathsOverlap(resolvedInput, finalOutDir)) {
    console.error("[SAFE_RUN_OUT_CONFLICTS_INPUT] --out must not equal or overlap the input path.");
    return 40;
  }
  if (options.policyPath && pathsOverlap(options.policyPath, finalOutDir)) {
    console.error("[SAFE_RUN_OUT_CONFLICTS_POLICY] --out must not equal or overlap the --policy path.");
    return 40;
  }
  if (options.scriptPath && pathsOverlap(options.scriptPath, finalOutDir)) {
    console.error("[SAFE_RUN_OUT_CONFLICTS_SCRIPT] --out must not equal or overlap the --script path.");
    return 40;
  }
  if (fs.existsSync(finalOutDir)) {
    try {
      if (!fs.statSync(finalOutDir).isDirectory()) {
        console.error("[SAFE_RUN_OUT_PATH_NOT_DIRECTORY] --out must be a directory path or a missing path.");
        return 40;
      }
    } catch {
      console.error("[SAFE_RUN_OUT_PATH_INVALID] unable to inspect --out path.");
      return 40;
    }
  }
  const adapterPolicyFile = String(process?.env?.[ADAPTER_DISABLE_FILE_ENV_V1] || "").trim();
  if (adapterPolicyFile && pathsOverlap(adapterPolicyFile, finalOutDir)) {
    console.error("[SAFE_RUN_OUT_CONFLICTS_ADAPTER_POLICY_FILE] --out must not equal or overlap WEFTEND_ADAPTER_DISABLE_FILE.");
    return 40;
  }
  const stage = prepareStagedOutRoot(finalOutDir);
  if (!stage.ok) {
    console.error("[SAFE_RUN_STAGE_INIT_FAILED] unable to initialize staged output path.");
    return 1;
  }
  const outDir = stage.stageOutDir;
  const hadPreexistingOutput = stage.hadPreexistingOutput;
  const hostDir = path.join(outDir, "host");
  const analysisDir = path.join(outDir, "analysis");
  const releaseDir = path.join(outDir, "release");

  const finalize = (receipt: SafeRunReceiptV0, extraWarnings: string[] = []) => {
    const issues = validateSafeRunReceiptV0(receipt, "safeRunReceipt");
    if (issues.length > 0) {
      console.error("[SAFE_RUN_RECEIPT_INVALID]");
      return { ok: false as const, code: 1 };
    }

    const baseWarnings = stableSortUniqueReasonsV0([
      ...(receipt.weftendBuild.reasonCodes ?? []),
      ...(receipt.execution.reasonCodes ?? []),
      ...(hadPreexistingOutput ? ["SAFE_RUN_EVIDENCE_ORPHAN_OUTPUT"] : []),
      ...extraWarnings,
    ]);
    const readmeText = buildReceiptReadmeV0(receipt.weftendBuild, receipt.schemaVersion);

    writeFile(path.join(outDir, "safe_run_receipt.json"), `${canonicalJSON(receipt)}\n`);
    writeFile(path.join(outDir, "weftend", "README.txt"), readmeText);
    const entryMap = new Map<string, OperatorReceiptEntryV0>();
    const addEntry = (kind: string, relPath: string, digest: string) => {
      const k = `${kind}|${relPath}|${digest}`;
      if (entryMap.has(k)) return;
      entryMap.set(k, { kind, relPath, digest });
    };
    addEntry("safe_run_receipt", "safe_run_receipt.json", receipt.receiptDigest);
    addEntry("receipt_readme", "weftend/README.txt", digestText(readmeText));
    if (receipt.hostReceiptDigest) {
      addEntry("host_run_receipt", "host/host_run_receipt.json", receipt.hostReceiptDigest);
    }
    (receipt.subReceipts ?? []).forEach((item) => {
      const relPath = String(item.name || "").replace(/\\/g, "/");
      const digest = String(item.digest || "");
      if (!relPath || !digest) return;
      const kind = relPath.startsWith("analysis/")
        ? "analysis_receipt"
        : relPath.startsWith("host/")
          ? "host_run_receipt"
          : "run_artifact";
      addEntry(kind, relPath, digest);
    });
    const entries = Array.from(entryMap.values());
    const buildAndWriteOperator = (warnings: string[]) => {
      const operatorReceipt = buildOperatorReceiptV0({
        command: "safe-run",
        weftendBuild: receipt.weftendBuild,
        schemaVersion: receipt.schemaVersion,
        entries,
        warnings,
        contentSummary: receipt.contentSummary,
      });
      writeOperatorReceiptV0(outDir, operatorReceipt);
      return operatorReceipt;
    };
    let operatorReceipt = buildAndWriteOperator(baseWarnings);
    const evidenceWarnings = evaluateEvidenceWarnings({
      outDir,
      receipt,
      operatorReceiptDigest: operatorReceipt.receiptDigest,
      readmeText,
    });
    if (evidenceWarnings.length > 0) {
      operatorReceipt = buildAndWriteOperator(stableSortUniqueReasonsV0([...baseWarnings, ...evidenceWarnings]));
    }
    const privacy = runPrivacyLintV0({ root: outDir, weftendBuild: receipt.weftendBuild });
    if (!finalizeStagedOutRoot(outDir, finalOutDir)) {
      console.error("[SAFE_RUN_FINALIZE_FAILED] unable to finalize staged output.");
      return { ok: false as const, code: 1 };
    }
    const libraryUpdate = (() => {
      try {
        return updateLibraryViewFromRunV0({
          outDir: finalOutDir,
          privacyVerdict: privacy.report.verdict,
          hostSelfStatus: receipt.hostSelfStatus,
          hostSelfReasonCodes: receipt.hostSelfReasonCodes ?? [],
        });
      } catch {
        return { ok: false, code: "LIBRARY_VIEW_UPDATE_FAILED", skipped: false };
      }
    })();
    if (!libraryUpdate.ok && !libraryUpdate.skipped) {
      console.error(`[${libraryUpdate.code ?? "LIBRARY_VIEW_UPDATE_FAILED"}] library view update failed.`);
    }
    console.log(summarizeSafeRun(receipt, privacy.report.verdict));
    return { ok: true as const, code: 0 };
  };

  if (classified.artifactKind === "RELEASE_DIR") {
    const meta = loadReleaseMeta(options.inputPath);
    if (!meta.ok) {
      fs.rmSync(outDir, { recursive: true, force: true });
      console.error("[INPUT_INVALID] release input invalid.");
      meta.reasonCodes.forEach((code) => console.error(`[${code}] release input invalid.`));
      return 40;
    }
    const releaseCapture = captureTreeV0(options.inputPath, DEFAULT_CAPTURE_LIMITS);
    const releaseDetect = detectLayersV0(releaseCapture, DEFAULT_DETECT_LIMITS);
    const releaseSummary = buildContentSummaryV0({
      inputPath: options.inputPath,
      capture: releaseCapture,
      observations: releaseDetect.observations,
      artifactKind: classified.artifactKind,
      policyMatch,
    });

    if (!executeRequested) {
      const reasonCodes = stableSortUniqueReasonsV0(
        withholdExec ? ["SAFE_RUN_WITHHOLD_EXEC_REQUESTED"] : ["SAFE_RUN_EXECUTION_NOT_REQUESTED"]
      );
      const receipt = buildSafeRunReceipt({
        schema: "weftend.safeRunReceipt/0",
        v: 0,
        schemaVersion: 0,
        weftendBuild,
        inputKind: "release",
        artifactKind: classified.artifactKind,
        entryHint: classified.entryHint,
        analysisVerdict: "WITHHELD",
        executionVerdict: "NOT_ATTEMPTED",
        topReasonCode: topReason(reasonCodes, classified.reasonCodes),
        ...(meta.releaseId ? { releaseId: meta.releaseId } : {}),
        releaseDirDigest: meta.releaseDirDigest || "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        policyId,
        contentSummary: releaseSummary,
        execution: { result: toExecutionResult("NOT_ATTEMPTED"), reasonCodes },
        subReceipts: [],
      });
      const out = finalize(receipt, classified.reasonCodes);
      return out.code;
    }

    const host = await runHostStrictV0({ releaseDir: options.inputPath, outDir: hostDir });
    const hostReceipt = host.receipt;
    const executeReasons = stableSortUniqueReasonsV0(hostReceipt.execute.reasonCodes ?? []);
    const executionVerdict: SafeRunExecutionVerdictV0 =
      hostReceipt.execute.result === "ALLOW"
        ? "ALLOW"
        : hostReceipt.execute.result === "DENY"
          ? "DENY"
          : "SKIP";
    const fatalReleaseCodes = executeReasons.filter(
      (code) =>
        code === "VERIFY_DENIED" ||
        code.startsWith("RELEASE_") ||
        code.startsWith("EVIDENCE_") ||
        code.startsWith("PUBLIC_KEY_") ||
        code.startsWith("RUNTIME_BUNDLE_") ||
        code === "HOST_INPUT_OVERSIZE"
    );
    const analysisVerdict: SafeRunAnalysisVerdictV0 =
      executionVerdict === "ALLOW" ? "ALLOW" : fatalReleaseCodes.length > 0 || executionVerdict === "DENY" ? "DENY" : "WITHHELD";
    const topReasonCode = topReason(
      executeReasons,
      hostReceipt.hostSelfReasonCodes ?? [],
      hostReceipt.verify.reasonCodes ?? [],
      classified.reasonCodes
    );
    const receipt = buildSafeRunReceipt({
      schema: "weftend.safeRunReceipt/0",
      v: 0,
      schemaVersion: 0,
      weftendBuild,
      inputKind: "release",
      artifactKind: classified.artifactKind,
      entryHint: classified.entryHint,
      analysisVerdict,
      executionVerdict,
      topReasonCode,
      ...(hostReceipt.releaseId ? { releaseId: hostReceipt.releaseId } : {}),
      releaseDirDigest: hostReceipt.releaseDirDigest,
      policyId,
      hostReceiptDigest: hostReceipt.receiptDigest,
      ...(hostReceipt.hostSelfId ? { hostSelfId: hostReceipt.hostSelfId } : {}),
      ...(hostReceipt.hostSelfStatus ? { hostSelfStatus: hostReceipt.hostSelfStatus } : {}),
      ...(hostReceipt.hostSelfReasonCodes ? { hostSelfReasonCodes: hostReceipt.hostSelfReasonCodes } : {}),
      contentSummary: releaseSummary,
      execution: {
        result: toExecutionResult(executionVerdict),
        reasonCodes: executeReasons,
      },
      subReceipts: [{ name: "host/host_run_receipt.json", digest: hostReceipt.receiptDigest }],
    });
    const out = finalize(receipt, [
      ...classified.reasonCodes,
      ...(hostReceipt.verify.reasonCodes ?? []),
      ...(hostReceipt.hostSelfReasonCodes ?? []),
    ]);
    if (!out.ok) return out.code;
    if (analysisVerdict === "DENY" && fatalReleaseCodes.length > 0) return 40;
    return 0;
  }

  let scriptText: string | undefined;
  if (options.scriptPath) {
    try {
      scriptText = readTextFile(options.scriptPath);
    } catch {
      fs.rmSync(outDir, { recursive: true, force: true });
      console.error("[SCRIPT_INVALID] unable to read script file.");
      return 40;
    }
  }

  const result = examineArtifactV1(options.inputPath, {
    profile: effectiveProfile,
    scriptText,
  });
  const classifiedRaw = classifyArtifactKindV0(options.inputPath, result.capture);
  const mintIssues = validateMintPackageV1(result.mint, "mint");
  if (mintIssues.length > 0) {
    fs.rmSync(outDir, { recursive: true, force: true });
    console.error("[MINT_INVALID]");
    mintIssues.forEach((issue) => {
      const loc = issue.path ? ` (${issue.path})` : "";
      console.error(`${issue.code}: ${issue.message}${loc}`);
    });
    return 40;
  }

  const output = buildIntakeDecisionV1(result.mint, policy, { scriptText });
  const mintJson = `${canonicalJSON(result.mint)}\n`;
  const mintTxt = `${result.report}\n`;
  const decisionJson = `${canonicalJSON(output.decision)}\n`;
  const disclosureTxt = `${output.disclosure}\n`;
  const appealJson = `${canonicalJSON(output.appeal)}\n`;
  const baseSubReceipts: Array<{ name: string; digest: string }> = sortSubReceipts([
    { name: "analysis/appeal_bundle.json", digest: digestText(appealJson) },
    { name: "analysis/disclosure.txt", digest: digestText(disclosureTxt) },
    { name: "analysis/intake_decision.json", digest: digestText(decisionJson) },
    { name: "analysis/weftend_mint_v1.json", digest: digestText(mintJson) },
    { name: "analysis/weftend_mint_v1.txt", digest: digestText(mintTxt) },
  ]);

  writeFile(path.join(analysisDir, "weftend_mint_v1.json"), mintJson);
  writeFile(path.join(analysisDir, "weftend_mint_v1.txt"), mintTxt);
  writeFile(path.join(analysisDir, "intake_decision.json"), decisionJson);
  writeFile(path.join(analysisDir, "disclosure.txt"), disclosureTxt);
  writeFile(path.join(analysisDir, "appeal_bundle.json"), appealJson);

  const adapterResult = runArtifactAdapterV1({
    selection: adapterSelection,
    enabledPlugins,
    inputPath: options.inputPath,
    capture: result.capture,
  });
  const capabilityLedger = buildCapabilityLedgerV0({
    selection: adapterSelection,
    enabledPlugins,
    adapterResult,
  });
  const capabilityLedgerJson = `${canonicalJSON(capabilityLedger)}\n`;
  writeFile(path.join(analysisDir, "capability_ledger_v0.json"), capabilityLedgerJson);
  const capabilityLedgerSubReceipt = {
    name: "analysis/capability_ledger_v0.json",
    digest: digestText(capabilityLedgerJson),
  };
  if (!adapterResult.ok) {
    const code = adapterResult.failCode || "ADAPTER_PRECONDITION_FAILED";
    const message = adapterResult.failMessage || "adapter precondition failed.";
    const contentSummary = buildContentSummaryV0({
      inputPath: options.inputPath,
      capture: result.capture,
      observations: result.mint.observations,
      artifactKind: classifiedRaw.artifactKind,
      policyMatch,
    });
    const executionVerdict: SafeRunExecutionVerdictV0 = executeRequested ? "SKIP" : "NOT_ATTEMPTED";
    const executionReasonCodes = stableSortUniqueReasonsV0(
      executeRequested
        ? ["INTAKE_NOT_APPROVED", code]
        : [withholdExec ? "SAFE_RUN_WITHHOLD_EXEC_REQUESTED" : "SAFE_RUN_EXECUTION_NOT_REQUESTED", code]
    );
    const receipt = buildSafeRunReceipt({
      schema: "weftend.safeRunReceipt/0",
      v: 0,
      schemaVersion: 0,
      weftendBuild,
      inputKind: "raw",
      artifactKind: classifiedRaw.artifactKind,
      entryHint: classifiedRaw.entryHint,
      analysisVerdict: "DENY",
      executionVerdict,
      topReasonCode: topReason(
        [code, ...(adapterResult.reasonCodes ?? [])],
        output.decision.topReasonCodes,
        classifiedRaw.reasonCodes
      ),
      inputDigest: result.mint.input.rootDigest,
      policyId: output.decision.policyId,
      intakeDecisionDigest: output.decision.decisionDigest,
      contentSummary,
      execution: { result: toExecutionResult(executionVerdict), reasonCodes: executionReasonCodes },
      subReceipts: sortSubReceipts([...baseSubReceipts, capabilityLedgerSubReceipt]),
    });
    const out = finalize(receipt, [...classifiedRaw.reasonCodes, ...output.decision.topReasonCodes, code, ...(adapterResult.reasonCodes ?? [])]);
    console.error(`[${code}] ${message}`);
    if (!out.ok) return out.code;
    return 40;
  }
  const adapterSummaryJson = adapterResult.summary ? `${canonicalJSON(adapterResult.summary)}\n` : "";
  const adapterFindingsJson = adapterResult.findings ? `${canonicalJSON(adapterResult.findings)}\n` : "";
  if (adapterSummaryJson) writeFile(path.join(analysisDir, "adapter_summary_v0.json"), adapterSummaryJson);
  if (adapterFindingsJson) writeFile(path.join(analysisDir, "adapter_findings_v0.json"), adapterFindingsJson);
  const subReceipts: Array<{ name: string; digest: string }> = sortSubReceipts([...baseSubReceipts, capabilityLedgerSubReceipt]);
  if (adapterSummaryJson) {
    subReceipts.push({ name: "analysis/adapter_summary_v0.json", digest: digestText(adapterSummaryJson) });
  }
  if (adapterFindingsJson) {
    subReceipts.push({ name: "analysis/adapter_findings_v0.json", digest: digestText(adapterFindingsJson) });
  }

  let hostReceiptDigest: string | undefined;
  let hostSelfInfo: { hostSelfId?: string; hostSelfStatus?: "OK" | "UNVERIFIED" | "MISSING"; hostSelfReasonCodes?: string[] } = {};
  let executionVerdict: SafeRunExecutionVerdictV0 = executeRequested ? "SKIP" : "NOT_ATTEMPTED";
  let executionReasonCodes: string[] = executeRequested
    ? ["INTAKE_NOT_APPROVED"]
    : [withholdExec ? "SAFE_RUN_WITHHOLD_EXEC_REQUESTED" : "SAFE_RUN_EXECUTION_NOT_REQUESTED"];
  let analysisVerdict: SafeRunAnalysisVerdictV0 = analysisVerdictFromAction(output.decision.action);

  if (output.decision.action === "APPROVE") {
    const unsupportedKinds = new Set<ArtifactKindV0>([
      "NATIVE_EXE",
      "NATIVE_MSI",
      "SHORTCUT_LNK",
      "UNKNOWN",
      "TEXT",
      "ZIP",
    ]);
    if (unsupportedKinds.has(classifiedRaw.artifactKind)) {
      analysisVerdict = "WITHHELD";
      executionVerdict = "NOT_ATTEMPTED";
      if (classifiedRaw.artifactKind === "SHORTCUT_LNK") {
        executionReasonCodes = stableSortUniqueReasonsV0([
          "ARTIFACT_SHORTCUT_UNSUPPORTED",
          "EXECUTION_WITHHELD_UNSUPPORTED_ARTIFACT",
        ]);
      } else if (classifiedRaw.artifactKind === "NATIVE_EXE" || classifiedRaw.artifactKind === "NATIVE_MSI") {
        executionReasonCodes = stableSortUniqueReasonsV0([
          "ARTIFACT_NATIVE_BINARY_WITHHELD",
          "EXECUTION_WITHHELD_UNSUPPORTED_ARTIFACT",
        ]);
      } else {
        executionReasonCodes = stableSortUniqueReasonsV0(
          classifiedRaw.artifactKind === "UNKNOWN" && result.capture.kind === "dir"
            ? ["SAFE_RUN_NO_ENTRYPOINT_FOUND", "ANALYSIS_ONLY_UNKNOWN_ARTIFACT"]
            : ["ANALYSIS_ONLY_NO_EXECUTION_LANE"]
        );
      }
      if (!executeRequested) {
        executionReasonCodes = stableSortUniqueReasonsV0([
          withholdExec ? "SAFE_RUN_WITHHOLD_EXEC_REQUESTED" : "SAFE_RUN_EXECUTION_NOT_REQUESTED",
          ...executionReasonCodes,
        ]);
      }
    } else if (executeRequested) {
      const built = buildLocalRelease(result.mint, output.decision, result.capture, releaseDir);
      if (built.ok) {
        const host = await runHostStrictV0({ releaseDir, outDir: hostDir });
        hostReceiptDigest = host.receipt.receiptDigest;
        hostSelfInfo = {
          ...(host.receipt.hostSelfId ? { hostSelfId: host.receipt.hostSelfId } : {}),
          ...(host.receipt.hostSelfStatus ? { hostSelfStatus: host.receipt.hostSelfStatus } : {}),
          ...(host.receipt.hostSelfReasonCodes ? { hostSelfReasonCodes: host.receipt.hostSelfReasonCodes } : {}),
        };
        subReceipts.push({ name: "host/host_run_receipt.json", digest: host.receipt.receiptDigest });
        executionVerdict =
          host.receipt.execute.result === "ALLOW"
            ? "ALLOW"
            : host.receipt.execute.result === "DENY"
              ? "DENY"
              : "SKIP";
        executionReasonCodes = stableSortUniqueReasonsV0(host.receipt.execute.reasonCodes ?? []);
        analysisVerdict = executionVerdict === "ALLOW" ? "ALLOW" : executionVerdict === "DENY" ? "DENY" : "WITHHELD";
      } else {
        executionVerdict = "SKIP";
        const mapped = (built.reasonCodes ?? ["SAFE_RUN_RELEASE_FAILED"]).map((code) =>
          code === "SAFE_RUN_ENTRY_MISSING" ? "SAFE_RUN_NO_ENTRYPOINT_FOUND" : code
        );
        executionReasonCodes = stableSortUniqueReasonsV0(mapped);
        analysisVerdict = "WITHHELD";
      }
    } else {
      const entry = pickStrictEntry(result.capture);
      if (!entry) {
        executionVerdict = "NOT_ATTEMPTED";
        executionReasonCodes = stableSortUniqueReasonsV0([
          withholdExec ? "SAFE_RUN_WITHHOLD_EXEC_REQUESTED" : "SAFE_RUN_EXECUTION_NOT_REQUESTED",
          "SAFE_RUN_NO_ENTRYPOINT_FOUND",
        ]);
        analysisVerdict = "WITHHELD";
      } else {
        executionVerdict = "NOT_ATTEMPTED";
        executionReasonCodes = stableSortUniqueReasonsV0([
          withholdExec ? "SAFE_RUN_WITHHOLD_EXEC_REQUESTED" : "SAFE_RUN_EXECUTION_NOT_REQUESTED",
        ]);
        analysisVerdict = "WITHHELD";
      }
    }
  } else {
    executionVerdict = executeRequested ? "SKIP" : "NOT_ATTEMPTED";
    executionReasonCodes = stableSortUniqueReasonsV0(
      executeRequested
        ? ["INTAKE_NOT_APPROVED"]
        : [withholdExec ? "SAFE_RUN_WITHHOLD_EXEC_REQUESTED" : "SAFE_RUN_EXECUTION_NOT_REQUESTED", "INTAKE_NOT_APPROVED"]
    );
  }

  const sortedSubReceipts = sortSubReceipts(subReceipts);

  const contentSummary = buildContentSummaryV0({
    inputPath: options.inputPath,
    capture: result.capture,
    observations: result.mint.observations,
    artifactKind: classifiedRaw.artifactKind,
    policyMatch,
  });
  if (adapterResult.adapterSignals) {
    contentSummary.adapterSignals = adapterResult.adapterSignals;
  }

  const receipt = buildSafeRunReceipt({
    schema: "weftend.safeRunReceipt/0",
    v: 0,
    schemaVersion: 0,
    weftendBuild,
    inputKind: "raw",
    artifactKind: classifiedRaw.artifactKind,
    entryHint: classifiedRaw.entryHint,
    analysisVerdict,
    executionVerdict,
    topReasonCode: topReason(executionReasonCodes, adapterResult.reasonCodes, output.decision.topReasonCodes, classifiedRaw.reasonCodes),
    inputDigest: result.mint.input.rootDigest,
    policyId: output.decision.policyId,
    intakeDecisionDigest: output.decision.decisionDigest,
    ...(hostReceiptDigest ? { hostReceiptDigest } : {}),
    ...hostSelfInfo,
    ...(adapterResult.adapter ? { adapter: adapterResult.adapter } : {}),
    contentSummary,
    execution: { result: toExecutionResult(executionVerdict), reasonCodes: executionReasonCodes },
    subReceipts: sortedSubReceipts,
  });

  const out = finalize(receipt, [...classifiedRaw.reasonCodes, ...output.decision.topReasonCodes, ...adapterResult.reasonCodes]);
  if (!out.ok) return out.code;
  return 0;
};
