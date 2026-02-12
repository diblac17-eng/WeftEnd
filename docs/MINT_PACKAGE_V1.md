# WeftEnd Mint Package v1

This document defines the single product output of the v1 examiner flow.

## Purpose

WeftEnd Mint v1 is a deterministic, time-free, bounded receipt for an artifact.
It is designed for tooling (JSON adapter) and humans (text report).

## Schema

Top-level object:

- schema: "weftend.mint/1"
- profile: "web" | "mod" | "generic"
- input:
  - kind: "file" | "dir" | "zip"
  - rootDigest: "fnv1a32:..."
  - fileCount: number
  - totalBytes: number
- capture:
  - captureDigest: "fnv1a32:..."
  - paths: string[] (optional, bounded sample list)
- observations:
  - fileKinds: { html, js, css, json, wasm, media, binary, other }
  - externalRefs: string[] (bounded, deterministic order)
  - scriptsDetected: boolean
  - wasmDetected: boolean
- executionProbes:
  - strictAvailable: boolean
  - strictUnavailableReason?: string
  - loadOnly: ProbeResultV1
  - interactionScript?: ProbeResultV1
- grade:
  - status: "OK" | "WARN" | "DENY" | "QUARANTINE"
  - reasonCodes: string[] (bounded, deterministic order)
  - receipts: ReceiptV1[] (bounded)
  - scars?: string[] (bounded)
- digests:
  - mintDigest: "fnv1a32:..."
  - inputDigest: "fnv1a32:..."
  - policyDigest: string ("-" when unused)
- limits:
  - maxFiles
  - maxTotalBytes
  - maxFileBytes
  - maxExternalRefs
  - maxScriptBytes
  - maxScriptSteps

ProbeResultV1:

- status: "OK" | "WARN" | "DENY" | "QUARANTINE"
- reasonCodes: string[] (bounded, deterministic order)
- deniedCaps: { [capId]: number }
- attemptedCaps: { [capId]: number }

ReceiptV1:

- kind: string
- digest: "fnv1a32:..."
- summaryCounts: { [key]: number }
- reasonCodes: string[] (bounded, deterministic order)

## Determinism Rules

- All arrays are stable-sorted and de-duplicated where required.
- Objects are canonicalized by key order.
- No wall-clock time, no randomness, no host identifiers.

## Boundedness Rules

Hard caps are enforced by the validator:

- max externalRefs
- max reasonCodes
- max receipts
- max paths sample length
- max string byte length
- max total JSON bytes

## Failure Mode

If any bound is exceeded or schema is invalid, validation fails closed
with deterministic reason codes.
