/* src/runtime/container/docker_probe_v0.ts */
// Docker cooperative retrieval (local-only, deterministic, inspect-first).

import { canonicalJSON } from "../../core/canon";
import { cmpStrV0 } from "../../core/order";
import { stableSortUniqueReasonsV0, stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";
import { computeArtifactDigestV0 } from "../store/artifact_store";

declare const require: any;
declare const process: any;

const childProcess = require("child_process");

const MAX_REASON_CODES = 64;
const MAX_IMAGE_REF_CHARS = 256;
const MAX_TOP_TAGS = 16;
const MAX_TOP_DIGESTS = 16;

export type DockerProbeSuccessV0 = {
  ok: true;
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
  repoDigestsBounded: string[];
  repoTagsBounded: string[];
  reasonCodes: string[];
};

export type DockerProbeFailureV0 = {
  ok: false;
  code: string;
  message: string;
  reasonCodes: string[];
};

export type DockerProbeResultV0 = DockerProbeSuccessV0 | DockerProbeFailureV0;

export type DockerCommandResultV0 = {
  status: number;
  stdout: string;
  stderr: string;
  errorCode?: string;
};

export type DockerCommandRunnerV0 = (args: string[]) => DockerCommandResultV0;

type ProbeOptionsV0 = {
  runDocker?: DockerCommandRunnerV0;
  env?: {
    dockerHost?: string;
    dockerContext?: string;
  };
};

const toNonNegativeNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
};

export const normalizeDigestV0 = (value: unknown): string | null => {
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
  return normalizeDigestV0(value.slice(idx + 1));
};

export const normalizeImageRefV0 = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_IMAGE_REF_CHARS) return null;
  if (/\s/.test(trimmed)) return null;
  if (/\\/.test(trimmed)) return null;
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) return null;
  if (trimmed.includes("//")) return null;
  return trimmed;
};

const normalizeRegistryDomain = (value: string): string | null => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (!/^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/.test(v)) return null;
  return v;
};

export const extractRegistryDomainFromRefV0 = (imageRef: string): string | null => {
  const ref = normalizeImageRefV0(imageRef);
  if (!ref) return null;
  if (ref.startsWith("sha256:")) return null;
  const firstSegment = ref.split("/")[0] || "";
  if (!firstSegment) return null;
  const isRegistryLike = firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost";
  if (isRegistryLike) return normalizeRegistryDomain(firstSegment);
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(firstSegment)) return "docker.io";
  return null;
};

const hasRemoteDockerContext = (env?: ProbeOptionsV0["env"]): boolean => {
  const host = String(env?.dockerHost ?? process.env.DOCKER_HOST ?? "").trim();
  if (host.length > 0) return true;
  const context = String(env?.dockerContext ?? process.env.DOCKER_CONTEXT ?? "").trim().toLowerCase();
  return context.length > 0 && context !== "default";
};

export const defaultDockerRunnerV0: DockerCommandRunnerV0 = (args) => {
  const res = childProcess.spawnSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env },
  });
  return {
    status: typeof res.status === "number" ? res.status : 1,
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr : "",
    errorCode: res.error?.code ? String(res.error.code) : undefined,
  };
};

