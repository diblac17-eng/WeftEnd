// src/runtime/secretzone/secret_zone_host.ts
// SecretZone host boundary (v0).

import type { MessagePortLike } from "../boundary/channel";
import type {
  SecretZoneConsentRequest,
  SecretZoneConsentResult,
  SecretZoneInit,
  SecretZoneMessage,
  SecretZoneResult,
  SecretZoneMode,
} from "./types";
import type { ConsentClaimV0 } from "../../core/types";
import { createBoundChannel } from "../boundary/channel";
import { newNonce, safeEqual, validateNonce } from "../boundary/nonce";

const sortReasonCodes = (codes: string[]): string[] => Array.from(new Set(codes)).sort();

type SecretZoneResultPayload =
  | { kind: "result"; reqId: string; ok: true; value?: unknown }
  | { kind: "result"; reqId: string; ok: false; reasonCodes: string[] };

export class SecretZoneHost {
  private executionMode: SecretZoneMode;
  private planHash: string;
  private sessionNonce: string;
  private hostPort: MessagePortLike | null = null;
  private pendingConsent = new Map<string, (res: { ok: boolean; consent?: ConsentClaimV0; reasonCodes?: string[] }) => void>();
  private reqSeq = 0;

  constructor(planHash: string, executionMode: SecretZoneMode = "strict-privacy") {
    this.planHash = planHash;
    this.executionMode = executionMode;
    this.sessionNonce = newNonce();
  }

  initChannel(): { hostPort: MessagePortLike; childPort: MessagePortLike; init: SecretZoneInit; sessionNonce: string } {
    if (!validateNonce(this.sessionNonce)) {
      this.sessionNonce = newNonce();
    }
    if (!validateNonce(this.sessionNonce)) {
      throw new Error("NONCE_INVALID");
    }
    const { hostPort, childPort } = createBoundChannel();
    this.hostPort = hostPort;
    this.attachPortListener(hostPort);

    const init: SecretZoneInit = {
      kind: "init",
      executionMode: this.executionMode,
      planHash: this.planHash,
      sessionNonce: this.sessionNonce,
    };
    return { hostPort, childPort, init, sessionNonce: this.sessionNonce };
  }

  private attachPortListener(port: MessagePortLike) {
    if (typeof port.on === "function") {
      port.on("message", (msg: unknown) => this.handlePortMessage(msg as SecretZoneMessage));
    } else if (typeof port.onmessage !== "undefined") {
      port.onmessage = (evt: { data: unknown }) => this.handlePortMessage(evt.data as SecretZoneMessage);
    }
    if (typeof port.start === "function") port.start();
  }

  private handlePortMessage(msg: SecretZoneMessage) {
    const reasons: string[] = [];
    if (msg.executionMode !== this.executionMode) reasons.push("MODE_MISMATCH");
    if (!safeEqual(msg.planHash, this.planHash)) reasons.push("CONTEXT_MISMATCH");
    if (!safeEqual(msg.sessionNonce, this.sessionNonce)) reasons.push("NONCE_MISMATCH");

    if (reasons.length > 0) {
      this.postToChild({
        kind: "result",
        reqId: (msg as any).reqId ?? "unknown",
        ok: false,
        reasonCodes: sortReasonCodes(reasons),
      });
      const pending = this.pendingConsent.get((msg as any).reqId ?? "");
      if (pending) {
        this.pendingConsent.delete((msg as any).reqId ?? "");
        pending({ ok: false, reasonCodes: sortReasonCodes(reasons) });
      }
      return;
    }

    if (msg.kind === "consent.result") {
      const pending = this.pendingConsent.get(msg.reqId);
      if (pending) {
        this.pendingConsent.delete(msg.reqId);
        if (msg.ok) pending({ ok: true, consent: msg.consent });
        else pending({ ok: false, reasonCodes: sortReasonCodes(msg.reasonCodes || []) });
      }
      return;
    }

    this.postToChild({
      kind: "result",
      reqId: (msg as any).reqId ?? "unknown",
      ok: false,
      reasonCodes: ["SECRET_ZONE_UNAVAILABLE"],
    });
  }

  private postToChild(partial: SecretZoneResultPayload) {
    if (!this.hostPort) return;
    const msg: SecretZoneResult = {
      ...(partial as any),
      executionMode: this.executionMode,
      planHash: this.planHash,
      sessionNonce: this.sessionNonce,
    };
    this.hostPort.postMessage(msg);
  }

  requestConsent(
    action: "id.sign",
    subject: { blockHash: string; planDigest: string },
    scope?: string[]
  ): Promise<{ ok: boolean; consent?: ConsentClaimV0; reasonCodes?: string[] }> {
    if (!this.hostPort) {
      return Promise.resolve({ ok: false, reasonCodes: ["SECRET_ZONE_UNAVAILABLE"] });
    }

    const reqId = `consent-${this.reqSeq++}`;
    const msg: SecretZoneConsentRequest = {
      kind: "consent.request",
      reqId,
      action,
      subject,
      scope,
      executionMode: this.executionMode,
      planHash: this.planHash,
      sessionNonce: this.sessionNonce,
    };

    this.hostPort.postMessage(msg);
    return new Promise<{ ok: boolean; consent?: ConsentClaimV0; reasonCodes?: string[] }>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingConsent.delete(reqId);
        resolve({ ok: false, reasonCodes: ["SECRET_ZONE_TIMEOUT"] });
      }, 1000);

      this.pendingConsent.set(reqId, (res) => {
        clearTimeout(timeout);
        resolve(res);
      });
    });
  }
}
