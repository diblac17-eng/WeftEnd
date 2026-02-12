// src/core/hash_v0.ts
// Shared SHA-256 helpers (deterministic, Node runtime).

declare const require: any;
const crypto = require("crypto");

export const sha256HexV0 = (input: string): string =>
  crypto.createHash("sha256").update(String(input ?? ""), "utf8").digest("hex");

export const sha256HexBytesV0 = (input: Uint8Array): string =>
  crypto.createHash("sha256").update(input).digest("hex");

export const createSha256HasherV0 = () => crypto.createHash("sha256");
