/* src/ports/crypto-port.ts */
/**
 * WeftEnd (WebLayers v2.6) — CryptoPort (interface only)
 *
 * Phase 1: port interface, no implementation.
 *
 * Crypto trust is first-class. Engine consumes this port but remains pure logic.
 */

import type { Signature } from "../core/types";

export interface CryptoPort {
  /** Hash of canonical JSON (string) -> contentHash (string). */
  hash(canonical: string): string;

  /** Verify signature over canonical payload. */
  verifySignature(payloadCanonical: string, sig: Signature, publicKey: string): boolean;

  /** Sign canonical payload (optional, required for minting). */
  sign?(payloadCanonical: string, keyId: string): Signature;
}
