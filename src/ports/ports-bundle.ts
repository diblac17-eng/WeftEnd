/* src/ports/ports-bundle.ts */
/**
 * WeftEnd (WebLayers v2.6) — PortsBundle (interfaces only)
 *
 * Phase: port interfaces, no implementation.
 */

import type { CapabilityError, Result } from "../core/types";

import type { ClockPort } from "./clock-port";
import type { CryptoPort } from "./crypto-port";
import type { DiagPort } from "./diag-port";
import type { IdPort } from "./id-port";
import type { IdentityPort } from "./identity-port";
import type { LoggerPort } from "./logger-port";

// -----------------------------
// Capability host kernel boundary
// -----------------------------

export interface NetFetchRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface NetFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface KvKey {
  namespace: string;
  key: string;
}

/**
 * Host kernel primitives.
 *
 * Security contract:
 * - Blocks never receive this port.
 * - Runtime must gate every call using the compiled plan (deny-by-default).
 */
export interface CapabilityHostPort {
  netFetch(req: NetFetchRequest): Promise<Result<NetFetchResponse, CapabilityError>>;

  kvRead(key: KvKey): Promise<Result<string | undefined, CapabilityError>>;
  kvWrite(key: KvKey, value: string): Promise<Result<void, CapabilityError>>;

  dbQuery(query: { connection: string; sql: string; params?: unknown[] }): Promise<
    Result<unknown, CapabilityError>
  >;

  secretsGet(name: string): Promise<Result<string, CapabilityError>>;

  sessionRead(): Promise<Result<unknown, CapabilityError>>;
  sessionWrite(session: unknown): Promise<Result<void, CapabilityError>>;
}

// -----------------------------
// Bundle
// -----------------------------

export interface PortsBundle {
  logger: LoggerPort;
  diag: DiagPort;
  clock: ClockPort;
  id: IdPort;
  crypto: CryptoPort;

  /** Optional runtime identity provider (passkey/keystore/wallet). */
  identity?: IdentityPort;

  /** Present in runtimes that can perform capability calls. */
  capHost?: CapabilityHostPort;
}