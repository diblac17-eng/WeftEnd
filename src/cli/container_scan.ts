/* src/cli/container_scan.ts */
// Container adapter v0: local Docker image inspect -> deterministic safe-run style receipts.

import { canonicalJSON } from "../core/canon";
import { canonicalizeWeftEndPolicyV1, computeWeftEndPolicyIdV1 } from "../core/intake_policy_v1";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { computeSafeRunReceiptDigestV0, validateSafeRunReceiptV0, validateWeftEndPolicyV1 } from "../core/validate";
import type { SafeRunReceiptV0, WeftEndPolicyV1 } from "../core/types";
import { computeArtifactDigestV0 } from "../runtime/store/artifact_store";
import { buildOperatorReceiptV0, writeOperatorReceiptV0 } from "../runtime/operator_receipt";
import { runPrivacyLintV0 } from "../runtime/privacy_lint";
import { writeReceiptReadmeV0 } from "../runtime/receipt_readme";
import { computeWeftendBuildV0, formatBuildDigestSummaryV0 } from "../runtime/weftend_build";
import { updateLibraryViewFromRunV0 } from "./library_state";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const POLICY_GENERIC = path.join(process.cwd(), "policies", "generic_default.json");
const MAX_TOP_DOMAINS = 10;
const MAX_REASON_CODES = 64;
const MAX_IMAGE_REF_CHARS = 256;

type ContainerFlags = Record<string, string | boolean>;

type DockerProbeSuccess = {
  ok: true;
  inputRef: string;
  normalizedInputRef: string;
  imageIdDigest: string;
  resolvedDigest: string;
  layerCount: number;
  totalBytesBounded: number;
  envVarCount: number;
  exposedPortCount: number;
  entrypointPresent: boolean;
  cmdPresent: boolean;
  registryDomain: string | null;
  reasonCodes: string[];
};

type DockerProbeFailure = {
  ok: false;
  code: string;
  message: string;
  reasonCodes: string[];
};

type DockerProbeResult = DockerProbeSuccess | DockerProbeFailure;

const printUsage = () => {
  console.log("Usage:");
  console.log("  weftend container scan <imageRefOrId> --out <dir> [--policy <policy.json>]");
};

const parseArgs = (argv: string[]): { rest: string[]; flags: ContainerFlags } => {
  const args = [...argv];
  const flags: ContainerFlags = {};
  const rest: string[] = [];
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = args.shift();
      flags[key] = value ?? "";
      continue;
    }
    rest.push(token);
  }
  return { rest, flags };
};

const toNonNegativeNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
};

const normalizeDigest = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const rawHex = /^[A-Fa-f0-9]{64}$/.exec(trimmed);
  if (rawHex) return `sha256:${trimmed.toLowerCase()}`;
  const prefixed = /^sha256:([A-Fa-f0-9]{64})$/.exec(trimmed);
  if (prefixed) return `sha256:${prefixed[1].toLowerCase()}`;
  return null;
};

const parseDigestFromRepoDigest = (value: string): string | null => {
  const idx = value.lastIndexOf("@");
  if (idx < 0) return null;
  return normalizeDigest(value.slice(idx + 1));
};

const normalizeImageRef = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_IMAGE_REF_CHARS) return null;
  if (/\s/.test(trimmed)) return null;
  if (/[\\/]/.test(trimmed)) return null;
  return trimmed;
};

const normalizeRegistryDomain = (value: string): string | null => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (!/^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/.test(v)) return null;
  return v;
};

const extractRegistryDomainFromRef = (imageRef: string): string | null => {
  const ref = normalizeImageRef(imageRef);
  if (!ref) return null;
  if (ref.startsWith("sha256:")) return null;
  const firstSegment = ref.split("/")[0] || "";
  if (!firstSegment) return null;
  const isRegistryLike = firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost";
  if (isRegistryLike) return normalizeRegistryDomain(firstSegment);
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(firstSegment)) return "docker.io";
  return null;
};

