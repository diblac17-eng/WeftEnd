// src/runtime/boundary/nonce.ts
// Session nonce helpers (v0).

declare const require: (id: string) => any;
declare const Buffer: any;

const MAX_NONCE_LEN = 128;
const NONCE_RE = /^[A-Za-z0-9_-]+$/;

const bytesToBase64Url = (bytes: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    const b64 = Buffer.from(bytes).toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = (globalThis as any).btoa ? (globalThis as any).btoa(bin) : "";
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const randomBytes = (len: number): Uint8Array | null => {
  const g = globalThis as any;
  if (g.crypto?.getRandomValues) {
    const buf = new Uint8Array(len);
    g.crypto.getRandomValues(buf);
    return buf;
  }
  try {
    const crypto = require("crypto");
    return crypto.randomBytes(len);
  } catch {
    return null;
  }
};

export const newNonce = (): string => {
  const bytes = randomBytes(16);
  if (!bytes || bytes.length !== 16) return "";
  return bytesToBase64Url(bytes);
};

export const validateNonce = (nonce: string): boolean => {
  if (typeof nonce !== "string") return false;
  if (nonce.length === 0 || nonce.length > MAX_NONCE_LEN) return false;
  return NONCE_RE.test(nonce);
};

export const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
