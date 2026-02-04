/* src/runtime/kernel/cap_kernel.ts */
/**
 * WeftEnd (WebLayers v2.6) ƒ?" Capability kernel (deny-by-default)
 *
 * Pure enforcement with deterministic reason ordering.
 */

import type {
  ConsentClaimV0,
  GateReceiptV0,
  PortalRuntimeStampObservation,
  ShopStamp,
} from "../../core/types";
import type { CryptoPort } from "../../ports/crypto-port";
import { validateGateReceiptV0 } from "../../core/validate";
import { checkpointEqOrReasonV0, stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0";
import { computeRuntimeObservedStamp } from "./stamp_observer_core";

export type RuntimeTier = "T0" | "T1" | "T2" | "T3";

export interface CapInvokeMessage {
  reqId: string;
  capId: string;
  executionMode: string;
  planDigest: string;
  sessionNonce: string;
  callerBlockHash: string;
}

export interface CapDecision {
  ok: boolean;
  value?: unknown;
  reasonCodes?: string[];
}

export interface CapDenyTelemetry {
  eventKind: "cap.deny";
  planDigest: string;
  callerBlockHash: string;
  capId: string;
  reasonCodes: string[];
  seq: number;
}

export interface CapKernelOptions {
  planDigest: string;
  callerBlockHash: string;
  executionMode: string;
  sessionNonce: string;
  grantedCaps: Set<string>;
  runtimeTier?: RuntimeTier;
  blockTier?: RuntimeTier;
  shopStamp?: ShopStamp;
  cryptoPort?: CryptoPort;
  stampKeyAllowlist?: Record<string, string>;
  releaseStatus?: "OK" | "UNVERIFIED" | "MAYBE";
  releaseReasonCodes?: string[];
  releaseId?: string;
  releaseGatedCaps?: Set<string>;
  secretZoneAvailable?: boolean;
  knownCaps?: Set<string>;
  disabledCaps?: Set<string>;
  marketId?: string;
  marketPolicyDigest?: string;
  admissionReceipt?: GateReceiptV0;
  marketEligibleCaps?: Set<string>;
  onTelemetry?: (event: CapDenyTelemetry) => void;
  consentClaim?: ConsentClaimV0;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const tierRank = (tier: RuntimeTier | undefined): number | null => {
  switch (tier) {
    case "T0":
      return 0;
    case "T1":
      return 1;
    case "T2":
      return 2;
    case "T3":
      return 3;
    default:
      return null;
  }
};

const defaultKnownCaps = new Set([
  "net.fetch",
  "storage.read",
  "storage.write",
  "ui.secret.read",
  "ui.secret.emit",
  "storage.secret.write",
  "net.secret.send",
  "clipboard.read",
  "clipboard.write",
  "diag.raw",
  "id.sign",
  "auth.password.submit",
  "payment.tokenize",
  "storage.writeSecret",
  "ui.input.capture",
]);

const defaultDisabledCaps = new Set([
  "net.fetch",
  "storage.read",
  "storage.write",
  "ui.secret.read",
  "ui.secret.emit",
  "storage.secret.write",
  "net.secret.send",
  "clipboard.read",
  "clipboard.write",
  "diag.raw",
  "id.sign",
  "auth.password.submit",
  "payment.tokenize",
  "storage.writeSecret",
  "ui.input.capture",
]);

const secretRequiredCaps = new Set([
  "id.sign",
  "auth.password.submit",
  "payment.tokenize",
  "storage.writeSecret",
  "ui.input.capture",
  "ui.secret.read",
  "ui.secret.emit",
  "storage.secret.write",
  "net.secret.send",
  "clipboard.read",
  "clipboard.write",
  "diag.raw",
]);

const defaultReleaseGatedCaps = new Set([...defaultKnownCaps]);

export class CapKernel {
  private opts: CapKernelOptions;
  private seenReqIds = new Set<string>();
  private seq = 0;
  private selfTestPassed = true;
  private runtimeObservedStamp?: PortalRuntimeStampObservation;
  private consentClaim?: ConsentClaimV0;
  private usedConsentIds = new Set<string>();
  private lastConsentSeq: number | null = null;
  private releaseStatus?: "OK" | "UNVERIFIED" | "MAYBE";
  private releaseReasonCodes: string[] = [];
  private releaseGatedCaps: Set<string>;

  constructor(opts: CapKernelOptions) {
    this.opts = opts;
    this.consentClaim = opts.consentClaim;
    this.releaseStatus = opts.releaseStatus;
    this.releaseReasonCodes = stableSortUniqueReasonsV0(opts.releaseReasonCodes ?? [], {
      subject: opts.callerBlockHash,
      locator: "release",
    });
    this.releaseGatedCaps = opts.releaseGatedCaps ?? defaultReleaseGatedCaps;
  }

  setSelfTestPassed(ok: boolean) {
    this.selfTestPassed = ok;
  }

  setSecretZoneAvailable(ok: boolean) {
    this.opts.secretZoneAvailable = ok;
  }

  setConsentClaim(claim: ConsentClaimV0 | undefined) {
    this.consentClaim = claim;
  }

  setReleaseStatus(status: "OK" | "UNVERIFIED" | "MAYBE", reasonCodes?: string[]) {
    this.releaseStatus = status;
    this.releaseReasonCodes = stableSortUniqueReasonsV0(reasonCodes ?? [], {
      subject: this.opts.callerBlockHash,
      locator: "release",
    });
  }

  preflightDenyReasons(): string[] {
    const observed = this.getRuntimeObservedStamp();
    return stableSortUniqueReasonsV0(observed.reasonCodes ?? [], {
      subject: this.opts.callerBlockHash,
      locator: "stamp",
    });
  }

  handleInvoke(msg: CapInvokeMessage): { decision: CapDecision; telemetry?: CapDenyTelemetry } {
    const observed = this.getRuntimeObservedStamp();
    const reasons: string[] = [...(observed.reasonCodes ?? [])];

    if (msg.executionMode !== this.opts.executionMode) reasons.push("MODE_MISMATCH");
    reasons.push(...checkpointEqOrReasonV0(this.opts.planDigest, msg.planDigest, "PLANDIGEST_MISMATCH"));
    if (msg.sessionNonce !== this.opts.sessionNonce) reasons.push("NONCE_MISMATCH");
    if (msg.callerBlockHash !== this.opts.callerBlockHash) reasons.push("CALLER_MISMATCH");
    if (!this.selfTestPassed) reasons.push("SELFTEST_REQUIRED");

    if (this.seenReqIds.has(msg.reqId)) {
      reasons.push("REPLAY_DETECTED");
    } else {
      this.seenReqIds.add(msg.reqId);
    }

    const runtimeRank = tierRank(this.opts.runtimeTier);
    const blockRank = tierRank(this.opts.blockTier);
    if (runtimeRank !== null && blockRank !== null && blockRank < runtimeRank) {
      reasons.push("TIER_VIOLATION");
    }

    const knownCaps = this.opts.knownCaps ?? defaultKnownCaps;
    if (!knownCaps.has(msg.capId)) {
      reasons.push("CAP_UNKNOWN");
    }

    if (!this.opts.grantedCaps.has(msg.capId)) {
      reasons.push("CAP_NOT_GRANTED");
    }

    const marketContext =
      isNonEmptyString(this.opts.marketId) ||
      isNonEmptyString(this.opts.marketPolicyDigest) ||
      Boolean(this.opts.admissionReceipt);
    if (marketContext) {
      const receipt = this.opts.admissionReceipt;
      if (!receipt) {
        reasons.push("RECEIPT_MISSING");
      } else {
        const issues = validateGateReceiptV0(receipt, "admissionReceipt");
        if (issues.length > 0) {
          reasons.push("RECEIPT_INVALID");
        } else {
          const body = receipt.body;
          if (body.gateId !== "market.admission.v0") reasons.push("RECEIPT_SUBJECT_MISMATCH");
          if (isNonEmptyString(this.opts.marketId) && body.marketId !== this.opts.marketId)
            reasons.push("RECEIPT_SUBJECT_MISMATCH");
          if (isNonEmptyString(this.opts.marketPolicyDigest) && body.marketPolicyDigest !== this.opts.marketPolicyDigest)
            reasons.push("RECEIPT_SUBJECT_MISMATCH");
          reasons.push(...checkpointEqOrReasonV0(this.opts.planDigest, body.planDigest, "RECEIPT_SUBJECT_MISMATCH"));
          if (isNonEmptyString(this.opts.releaseId)) {
            reasons.push(
              ...checkpointEqOrReasonV0(this.opts.releaseId, body.releaseId, "RECEIPT_SUBJECT_MISMATCH")
            );
          }
          if (body.blockHash !== this.opts.callerBlockHash) reasons.push("RECEIPT_SUBJECT_MISMATCH");
          if (body.decision !== "ALLOW") reasons.push("RECEIPT_DENY");
        }
      }

      if (this.opts.marketEligibleCaps && !this.opts.marketEligibleCaps.has(msg.capId)) {
        reasons.push("CAP_NOT_ELIGIBLE_MARKET");
      }
    }

    if (this.releaseStatus && this.releaseStatus !== "OK" && this.releaseGatedCaps.has(msg.capId)) {
      if (this.releaseReasonCodes.length > 0) {
        reasons.push(...this.releaseReasonCodes);
      } else {
        reasons.push("RELEASE_UNVERIFIED");
      }
    }

    if (secretRequiredCaps.has(msg.capId) && this.opts.secretZoneAvailable !== true) {
      reasons.push("SECRET_ZONE_REQUIRED");
      reasons.push("SECRET_ZONE_UNAVAILABLE");
    }

    if (msg.capId === "id.sign") {
      const consentErrors: string[] = [];
      if (!this.consentClaim) {
        consentErrors.push("CONSENT_MISSING");
      } else {
        if (this.consentClaim.action !== "id.sign") consentErrors.push("CONSENT_INVALID");
        consentErrors.push(
          ...checkpointEqOrReasonV0(this.opts.planDigest, this.consentClaim.subject.planDigest, "CONSENT_MISMATCH")
        );
        if (this.consentClaim.subject.blockHash !== this.opts.callerBlockHash) consentErrors.push("CONSENT_MISMATCH");
        if (this.usedConsentIds.has(this.consentClaim.consentId)) consentErrors.push("CONSENT_REPLAY");
        if (this.lastConsentSeq !== null && this.consentClaim.seq <= this.lastConsentSeq)
          consentErrors.push("CONSENT_REPLAY");
        if (consentErrors.length === 0) {
          this.usedConsentIds.add(this.consentClaim.consentId);
          this.lastConsentSeq = this.consentClaim.seq;
        }
      }
      reasons.push(...consentErrors);
    }

    const disabledCaps = this.opts.disabledCaps ?? defaultDisabledCaps;
    if (disabledCaps.has(msg.capId)) {
      reasons.push("CAP_DISABLED_V0");
    }

    if (reasons.length > 0) {
      const reasonCodes = stableSortUniqueReasonsV0(reasons, {
        subject: this.opts.callerBlockHash,
        locator: msg.capId,
      });
      const telemetry: CapDenyTelemetry = {
        eventKind: "cap.deny",
        planDigest: this.opts.planDigest,
        callerBlockHash: this.opts.callerBlockHash,
        capId: msg.capId,
        reasonCodes,
        seq: this.seq++,
      };
      if (this.opts.onTelemetry) this.opts.onTelemetry(telemetry);
      return { decision: { ok: false, reasonCodes }, telemetry };
    }

    return { decision: { ok: true, value: null } };
  }

  getRuntimeObservedStamp(): PortalRuntimeStampObservation {
    if (!this.runtimeObservedStamp) {
      this.runtimeObservedStamp = this.computeRuntimeObservedStamp();
    }
    return this.runtimeObservedStamp;
  }

  private computeRuntimeObservedStamp(): PortalRuntimeStampObservation {
    return computeRuntimeObservedStamp({
      runtimeTier: this.opts.runtimeTier,
      shopStamp: this.opts.shopStamp,
      callerBlockHash: this.opts.callerBlockHash,
      stampKeyAllowlist: this.opts.stampKeyAllowlist,
      verifySignature: this.opts.cryptoPort
        ? (payload: string, sig: ShopStamp["signature"], publicKey: string) =>
            this.opts.cryptoPort?.verifySignature(payload, sig as any, publicKey) === true
        : undefined,
    }) as PortalRuntimeStampObservation;
  }
}