const readPolicy = (policyPath: string): { ok: true; policy: WeftEndPolicyV1; policyId: string } | { ok: false; code: number } => {
  if (!fs.existsSync(policyPath)) {
    console.error("[POLICY_MISSING] policy file not found.");
    return { ok: false, code: 40 };
  }
  let policyRaw: unknown;
  try {
    policyRaw = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch {
    console.error("[POLICY_INVALID] policy must be valid JSON.");
    return { ok: false, code: 40 };
  }
  const issues = validateWeftEndPolicyV1(policyRaw, "policy");
  if (issues.length > 0) {
    console.error("[POLICY_INVALID]");
    issues.forEach((issue) => {
      const loc = issue.path ? ` (${issue.path})` : "";
      console.error(`${issue.code}: ${issue.message}${loc}`);
    });
    return { ok: false, code: 40 };
  }
  const policy = canonicalizeWeftEndPolicyV1(policyRaw as any);
  const policyId = computeWeftEndPolicyIdV1(policy);
  return { ok: true, policy, policyId };
};

const hasRemoteDockerContext = (): boolean => {
  const host = String(process.env.DOCKER_HOST ?? "").trim();
  if (host.length > 0) return true;
  const context = String(process.env.DOCKER_CONTEXT ?? "").trim().toLowerCase();
  return context.length > 0 && context !== "default";
};

const runDocker = (args: string[]): { status: number; stdout: string; stderr: string; errorCode?: string } => {
  const env = { ...process.env };
  const res = childProcess.spawnSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    env,
  });
  return {
    status: typeof res.status === "number" ? res.status : 1,
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr : "",
    errorCode: res.error?.code ? String(res.error.code) : undefined,
  };
};

const probeDockerImage = (inputRef: string): DockerProbeResult => {
  const normalizedInputRef = normalizeImageRef(inputRef);
  if (!normalizedInputRef) {
    return {
      ok: false,
      code: "DOCKER_IMAGE_REF_INVALID",
      message: "container image reference is invalid.",
      reasonCodes: ["DOCKER_IMAGE_REF_INVALID"],
    };
  }

  if (hasRemoteDockerContext()) {
    return {
      ok: false,
      code: "DOCKER_REMOTE_CONTEXT_UNSUPPORTED",
      message: "remote Docker context is unsupported; unset DOCKER_HOST/DOCKER_CONTEXT for local-only scans.",
      reasonCodes: ["DOCKER_REMOTE_CONTEXT_UNSUPPORTED"],
    };
  }

  const versionRes = runDocker(["version", "--format", "{{json .Client}}"]);
  if (versionRes.errorCode === "ENOENT") {
    return {
      ok: false,
      code: "DOCKER_NOT_AVAILABLE",
      message: "docker command is not available.",
      reasonCodes: ["DOCKER_NOT_AVAILABLE"],
    };
  }
  if (versionRes.status !== 0) {
    return {
      ok: false,
      code: "DOCKER_NOT_AVAILABLE",
      message: "docker command is unavailable or not callable.",
      reasonCodes: ["DOCKER_NOT_AVAILABLE"],
    };
  }

  const inspectRes = runDocker(["image", "inspect", normalizedInputRef]);
  if (inspectRes.errorCode === "ENOENT") {
    return {
      ok: false,
      code: "DOCKER_NOT_AVAILABLE",
      message: "docker command is not available.",
      reasonCodes: ["DOCKER_NOT_AVAILABLE"],
    };
  }
  if (inspectRes.status !== 0) {
    const stderrLower = inspectRes.stderr.toLowerCase();
    if (stderrLower.includes("no such image") || stderrLower.includes("no such object")) {
      return {
        ok: false,
        code: "DOCKER_IMAGE_NOT_LOCAL",
        message: "image is not present locally.",
        reasonCodes: ["DOCKER_IMAGE_NOT_LOCAL"],
      };
    }
    if (stderrLower.includes("cannot connect to the docker daemon")) {
      return {
        ok: false,
        code: "DOCKER_DAEMON_UNAVAILABLE",
        message: "docker daemon is unavailable.",
        reasonCodes: ["DOCKER_DAEMON_UNAVAILABLE"],
      };
    }
    return {
      ok: false,
      code: "DOCKER_IMAGE_INSPECT_FAILED",
      message: "docker image inspect failed.",
      reasonCodes: ["DOCKER_IMAGE_INSPECT_FAILED"],
    };
  }

  let inspect: any;
  try {
    const parsed = JSON.parse(inspectRes.stdout);
    if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== "object" || parsed[0] === null) {
      return {
        ok: false,
        code: "DOCKER_IMAGE_INSPECT_INVALID",
        message: "docker inspect output is invalid.",
        reasonCodes: ["DOCKER_IMAGE_INSPECT_INVALID"],
      };
    }
    inspect = parsed[0];
  } catch {
    return {
      ok: false,
      code: "DOCKER_IMAGE_INSPECT_INVALID",
      message: "docker inspect output is not valid JSON.",
      reasonCodes: ["DOCKER_IMAGE_INSPECT_INVALID"],
    };
  }

  const imageIdDigest = normalizeDigest(inspect.Id);
  const repoDigestsRaw = Array.isArray(inspect.RepoDigests) ? inspect.RepoDigests.filter((v: unknown) => typeof v === "string") : [];
  const digestFromRepo = repoDigestsRaw.map((v: string) => parseDigestFromRepoDigest(v)).find((v: string | null): v is string => typeof v === "string");
  const resolvedDigest =
    digestFromRepo ??
    imageIdDigest ??
    computeArtifactDigestV0(
      canonicalJSON({
        inputRef: normalizedInputRef,
        id: String(inspect.Id ?? ""),
      })
    );

  const layersRaw = Array.isArray(inspect?.RootFS?.Layers) ? inspect.RootFS.Layers.filter((v: unknown) => typeof v === "string") : [];
  const layerCount = layersRaw.length;
  const totalBytesBounded = toNonNegativeNumber(inspect.Size);
  const envVarCount = Array.isArray(inspect?.Config?.Env) ? inspect.Config.Env.length : 0;
  const exposedPortCount = inspect?.Config?.ExposedPorts && typeof inspect.Config.ExposedPorts === "object"
    ? Object.keys(inspect.Config.ExposedPorts).length
    : 0;
  const entrypointPresent =
    (Array.isArray(inspect?.Config?.Entrypoint) && inspect.Config.Entrypoint.length > 0) ||
    (typeof inspect?.Config?.Entrypoint === "string" && inspect.Config.Entrypoint.trim().length > 0);
  const cmdPresent =
    (Array.isArray(inspect?.Config?.Cmd) && inspect.Config.Cmd.length > 0) ||
    (typeof inspect?.Config?.Cmd === "string" && inspect.Config.Cmd.trim().length > 0);
  const registryDomain = extractRegistryDomainFromRef(normalizedInputRef);

  const reasonCodes = stableSortUniqueReasonsV0([
    "CONTAINER_SCAN_ADAPTER_V0",
    "DOCKER_IMAGE_LOCAL_INSPECTED",
    "EXECUTION_WITHHELD_CONTAINER",
  ]).slice(0, MAX_REASON_CODES);

  return {
    ok: true,
    inputRef,
    normalizedInputRef,
    imageIdDigest: imageIdDigest ?? resolvedDigest,
    resolvedDigest,
    layerCount,
    totalBytesBounded,
    envVarCount,
    exposedPortCount,
    entrypointPresent,
    cmdPresent,
    registryDomain,
    reasonCodes,
  };
};

