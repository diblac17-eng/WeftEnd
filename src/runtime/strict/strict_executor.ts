// src/runtime/strict/strict_executor.ts
// Host-side Strict sandbox executor (v0).

import type {
  SandboxInit,
  SandboxInvoke,
  SandboxMessage,
  SandboxResult,
  SandboxSelfTest,
  SandboxSelfTestResult,
  MessagePortLike,
} from "./types";
import { createBoundChannel } from "../boundary/channel";
import { newNonce, safeEqual, validateNonce } from "../boundary/nonce";
import { CapKernel, type CapDenyTelemetry, type RuntimeTier } from "../kernel/cap_kernel";
import type {
  PortalRuntimeStampObservation,
  ReleaseManifestV0,
  ReleaseVerifyResultV0,
  ShopStamp,
  TartarusRecordV0,
  GateReceiptV0,
  PlanSnapshotV0,
  EvidenceBundleV0,
  StrictPolicyV0,
  PulseV0,
  PulseSubjectV0,
  PulseDigestSetV0,
  PulseCountsV0,
} from "../../core/types";
import type { CryptoPort } from "../../ports/crypto-port";
import { SecretZoneHost } from "../secretzone/secret_zone_host";
import { verifyReleaseManifestV0 } from "../release/release_loader";
import type { ArtifactStoreV0 } from "../store/artifact_store";
import { joinReasonsV0, stableSortUniqueReasonsV0 } from "../../core/trust_algebra_v0";
import {
  computePathDigestV0,
  privacyValidateCoreTruthV0,
  validateBuildAttestationPayloadV0,
  validateEvidenceBundleV0,
  validatePlanSnapshotV0,
} from "../../core/validate";
import { sealPulseV0 } from "../../core/pulse_digest";

declare const require: (id: string) => any;

type WorkerLike = {
  postMessage: (msg: SandboxMessage, transfer?: unknown[]) => void;
  on: (event: "message" | "error" | "exit", listener: (arg: any) => void) => void;
  terminate: () => Promise<number>;
};

type SandboxResultPayload =
  | { kind: "result"; reqId: string; ok: true; value: unknown }
  | { kind: "result"; reqId: string; ok: false; reasonCodes: string[] };

export interface StrictExecutorOptions {
  workerScript: string;
  planDigest: string;
  callerBlockHash: string;
  grantedCaps: string[];
  sourceText: string;
  entryExportName: string;
  entryArgs?: unknown;
  testKeepGlobal?: string;
  runtimeTier?: RuntimeTier;
  blockTier?: RuntimeTier;
  shopStamp?: ShopStamp;
  cryptoPort?: CryptoPort;
  stampKeyAllowlist?: Record<string, string>;
  releaseManifest?: ReleaseManifestV0;
  releaseKeyAllowlist?: Record<string, string>;
  releaseExpectedBlocks?: string[];
  artifactStore?: ArtifactStoreV0;
  expectedSourceDigest?: string;
  secretZoneAvailable?: boolean;
  knownCaps?: string[];
  disabledCaps?: string[];
  marketId?: string;
  marketPolicyDigest?: string;
  admissionReceipt?: GateReceiptV0;
  marketEligibleCaps?: string[];
  planSnapshot?: PlanSnapshotV0;
  evidenceBundle?: EvidenceBundleV0;
  strictPolicy?: StrictPolicyV0;
  onTelemetry?: (event: CapDenyTelemetry) => void;
  onRuntimeObservedStamp?: (obs: PortalRuntimeStampObservation) => void;
  onArtifactIncident?: (record: TartarusRecordV0) => void;
  onArtifactRead?: (obs: {
    ok: boolean;
    recovered?: boolean;
    reasonCodes?: string[];
    expectedDigest?: string;
    observedDigest?: string;
  }) => void;
  onPulse?: (pulse: PulseV0) => void;
  secretZoneHost?: SecretZoneHost;
  /** Test-only seam to inject non-port messages (wrong channel). */
  testUntrustedMessageSource?: { onMessage: (handler: (msg: SandboxMessage) => void) => void };
  /** Test-only seam to override release verification. */
  testReleaseVerifyOverride?: ReleaseVerifyResultV0;
}

