/* src/ports/crypto-demo.ts */
/**
 * Demo-only CryptoPort helpers (NOT secure).
 * Guard usage with WEFTEND_DEMO_CRYPTO_OK=1.
 */
// @ts-nocheck

import { sha256HexV0 } from "../core/hash_v0";

export const DEMO_CRYPTO_ENV = "WEFTEND_DEMO_CRYPTO_OK";

const sha256 = (input) => sha256HexV0(String(input ?? ""));

export const deriveDemoPublicKey = (secret) => `pub:${sha256(secret)}`;

export const isDemoCryptoAllowed = (env) => env && env[DEMO_CRYPTO_ENV] === "1";

export const isDemoCryptoPort = (port) => Boolean(port && port.demo === true);

const signatureForPayload = (payloadCanonical, publicKey) => {
  const raw = `sig:${sha256(`${payloadCanonical}::${publicKey}`)}`;
  if (typeof Buffer !== "undefined") return Buffer.from(raw, "utf8").toString("base64");
  if (typeof btoa === "function") return btoa(raw);
  return raw;
};

export const makeDemoCryptoPort = (secret) => {
  const port = {
    hash: (canonical) => `sha256:${sha256(canonical)}`,
    verifySignature: (payload, sig, publicKey) =>
      sig.sig === signatureForPayload(payload, publicKey),
    sign: (payloadCanonical, keyId) => {
      const publicKey = deriveDemoPublicKey(secret);
      return {
        algo: "sig.demo.v0",
        keyId,
        sig: signatureForPayload(payloadCanonical, publicKey),
      };
    },
    demo: true,
  };
  return port;
};
