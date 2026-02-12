// src/runtime/store/artifact_store.ts
// Deterministic artifact store with fail-closed recovery.
// @ts-nocheck

import { classifyViolationV0 } from "../../engine/tartarus_core";
import { checkpointEqOrReasonV0, stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0_core";
declare const require: any;
const crypto = require("crypto");

const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;

const sha256Hex = (input) =>
  crypto
    .createHash("sha256")
    .update(String(input ?? ""), "utf8")
    .digest("hex");

// Kept legacy prefix for schema compatibility; digest payload uses SHA-256.
export const computeArtifactDigestV0 = (content) => `sha256:${sha256Hex(content)}`;

/**
 * @param {object} opts
 * @param {string} opts.planDigest
 * @param {string} opts.blockHash
 */
export class ArtifactStoreV0 {
  constructor(opts) {
    this.current = new Map();
    this.lastGood = new Map();
    this.seq = 0;
    this.opts = opts;
  }

  put(expectedDigest, content) {
    if (!isNonEmptyString(expectedDigest) || !isNonEmptyString(content)) {
      return { ok: false, reasonCodes: ["ARTIFACT_INPUT_INVALID"] };
    }
    const computed = computeArtifactDigestV0(content);
    if (checkpointEqOrReasonV0(expectedDigest, computed, "ARTIFACT_DIGEST_MISMATCH").length > 0) {
      const reasonCodes = stableSortUniqueReasonsV0(["ARTIFACT_DIGEST_MISMATCH"]);
      const incident = classifyViolationV0({
        planDigest: this.opts.planDigest,
        blockHash: this.opts.blockHash,
        reasonCodes,
        seq: ++this.seq,
        kindHint: "artifact.mismatch",
      });
      return { ok: false, reasonCodes, incident };
    }

    this.current.set(expectedDigest, content);
    this.lastGood.set(expectedDigest, content);
    return { ok: true };
  }

  read(expectedDigest) {
    if (!isNonEmptyString(expectedDigest)) {
      return { ok: false, reasonCodes: ["ARTIFACT_INPUT_INVALID"] };
    }

    if (!this.current.has(expectedDigest)) {
      return { ok: false, reasonCodes: ["ARTIFACT_MISSING"] };
    }

    const stored = this.current.get(expectedDigest) || "";
    const observedDigest = computeArtifactDigestV0(stored);
    if (checkpointEqOrReasonV0(expectedDigest, observedDigest, "ARTIFACT_DIGEST_MISMATCH").length > 0) {
      const recovered = this.lastGood.get(expectedDigest);
      const reasonCodes = stableSortUniqueReasonsV0(
        recovered ? ["ARTIFACT_DIGEST_MISMATCH", "ARTIFACT_RECOVERED"] : ["ARTIFACT_DIGEST_MISMATCH"]
      );
      const incident = classifyViolationV0({
        planDigest: this.opts.planDigest,
        blockHash: this.opts.blockHash,
        reasonCodes,
        seq: ++this.seq,
        kindHint: "artifact.mismatch",
      });
      if (recovered !== undefined) {
        this.current.set(expectedDigest, recovered);
        return { ok: true, value: recovered, recovered: true, reasonCodes, incident, observedDigest };
      }
      return { ok: false, reasonCodes, incident, observedDigest };
    }

    return { ok: true, value: stored, observedDigest };
  }
}