const stableSortRecord = (input: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  Object.keys(input)
    .sort((a, b) => cmpStrV0(a, b))
    .forEach((key) => {
      const value = Number(input[key] ?? 0);
      out[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    });
  return out;
};

const parseInspectJson = (normalizedInputRef: string, inspectStdout: string): DockerProbeResultV0 => {
  let inspect: any;
  try {
    const parsed = JSON.parse(inspectStdout);
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

  const imageIdDigest = normalizeDigestV0(inspect.Id);
  const repoDigestsRaw = Array.isArray(inspect.RepoDigests)
    ? inspect.RepoDigests.filter((v: unknown) => typeof v === "string").map((v: string) => v.trim())
    : [];
  const repoDigestsBounded = stableSortUniqueStringsV0(repoDigestsRaw).slice(0, MAX_TOP_DIGESTS);
  const digestFromRepo = repoDigestsBounded
    .map((v: string) => parseDigestFromRepoDigest(v))
    .find((v: string | null): v is string => typeof v === "string");
  const resolvedDigest =
    digestFromRepo ??
    imageIdDigest ??
    computeArtifactDigestV0(
      canonicalJSON({
        inputRef: normalizedInputRef,
        id: String(inspect.Id ?? ""),
      })
    );

  const repoTagsRaw = Array.isArray(inspect.RepoTags)
    ? inspect.RepoTags.filter((v: unknown) => typeof v === "string").map((v: string) => v.trim())
    : [];
  const repoTagsBounded = stableSortUniqueStringsV0(repoTagsRaw).slice(0, MAX_TOP_TAGS);
  const layersRaw = Array.isArray(inspect?.RootFS?.Layers) ? inspect.RootFS.Layers.filter((v: unknown) => typeof v === "string") : [];
  const entrypointPresent =
    (Array.isArray(inspect?.Config?.Entrypoint) && inspect.Config.Entrypoint.length > 0) ||
    (typeof inspect?.Config?.Entrypoint === "string" && inspect.Config.Entrypoint.trim().length > 0);
  const cmdPresent =
    (Array.isArray(inspect?.Config?.Cmd) && inspect.Config.Cmd.length > 0) ||
    (typeof inspect?.Config?.Cmd === "string" && inspect.Config.Cmd.trim().length > 0);
  const registryDomain = extractRegistryDomainFromRefV0(normalizedInputRef);

  const reasonCodes = stableSortUniqueReasonsV0(["CONTAINER_SCAN_ADAPTER_V0", "DOCKER_IMAGE_LOCAL_INSPECTED", "EXECUTION_WITHHELD_CONTAINER"]).slice(
    0,
    MAX_REASON_CODES
  );

  return {
    ok: true,
    normalizedInputRef,
    imageIdDigest: imageIdDigest ?? resolvedDigest,
    resolvedDigest,
    layerCount: layersRaw.length,
    totalBytesBounded: toNonNegativeNumber(inspect.Size),
    envVarCount: Array.isArray(inspect?.Config?.Env) ? inspect.Config.Env.length : 0,
    exposedPortCount:
      inspect?.Config?.ExposedPorts && typeof inspect.Config.ExposedPorts === "object" ? Object.keys(inspect.Config.ExposedPorts).length : 0,
    entrypointPresent,
    cmdPresent,
    registryDomain,
    repoDigestsBounded,
    repoTagsBounded,
    reasonCodes,
  };
};

export const probeDockerImageLocalV0 = (inputRef: string, options: ProbeOptionsV0 = {}): DockerProbeResultV0 => {
  const normalizedInputRef = normalizeImageRefV0(inputRef);
  if (!normalizedInputRef) {
    return {
      ok: false,
      code: "DOCKER_IMAGE_REF_INVALID",
      message: "container image reference is invalid.",
      reasonCodes: ["DOCKER_IMAGE_REF_INVALID"],
    };
  }

  if (hasRemoteDockerContext(options.env)) {
    return {
      ok: false,
      code: "DOCKER_REMOTE_CONTEXT_UNSUPPORTED",
      message: "remote Docker context is unsupported; unset DOCKER_HOST/DOCKER_CONTEXT for local-only scans.",
      reasonCodes: ["DOCKER_REMOTE_CONTEXT_UNSUPPORTED"],
    };
  }

  const runDocker = options.runDocker ?? defaultDockerRunnerV0;
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

  return parseInspectJson(normalizedInputRef, inspectRes.stdout);
};

const findingHistogram = (codes: string[]): Array<{ code: string; count: number }> => {
  const map = new Map<string, number>();
  codes.forEach((code) => {
    if (typeof code !== "string" || code.length === 0) return;
    map.set(code, (map.get(code) ?? 0) + 1);
  });
  const entries = Array.from(map.entries()).map(([code, count]) => ({ code, count }));
  entries.sort((a, b) => {
    const c0 = cmpStrV0(a.code, b.code);
    if (c0 !== 0) return c0;
    return a.count - b.count;
  });
  return entries;
};

export const buildContainerAdapterEvidenceV0 = (probe: DockerProbeSuccessV0) => {
  const counts = stableSortRecord({
    layerCount: probe.layerCount,
    envVarCount: probe.envVarCount,
    exposedPortCount: probe.exposedPortCount,
    repoDigestCount: probe.repoDigestsBounded.length,
    repoTagCount: probe.repoTagsBounded.length,
  });
  const markers = stableSortUniqueStringsV0([
    "BOUND_DOCKER_LOCAL_ONLY",
    "BOUND_DOCKER_INSPECT_ONLY",
    "BOUND_NO_NETWORK",
    probe.registryDomain ? "REF_FROM_NAME_ONLY" : "",
  ]);

  return {
    adapter: {
      adapterId: "docker.local.inspect.v0",
      sourceFormat: "docker_image_inspect_v0",
      mode: "built_in" as const,
      reasonCodes: stableSortUniqueReasonsV0(probe.reasonCodes).slice(0, MAX_REASON_CODES),
    },
    adapterSignals: {
      class: "container",
      counts,
      markers,
    },
    summary: {
      schema: "weftend.adapterSummary/0",
      schemaVersion: 0,
      adapterId: "docker.local.inspect.v0",
      sourceClass: "container",
      sourceFormat: "docker_image_inspect_v0",
      mode: "built_in" as const,
      counts,
      markers,
      reasonCodes: stableSortUniqueReasonsV0(probe.reasonCodes).slice(0, MAX_REASON_CODES),
    },
    findings: {
      schema: "weftend.adapterFindings/0",
      schemaVersion: 0,
      adapterId: "docker.local.inspect.v0",
      sourceClass: "container",
      findings: findingHistogram(probe.reasonCodes),
      markers,
    },
  };
};