const normalizeReasonCodes = (codes: unknown): string[] => {
  if (!Array.isArray(codes)) return [];
  return stableSortUniqueReasonsV0(codes.filter((v) => typeof v === "string" && v.length > 0));
};

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export class StrictExecutor {
  private opts: StrictExecutorOptions;
  private worker: WorkerLike | null = null;
  private granted: Set<string>;
  private entryResolve: ((res: SandboxResult) => void) | null = null;
  private entryPromise: Promise<SandboxResult>;
  private selfTestResolve: ((res: SandboxSelfTestResult) => void) | null = null;
  private hostPort: MessagePortLike | null = null;
  private sessionNonce: string;
  private selfTestPassed = false;
  private untrustedSeen = false;
  private pendingEntry: SandboxResult | null = null;
  private kernel: CapKernel;
  private runtimeObservedStamp?: PortalRuntimeStampObservation;
  private releaseVerify?: ReleaseVerifyResultV0;
  private pathSummaryResolved = false;
  private pathSummaryReasons: string[] = [];
  private expectedPathDigest?: string;
  private attestationResolved = false;
  private attestationReasons: string[] = [];
  private pulseSeqBySubject = new Map<string, number>();
  private loadPulseEmitted = false;
  private exitPulseEmitted = false;

  constructor(opts: StrictExecutorOptions) {
    this.opts = opts;
    this.granted = new Set(opts.grantedCaps);
    this.entryPromise = new Promise((resolve) => {
      this.entryResolve = resolve;
    });
    this.sessionNonce = newNonce();
    this.kernel = new CapKernel({
      planDigest: opts.planDigest,
      callerBlockHash: opts.callerBlockHash,
      executionMode: "strict",
      sessionNonce: this.sessionNonce,
      grantedCaps: this.granted,
      runtimeTier: opts.runtimeTier,
      blockTier: opts.blockTier,
      shopStamp: opts.shopStamp,
      cryptoPort: opts.cryptoPort,
      stampKeyAllowlist: opts.stampKeyAllowlist,
      secretZoneAvailable: opts.secretZoneAvailable,
      knownCaps: opts.knownCaps ? new Set(opts.knownCaps) : undefined,
      disabledCaps: opts.disabledCaps ? new Set(opts.disabledCaps) : undefined,
      marketId: opts.marketId,
      marketPolicyDigest: opts.marketPolicyDigest,
      admissionReceipt: opts.admissionReceipt,
      marketEligibleCaps: opts.marketEligibleCaps ? new Set(opts.marketEligibleCaps) : undefined,
      releaseId: opts.releaseManifest?.releaseId,
      onTelemetry: opts.onTelemetry,
    });
  }

  private nextPulseSeq(subject: PulseSubjectV0): number {
    const key = `${subject.kind}:${subject.id}`;
    const next = (this.pulseSeqBySubject.get(key) ?? 0) + 1;
    this.pulseSeqBySubject.set(key, next);
    return next;
  }

  private buildPulseDigests(): PulseDigestSetV0 | undefined {
    const digests: PulseDigestSetV0 = {};
    if (isNonEmptyString(this.opts.planDigest)) digests.planHash = this.opts.planDigest;
    const releaseId = this.releaseVerify?.observedReleaseId ?? this.opts.releaseManifest?.releaseId;
    if (isNonEmptyString(releaseId)) digests.releaseId = releaseId;
    const pathDigest = this.releaseVerify?.observedPathDigest ?? this.opts.releaseManifest?.manifestBody?.pathDigest;
    if (isNonEmptyString(pathDigest)) digests.pathDigest = pathDigest;
    return Object.keys(digests).length > 0 ? digests : undefined;
  }

  private emitPulse(
    kind: PulseV0["kind"],
    subject: PulseSubjectV0,
    options?: { capId?: string; reasonCodes?: string[]; counts?: PulseCountsV0 }
  ): void {
    if (!this.opts.onPulse) return;
    const pulseSeq = this.nextPulseSeq(subject);
    const pulse = sealPulseV0({
      schema: "weftend.pulse/0",
      v: 0,
      pulseSeq,
      kind,
      subject,
      capId: options?.capId,
      reasonCodes: options?.reasonCodes,
      digests: this.buildPulseDigests(),
      counts: options?.counts,
    });
    this.opts.onPulse(pulse);
  }

  private emitLoadPulse(reasonCodes: string[]): void {
    if (this.loadPulseEmitted) return;
    this.loadPulseEmitted = true;
    const releaseId = this.releaseVerify?.observedReleaseId ?? this.opts.releaseManifest?.releaseId;
    if (!isNonEmptyString(releaseId)) return;
    this.emitPulse("LOAD", { kind: "release", id: releaseId }, { reasonCodes });
  }

  private emitExitPulse(result: SandboxResult): void {
    if (this.exitPulseEmitted) return;
    this.exitPulseEmitted = true;
    const subject: PulseSubjectV0 = { kind: "block", id: this.opts.callerBlockHash };
    const reasons = result.ok ? [] : result.reasonCodes ?? ["EXECUTION_DENIED"];
    this.emitPulse("EXIT", subject, { reasonCodes: reasons });
  }

  private resolvePathSummary() {
    if (this.pathSummaryResolved) return;
    this.pathSummaryResolved = true;

    const reasons: string[] = [];
    if (!this.opts.planSnapshot) {
      reasons.push("PATH_SUMMARY_MISSING");
      this.pathSummaryReasons = normalizeReasonCodes(reasons);
      return;
    }

    const issues = validatePlanSnapshotV0(this.opts.planSnapshot, "planSnapshot");
    if (issues.length > 0) {
      reasons.push("PATH_SUMMARY_INVALID");
      this.pathSummaryReasons = normalizeReasonCodes(reasons);
      return;
    }

    const privacyIssues = privacyValidateCoreTruthV0(this.opts.planSnapshot, "/planSnapshot");
    if (privacyIssues.length > 0) {
      reasons.push(...privacyIssues.map((entry) => entry.code));
      this.pathSummaryReasons = normalizeReasonCodes(reasons);
      return;
    }

    this.expectedPathDigest = computePathDigestV0(this.opts.planSnapshot.pathSummary);
    this.pathSummaryReasons = normalizeReasonCodes(reasons);
  }

  private resolveBuildAttestation() {
    if (this.attestationResolved) return;
    this.attestationResolved = true;

    const requireBuildAttestation = Boolean(this.opts.strictPolicy?.requireBuildAttestation);
    if (!requireBuildAttestation) {
      this.attestationReasons = [];
      return;
    }

    const reasons: string[] = [];
    const evidence = this.opts.evidenceBundle;
    if (!evidence) {
      reasons.push("BUILD_ATTESTATION_MISSING");
      this.attestationReasons = normalizeReasonCodes(reasons);
      return;
    }

    const evidenceIssues = validateEvidenceBundleV0(evidence, "evidence");
    if (evidenceIssues.length > 0) {
      reasons.push("BUILD_ATTESTATION_INVALID");
      this.attestationReasons = normalizeReasonCodes(reasons);
      return;
    }

    const records = Array.isArray(evidence.records) ? evidence.records : [];
    const attestation = records.find((record) => record && record.kind === "build.attestation.v0");
    if (!attestation) {
      reasons.push("BUILD_ATTESTATION_MISSING");
      this.attestationReasons = normalizeReasonCodes(reasons);
      return;
    }

    const attIssues = validateBuildAttestationPayloadV0(attestation.payload, "attestation");
    if (attIssues.length > 0) {
      reasons.push("BUILD_ATTESTATION_INVALID");
      this.attestationReasons = normalizeReasonCodes(reasons);
      return;
    }

    const planHash = typeof (attestation as any)?.payload?.planHash === "string"
      ? String((attestation as any).payload.planHash)
      : "";
    if (planHash && planHash !== this.opts.planDigest) {
      reasons.push("BUILD_ATTESTATION_PLAN_MISMATCH");
    }

    this.attestationReasons = normalizeReasonCodes(reasons);
  }

  async run(): Promise<SandboxResult> {
    if (this.worker) return this.entryPromise;

    let sourceText = this.opts.sourceText;
    if (this.opts.artifactStore && this.opts.expectedSourceDigest) {
      const artifact = this.opts.artifactStore.read(this.opts.expectedSourceDigest);
      const artifactReasons = normalizeReasonCodes(artifact.reasonCodes);
      this.opts.onArtifactRead?.({
        ok: artifact.ok,
        recovered: artifact.recovered,
        reasonCodes: artifactReasons,
        expectedDigest: this.opts.expectedSourceDigest,
        observedDigest: artifact.observedDigest,
      });
      if (artifact.incident) this.opts.onArtifactIncident?.(artifact.incident as TartarusRecordV0);
      if (!artifact.ok) {
        const reasonCodes = stableSortUniqueReasonsV0(
          artifactReasons.length > 0 ? artifactReasons : ["ARTIFACT_DIGEST_MISMATCH"]
        );
        this.resolveEntry(
          this.makeResult({
            kind: "result",
            reqId: "entry",
            ok: false,
            reasonCodes,
          })
        );
        return this.entryPromise;
      }
      if (artifact.value !== undefined) sourceText = artifact.value;
    }

    this.runtimeObservedStamp = this.kernel.getRuntimeObservedStamp();
    if (this.runtimeObservedStamp) {
      this.opts.onRuntimeObservedStamp?.(this.runtimeObservedStamp);
    }
    this.resolvePathSummary();
    this.resolveBuildAttestation();
    this.releaseVerify =
      this.opts.testReleaseVerifyOverride ??
      verifyReleaseManifestV0({
        manifest: this.opts.releaseManifest ?? null,
        expectedPlanDigest: this.opts.planDigest,
        expectedBlocks: this.opts.releaseExpectedBlocks ?? [this.opts.callerBlockHash],
        expectedPathDigest: this.expectedPathDigest,
        cryptoPort: this.opts.cryptoPort,
        keyAllowlist: this.opts.releaseKeyAllowlist,
      });
    const stampReasons = normalizeReasonCodes(this.runtimeObservedStamp?.reasonCodes);
    let releaseReasons = normalizeReasonCodes(this.releaseVerify.reasonCodes);
    if (this.releaseVerify.status !== "OK" && releaseReasons.length === 0) {
      releaseReasons = stableSortUniqueReasonsV0(["RELEASE_UNVERIFIED"]);
    }
    this.kernel.setReleaseStatus(this.releaseVerify.status, releaseReasons);
    const preflight = joinReasonsV0(
      joinReasonsV0(stampReasons, releaseReasons),
      joinReasonsV0(this.pathSummaryReasons, this.attestationReasons)
    );
    this.emitLoadPulse(preflight);
    if (preflight.length > 0) {
      this.resolveEntry(
        this.makeResult({
          kind: "result",
          reqId: "entry",
          ok: false,
          reasonCodes: preflight,
        })
      );
      return this.entryPromise;
    }

    const { Worker } = require("worker_threads");
    const worker = new Worker(this.opts.workerScript) as WorkerLike;
    this.worker = worker;
    worker.on("message", (msg: SandboxMessage) => this.handleUntrustedChannel(msg));
    worker.on("error", () => {
      this.resolveEntry(this.makeResult({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["SANDBOX_WORKER_ERROR"] }));
    });
    worker.on("exit", (code: number) => {
      if (code !== 0) {
        this.resolveEntry(this.makeResult({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["SANDBOX_EXITED"] }));
      }
    });
    if (this.opts.testUntrustedMessageSource) {
      this.opts.testUntrustedMessageSource.onMessage((msg: SandboxMessage) => this.handleUntrustedChannel(msg));
    }

    if (!validateNonce(this.sessionNonce)) {
      this.resolveEntry(this.makeResult({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["NONCE_INVALID"] }));
      return this.entryPromise;
    }

    const { hostPort, childPort } = createBoundChannel();
    this.hostPort = hostPort;
    this.attachPortListener(hostPort);

    const init: SandboxInit = {
      kind: "init",
      executionMode: "strict",
      planDigest: this.opts.planDigest,
      sessionNonce: this.sessionNonce,
      callerBlockHash: this.opts.callerBlockHash,
      grantedCaps: [...this.granted],
      sourceText,
      entryExportName: this.opts.entryExportName,
      entryArgs: this.opts.entryArgs,
      testKeepGlobal: this.opts.testKeepGlobal,
      port: childPort,
    };

    worker.postMessage(init, [childPort as unknown as any]);

    const selfTest = await this.runSelfTest();
    if (!selfTest.ok) {
      this.resolveEntry(
        this.makeResult({
          kind: "result",
          reqId: "entry",
          ok: false,
          reasonCodes: stableSortUniqueReasonsV0(selfTest.reasonCodes ?? ["SELFTEST_FAILED"]),
        })
      );
      return this.entryPromise;
    }
    this.selfTestPassed = true;
    this.kernel.setSelfTestPassed(true);

    return this.entryPromise;
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  getRuntimeObservedStamp(): PortalRuntimeStampObservation | undefined {
    if (!this.runtimeObservedStamp) {
      this.runtimeObservedStamp = this.kernel.getRuntimeObservedStamp();
    }
    return this.runtimeObservedStamp;
  }

  getReleaseStatus(): ReleaseVerifyResultV0 | undefined {
    if (!this.releaseVerify) {
      this.resolvePathSummary();
      this.releaseVerify =
        this.opts.testReleaseVerifyOverride ??
        verifyReleaseManifestV0({
          manifest: this.opts.releaseManifest ?? null,
          expectedPlanDigest: this.opts.planDigest,
          expectedBlocks: this.opts.releaseExpectedBlocks ?? [this.opts.callerBlockHash],
          expectedPathDigest: this.expectedPathDigest,
          cryptoPort: this.opts.cryptoPort,
          keyAllowlist: this.opts.releaseKeyAllowlist,
        });
      let releaseReasons = normalizeReasonCodes(this.releaseVerify.reasonCodes);
      if (this.releaseVerify.status !== "OK" && releaseReasons.length === 0) {
        releaseReasons = stableSortUniqueReasonsV0(["RELEASE_UNVERIFIED"]);
      }
      this.kernel.setReleaseStatus(this.releaseVerify.status, releaseReasons);
    }
    return this.releaseVerify;
  }

  private resolveEntry(result: SandboxResult) {
    this.emitExitPulse(result);
    if (this.entryResolve) {
      const resolve = this.entryResolve;
      this.entryResolve = null;
      resolve(result);
    }
  }

  private handleMessage(msg: SandboxMessage) {
    if (msg.kind === "invoke") {
      void this.handleInvoke(msg);
      return;
    }

    if (msg.kind === "selftest.result") {
      this.resolveSelfTest(msg);
      return;
    }

    if (msg.kind === "result") {
      if (msg.reqId === "entry") {
        this.deferEntryResolution(msg);
      } else if (msg.reqId === "init" && !msg.ok) {
        this.resolveEntry(msg);
      }
      return;
    }

    // Ignore logs and unknown messages.
  }

  private async handleInvoke(msg: SandboxInvoke) {
    this.kernel.setSelfTestPassed(this.selfTestPassed);
    let consentReasons: string[] = [];
    if (msg.capId === "id.sign" && this.opts.secretZoneHost) {
      const consent = await this.opts.secretZoneHost.requestConsent("id.sign", {
        blockHash: this.opts.callerBlockHash,
        planDigest: this.opts.planDigest,
      });
      if (consent.ok && consent.consent) {
        this.kernel.setConsentClaim(consent.consent);
      } else {
        this.kernel.setConsentClaim(undefined);
        consentReasons = (consent.reasonCodes || []).filter((v) => typeof v === "string");
      }
    }

    const pulseSubject: PulseSubjectV0 = { kind: "block", id: this.opts.callerBlockHash };
    this.emitPulse("CAP_REQUEST", pulseSubject, { capId: msg.capId, counts: { capsRequested: 1 } });

    const { decision } = this.kernel.handleInvoke({
      reqId: msg.reqId,
      capId: msg.capId,
      executionMode: msg.executionMode,
      planDigest: msg.planDigest,
      sessionNonce: msg.sessionNonce,
      callerBlockHash: msg.callerBlockHash,
    });

    if (decision.ok) {
      this.emitPulse("CAP_ALLOW", pulseSubject, { capId: msg.capId });
      this.postToSandbox({
        kind: "result",
        reqId: msg.reqId,
        ok: true,
        value: decision.value ?? null,
      });
      return;
    }

    const reasonCodes = joinReasonsV0(decision.reasonCodes ?? ["CAP_DISABLED_V0"], consentReasons);
    this.emitPulse("CAP_DENY", pulseSubject, {
      capId: msg.capId,
      reasonCodes,
      counts: { capsDenied: 1 },
    });
    this.postToSandbox({
      kind: "result",
      reqId: msg.reqId,
      ok: false,
      reasonCodes,
    });
  }

  private attachPortListener(port: MessagePortLike) {
    if (typeof port.on === "function") {
      port.on("message", (msg: unknown) => this.handlePortMessage(msg as SandboxMessage));
    } else if (typeof port.onmessage !== "undefined") {
      port.onmessage = (evt: { data: unknown }) => this.handlePortMessage(evt.data as SandboxMessage);
    }
    if (typeof port.start === "function") port.start();
  }

  private handlePortMessage(msg: SandboxMessage) {
    if (!this.isBoundMessage(msg)) {
      this.postToSandbox({
        kind: "result",
        reqId: (msg as any).reqId ?? "unknown",
        ok: false,
        reasonCodes: stableSortUniqueReasonsV0(["NONCE_MISMATCH", "CONTEXT_MISMATCH", "MODE_MISMATCH"]),
      });
      return;
    }
    this.handleMessage(msg);
  }

  private handleUntrustedChannel(_msg: SandboxMessage) {
    this.untrustedSeen = true;
    if (this.pendingEntry) {
      this.pendingEntry = null;
    }
    this.resolveEntry(this.makeResult({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["UNTRUSTED_CHANNEL"] }));
  }

  private isBoundMessage(msg: SandboxMessage): boolean {
    if ((msg as any).executionMode !== "strict") return false;
    if (!safeEqual((msg as any).planDigest ?? "", this.opts.planDigest)) return false;
    if (!safeEqual((msg as any).sessionNonce ?? "", this.sessionNonce)) return false;
    return true;
  }

  private postToSandbox(partial: SandboxResultPayload) {
    if (!this.hostPort) return;
    this.hostPort.postMessage({
      ...partial,
      executionMode: "strict",
      planDigest: this.opts.planDigest,
      sessionNonce: this.sessionNonce,
    } as SandboxResult);
  }

  private deferEntryResolution(result: SandboxResult) {
    if (this.untrustedSeen) {
      this.resolveEntry(this.makeResult({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["UNTRUSTED_CHANNEL"] }));
      return;
    }
    if (this.pendingEntry) return;
    this.pendingEntry = result;
    setTimeout(() => {
      if (!this.pendingEntry) return;
      const pending = this.pendingEntry;
      this.pendingEntry = null;
      if (this.untrustedSeen) {
        this.resolveEntry(
          this.makeResult({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["UNTRUSTED_CHANNEL"] })
        );
      } else {
        this.resolveEntry(pending);
      }
    }, 0);
  }

  private runSelfTest(): Promise<SandboxSelfTestResult> {
    const reqId = "selftest";
    const msg: SandboxSelfTest = {
      kind: "selftest",
      reqId,
      executionMode: "strict",
      planDigest: this.opts.planDigest,
      sessionNonce: this.sessionNonce,
    };
    this.hostPort?.postMessage(msg);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          kind: "selftest.result",
          reqId,
          ok: false,
          reasonCodes: ["SELFTEST_TIMEOUT"],
          executionMode: "strict",
          planDigest: this.opts.planDigest,
          sessionNonce: this.sessionNonce,
        });
      }, 1000);
      this.selfTestResolve = (res: SandboxSelfTestResult) => {
        clearTimeout(timeout);
        resolve(res);
      };
    });
  }

  private resolveSelfTest(result: SandboxSelfTestResult) {
    if (this.selfTestResolve) {
      const resolve = this.selfTestResolve;
      this.selfTestResolve = null;
      resolve(result);
    }
  }

  private makeResult(partial: SandboxResultPayload): SandboxResult {
    return {
      ...partial,
      executionMode: "strict",
      planDigest: this.opts.planDigest,
      sessionNonce: this.sessionNonce,
    } as SandboxResult;
  }
}
