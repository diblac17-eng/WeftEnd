// src/engine/portal_model.ts
// Deterministic portal projection (v0, proof-only).

import type {
  CapabilityGrant,
  EvidenceEnvelope,
  EvidenceVerifyResult,
  ExecutionMode,
  CapEvidenceRequirement,
  PortalBlockRowV0,
  PortalCapDenial,
  PortalModelV0,
  PortalRenderState,
  PortalRuntimeStampObservation,
  PortalPulseSummaryV0,
  TartarusRecordV0,
} from "../core/types";
import {
  buildPortalModel as buildPortalModelCore,
  applyPortalProjectionCapsV0,
  MAX_CAPS_PER_BLOCK,
  MAX_PORTAL_BLOCKS,
  MAX_PROJECTION_TRUNCATIONS,
  MAX_STAMPS_PER_BLOCK,
  MAX_STR_BYTES,
  MAX_TARTARUS_PER_BLOCK,
  MAX_TARTARUS_TOTAL,
} from "./portal_model_core";

export interface PortalVerifyResult {
  status: PortalRenderState;
  reasonCodes?: string[];
}

export interface PortalBlockInput {
  blockHash: string;
  executionMode: ExecutionMode | string;
  requestedCaps: string[];
  eligibleCaps?: string[];
  grantedCaps?: CapabilityGrant[];
  deniedCaps?: PortalCapDenial[];
  evidenceRecords?: EvidenceEnvelope[];
  evidenceResults?: EvidenceVerifyResult[];
  capEvidenceRequirements?: CapEvidenceRequirement[];
  verifyResult?: PortalVerifyResult;
  marketId?: string;
  marketPolicyDigest?: string;
  receiptDecision?: PortalBlockRowV0["receiptDecision"];
  receiptId?: string;
  receiptReasonCodes?: string[];
  stampStatus?: PortalBlockRowV0["stampStatus"];
  stampSigStatus?: PortalBlockRowV0["stampSigStatus"];
  runtimeObservedStamp?: PortalRuntimeStampObservation;
  tartarusRecords?: TartarusRecordV0[];
}

export interface PortalModelInput {
  planDigest: string;
  blocks: PortalBlockInput[];
  globalWarnings?: string[];
  releaseStatus?: PortalModelV0["releaseStatus"];
  releaseReasonCodes?: string[];
  releaseId?: string;
  releasePathDigest?: PortalModelV0["releasePathDigest"];
  historyHeadDigest?: PortalModelV0["historyHeadDigest"];
  historyStatus?: PortalModelV0["historyStatus"];
  historyReasonCodes?: PortalModelV0["historyReasonCodes"];
  marketId?: PortalModelV0["marketId"];
  marketPolicyDigest?: PortalModelV0["marketPolicyDigest"];
  receiptSummary?: PortalModelV0["receiptSummary"];
  pulses?: PortalPulseSummaryV0;
  buildAttestation?: PortalModelV0["buildAttestation"];
}

export const buildPortalModel = (input: PortalModelInput): PortalModelV0 =>
  buildPortalModelCore(input) as PortalModelV0;

export const applyPortalProjectionCaps = (model: PortalModelV0): PortalModelV0 =>
  applyPortalProjectionCapsV0(model) as PortalModelV0;

export {
  MAX_CAPS_PER_BLOCK,
  MAX_PORTAL_BLOCKS,
  MAX_PROJECTION_TRUNCATIONS,
  MAX_STAMPS_PER_BLOCK,
  MAX_STR_BYTES,
  MAX_TARTARUS_PER_BLOCK,
  MAX_TARTARUS_TOTAL,
};
