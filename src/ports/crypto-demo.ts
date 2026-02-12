/* src/ports/crypto-demo.ts */
/**
 * Demo-only CryptoPort helpers (NOT secure).
 * Guard usage with WEFTEND_DEMO_CRYPTO_OK=1.
 */
// @ts-nocheck

export const DEMO_CRYPTO_ENV = "WEFTEND_DEMO_CRYPTO_OK";

const fnv1a32 = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const deriveDemoPublicKey = (secret) => `pub:${fnv1a32(secret)}`;

export const isDemoCryptoAllowed = (env) => env && env[DEMO_CRYPTO_ENV] === "1";

export const isDemoCryptoPort = (port) => Boolean(port && port.demo === true);

const signatureForPayload = (payloadCanonical, publicKey) => {
  const raw = `sig:${fnv1a32(`${payloadCanonical}::${publicKey}`)}`;
  if (typeof Buffer !== "undefined") return Buffer.from(raw, "utf8").toString("base64");
  if (typeof btoa === "function") return btoa(raw);
  return raw;
};

export const makeDemoCryptoPort = (secret) => {
  const port = {
    hash: (canonical) => `fnv1a32:${fnv1a32(canonical)}`,
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