const buildSafeRunReceipt = (input: Omit<SafeRunReceiptV0, "receiptDigest">): SafeRunReceiptV0 => {
  const receipt: SafeRunReceiptV0 = {
    ...input,
    receiptDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  receipt.receiptDigest = computeSafeRunReceiptDigestV0(receipt);
  return receipt;
};

const summarizeContainerScan = (
  receipt: SafeRunReceiptV0,
  privacyVerdict: "PASS" | "FAIL",
  inputRef: string
): string => {
  const reason = receipt.topReasonCode && receipt.topReasonCode.length > 0 ? receipt.topReasonCode : "-";
  return `CONTAINER_SCAN ${receipt.analysisVerdict} inputRef=${inputRef} kind=${receipt.artifactKind} exec=${receipt.executionVerdict} reason=${reason} ${formatBuildDigestSummaryV0(receipt.weftendBuild)} privacyLint=${privacyVerdict}`;
};

const finalizeSuccess = (options: {
  outDir: string;
  inputRef: string;
  policyPath: string;
  policyId: string;
  probe: DockerProbeSuccess;
}): number => {
  const weftendBuild = computeWeftendBuildV0({ filePath: process?.argv?.[1], source: "NODE_MAIN_JS" }).build;
  fs.mkdirSync(options.outDir, { recursive: true });

  const selectedPolicy = path.basename(options.policyPath);
  const registryDomains = options.probe.registryDomain ? [options.probe.registryDomain] : [];
  const externalDomains = stableSortUniqueStringsV0(registryDomains).slice(0, MAX_TOP_DOMAINS);
  const entryHints = stableSortUniqueStringsV0(
    [
      "ENTRY_CONTAINER_IMAGE",
      options.probe.entrypointPresent ? "ENTRY_DOCKER_ENTRYPOINT_PRESENT" : "",
      options.probe.cmdPresent ? "ENTRY_DOCKER_CMD_PRESENT" : "",
    ].filter((v) => v.length > 0)
  );
  const boundednessMarkers = stableSortUniqueStringsV0([
    "BOUND_DOCKER_LOCAL_ONLY",
    "BOUND_DOCKER_INSPECT_ONLY",
    "BOUND_NO_NETWORK",
  ]);

  const topExtensions = options.probe.layerCount > 0 ? [{ ext: "layer", count: options.probe.layerCount }] : [];
  const totalFiles = options.probe.layerCount + 1;

  const contentSummary = {
    targetKind: "file" as const,
    artifactKind: "dataOnly" as const,
    fileCountsByKind: {
      html: 0,
      js: 0,
      css: 0,
      json: 1,
      wasm: 0,
      media: 0,
      binary: options.probe.layerCount,
      other: 0,
    },
    totalFiles,
    totalBytesBounded: options.probe.totalBytesBounded,
    sizeSummary: {
      totalBytesBounded: options.probe.totalBytesBounded,
      truncated: false,
    },
    topExtensions,
    hasNativeBinaries: false,
    hasScripts: false,
    hasHtml: false,
    externalRefs: {
      count: externalDomains.length,
      topDomains: externalDomains,
    },
    entryHints,
    boundednessMarkers,
    archiveDepthMax: 0,
    nestedArchiveCount: 0,
    manifestCount: 1,
    stringsIndicators: {
      urlLikeCount: 0,
      ipLikeCount: 0,
      powershellLikeCount: 0,
      cmdExecLikeCount: 0,
    },
    policyMatch: {
      selectedPolicy,
      reasonCodes: stableSortUniqueReasonsV0(["CONTAINER_POLICY_APPLIED", "POLICY_AUTO_GENERIC"]).slice(0, MAX_REASON_CODES),
    },
    hashFamily: {
      sha256: options.probe.resolvedDigest,
    },
  };

  const reasonCodes = options.probe.reasonCodes;
  const receipt = buildSafeRunReceipt({
    schema: "weftend.safeRunReceipt/0",
    v: 0,
    schemaVersion: 0,
    weftendBuild,
    inputKind: "raw",
    artifactKind: "CONTAINER_IMAGE",
    entryHint: entryHints.length > 0 ? entryHints[0] : null,
    contentSummary,
    analysisVerdict: "WITHHELD",
    executionVerdict: "NOT_ATTEMPTED",
    topReasonCode: reasonCodes.length > 0 ? reasonCodes[0] : "EXECUTION_WITHHELD_CONTAINER",
    inputDigest: options.probe.resolvedDigest,
    policyId: options.policyId,
    execution: {
      result: "WITHHELD",
      reasonCodes,
    },
    subReceipts: [],
  });

  const issues = validateSafeRunReceiptV0(receipt, "safeRunReceipt");
  if (issues.length > 0) {
    console.error("[SAFE_RUN_RECEIPT_INVALID]");
    return 1;
  }

  fs.writeFileSync(path.join(options.outDir, "safe_run_receipt.json"), `${canonicalJSON(receipt)}\n`, "utf8");
  writeReceiptReadmeV0(options.outDir, receipt.weftendBuild, receipt.schemaVersion);

  const operatorReceipt = buildOperatorReceiptV0({
    command: "container scan",
    weftendBuild: receipt.weftendBuild,
    schemaVersion: receipt.schemaVersion,
    entries: [{ kind: "safe_run_receipt", relPath: "safe_run_receipt.json", digest: receipt.receiptDigest }],
    warnings: stableSortUniqueReasonsV0([
      ...(receipt.weftendBuild.reasonCodes ?? []),
      ...reasonCodes,
    ]),
    contentSummary: receipt.contentSummary,
  });
  writeOperatorReceiptV0(options.outDir, operatorReceipt);

  const privacy = runPrivacyLintV0({ root: options.outDir, weftendBuild: receipt.weftendBuild });
  try {
    updateLibraryViewFromRunV0({
      outDir: options.outDir,
      privacyVerdict: privacy.report.verdict,
      hostSelfStatus: receipt.hostSelfStatus,
      hostSelfReasonCodes: receipt.hostSelfReasonCodes ?? [],
    });
  } catch {
    // best-effort library update only
  }

  console.log(summarizeContainerScan(receipt, privacy.report.verdict, options.inputRef));
  return 0;
};

export const runContainerCli = async (argv: string[]): Promise<number> => {
  const { rest, flags } = parseArgs(argv);
  const command = rest[0];
  if (flags.help || command !== "scan") {
    printUsage();
    return 1;
  }

  const inputRef = rest[1];
  const outDir = String(flags["out"] || "");
  if (!inputRef) {
    printUsage();
    return 1;
  }
  if (!outDir) {
    console.error("[OUT_REQUIRED] container scan requires --out <dir>.");
    return 40;
  }

  const policyPath = String(flags["policy"] || POLICY_GENERIC);
  const policyRead = readPolicy(policyPath);
  if (!policyRead.ok) return policyRead.code;

  const probe = probeDockerImage(inputRef);
  if (!probe.ok) {
    console.error(`[${probe.code}] ${probe.message}`);
    return 40;
  }

  return finalizeSuccess({
    outDir,
    inputRef: probe.normalizedInputRef,
    policyPath,
    policyId: policyRead.policyId,
    probe,
  });
};
