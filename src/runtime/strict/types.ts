// src/runtime/strict/types.ts
// Strict membrane message protocol (Phase 3, v0).

export type StrictMode = "strict";
export type CapId = string;

export type MessagePortLike = {
  postMessage: (msg: unknown, transfer?: unknown[]) => void;
  onmessage?: ((ev: { data: unknown }) => void) | null;
  on?: (event: "message", listener: (data: unknown) => void) => void;
  start?: () => void;
  close?: () => void;
};

export interface StrictEnvelope {
  executionMode: StrictMode;
  planDigest: string;
  sessionNonce: string;
}

export interface SandboxInit extends StrictEnvelope {
  kind: "init";
  callerBlockHash: string;
  grantedCaps: string[];
  sourceText?: string;
  entryExportName?: string;
  entryArgs?: unknown;
  testKeepGlobal?: string;
  port?: MessagePortLike;
}

export interface SandboxInvoke extends StrictEnvelope {
  kind: "invoke";
  reqId: string;
  capId: CapId;
  args: unknown;
  callerBlockHash: string;
}

export type SandboxResult =
  | (StrictEnvelope & { kind: "result"; reqId: string; ok: true; value: unknown })
  | (StrictEnvelope & { kind: "result"; reqId: string; ok: false; reasonCodes: string[] });

export interface SandboxLog extends StrictEnvelope {
  kind: "log";
  level: "info" | "warn" | "error";
  msg: string;
}

export interface SandboxSelfTest extends StrictEnvelope {
  kind: "selftest";
  reqId: string;
}

export interface SandboxSelfTestResult extends StrictEnvelope {
  kind: "selftest.result";
  reqId: string;
  ok: boolean;
  details?: Record<string, unknown>;
  reasonCodes?: string[];
}

export type SandboxMessage =
  | SandboxInit
  | SandboxInvoke
  | SandboxResult
  | SandboxLog
  | SandboxSelfTest
  | SandboxSelfTestResult;
