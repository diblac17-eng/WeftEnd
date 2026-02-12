/* src/runtime/weftend_build.ts */
// Deterministic WeftEnd build fingerprint (bounded, fail-closed).

import type { WeftendBuildSourceV0, WeftendBuildV0 } from "../core/types";
import { computeArtifactDigestV0 } from "./store/artifact_store";
import { stableSortUniqueReasonsV0 } from "../core/trust_algebra_v0";

declare const require: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");

const ZERO_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const MAX_BUILD_BYTES = 128 * 1024 * 1024;

const toBinaryString = (buf: unknown): string => {
  if (Buffer && Buffer.isBuffer && Buffer.isBuffer(buf)) {
    return (buf as any).toString("binary");
  }
  return String(buf ?? "");
};

export const computeWeftendBuildV0 = (options: {
  filePath?: string;
  source: WeftendBuildSourceV0;
  maxBytes?: number;
}): { build: WeftendBuildV0; reasonCodes: string[] } => {
  const reasons: string[] = [];
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(1, Number(options.maxBytes)) : MAX_BUILD_BYTES;
  const filePath = typeof options.filePath === "string" && options.filePath.trim().length > 0
    ? path.resolve(options.filePath)
    : "";

  if (!filePath || !fs.existsSync(filePath)) {
    reasons.push("WEFTEND_BUILD_DIGEST_UNAVAILABLE");
    return {
      build: { algo: "sha256", digest: ZERO_DIGEST, source: "UNKNOWN", reasonCodes: reasons },
      reasonCodes: reasons,
    };
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) {
      reasons.push("WEFTEND_BUILD_DIGEST_UNAVAILABLE");
      return {
        build: { algo: "sha256", digest: ZERO_DIGEST, source: "UNKNOWN", reasonCodes: reasons },
        reasonCodes: reasons,
      };
    }
  } catch {
    reasons.push("WEFTEND_BUILD_DIGEST_UNAVAILABLE");
    return {
      build: { algo: "sha256", digest: ZERO_DIGEST, source: "UNKNOWN", reasonCodes: reasons },
      reasonCodes: reasons,
    };
  }

  try {
    const data = fs.readFileSync(filePath);
    const digest = computeArtifactDigestV0(toBinaryString(data));
    return {
      build: { algo: "sha256", digest, source: options.source },
      reasonCodes: reasons,
    };
  } catch {
    reasons.push("WEFTEND_BUILD_DIGEST_UNAVAILABLE");
    return {
      build: { algo: "sha256", digest: ZERO_DIGEST, source: "UNKNOWN", reasonCodes: reasons },
      reasonCodes: reasons,
    };
  }
};

export const formatBuildDigestSummaryV0 = (build: WeftendBuildV0 | undefined): string => {
  const reasons = stableSortUniqueReasonsV0(build?.reasonCodes ?? []);
  if (reasons.includes("WEFTEND_BUILD_DIGEST_UNAVAILABLE")) {
    return "buildDigest=UNAVAILABLE (WEFTEND_BUILD_DIGEST_UNAVAILABLE)";
  }
  return "buildDigest=OK";
};

