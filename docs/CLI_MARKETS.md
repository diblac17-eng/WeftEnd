# CLI_MARKETS.md - WeftEnd Market Catalog CLI (v0)

Status: guidance. This document must not conflict with:
- `docs/PROJECT_STATE.md`
- `docs/weblayers-v2-spec.md`
- `docs/INTEGRATION_CONTRACT.md`
- `docs/TIER_MARKETS.md`

If any conflict is found, stop and write a Proposal.

---

## 0) Intent

Markets are on-disk distribution catalogs. They do not grant capabilities and do not change runtime enforcement (Phase 3).

Determinism rules:
- Canonical JSON for snapshots.
- Stable-sorted lists.
- Fail closed on invalid or unverifiable inputs.

---

## A) On-disk layout

```
markets/<marketId>/
  latest.json
  snapshots/
    000001.json
    000002.json
  blocks/          (optional cache store; may be empty in MVP)
  README.txt       (optional)
```

`latest.json` is a copy of the most recent snapshot file.

---

## B) Commands

### 1) Publish snapshot

```
npm run weftend -- market publish <marketDir> --tier <T1|T2|T3> --policy <policyDigest> --blocks <pathOrList> [--sign]
```

Behavior:
- `marketId` is derived from `<marketDir>` basename.
- `--blocks` accepts:
  - a comma/newline-separated list, or
  - a file path (list), or
  - a directory containing `weftend/manifest.json` (import output), or `blocks.txt`.
- Blocks are stable-sorted and de-duplicated.
- Stamps are minted per block (shopId = `marketId`).
- `--sign` attaches signatures to stamps using `WEFTEND_SIGNER_KEY_ID` and `WEFTEND_SIGNING_KEY`.
- If `WEFTEND_SIGNING_KEY` is a PEM private key (Ed25519 or P-256), real crypto is used.
- If `WEFTEND_SIGNING_KEY` is not PEM, demo signing requires `WEFTEND_DEMO_CRYPTO_OK=1` (else `DEMO_CRYPTO_FORBIDDEN`).
- Snapshot is written to `snapshots/00000N.json` and copied to `latest.json`.

---

### 2) Mirror snapshot (downflow only)

```
npm run weftend -- market mirror <srcMarketDir> <dstMarketDir>
```

Behavior:
- Reads `src/latest.json` (must exist).
- Reads `dst/latest.json` if present (else starts sequence at 1).
- Enforces downflow: `src.tier` must be strictly higher than `dst.tier`.
- If `dst/latest.json` is missing, its tier is inferred as one tier below `src`.
- New snapshot unions blocks and stamps, stable-sorted.
- Incoming blocks are stamped by the destination market (tier = dst tier, shopId = `dstMarketId`).
- `upstream` records the source snapshot digest plus any existing upstreams.

Failure codes:
- `MARKET_MIRROR_UPWARD_DENIED` if `src.tier <= dst.tier`.

---

### 3) Resolve (client view)

```
npm run weftend -- market resolve <marketDir> <blockHash>
```

Behavior:
- Reads and validates `latest.json`.
- Prints deterministic JSON:
  - `present: true|false`
  - `marketId`, `tier`, `sequence`, `snapshotDigest`
  - `entry` (when present)

---

### 4) Admit/promote from import output

```
npm run weftend -- market admit <marketDir> <importOutDir>
```

Behavior:
- Reads `weftend/manifest.json`, `weftend/evidence.json`, `weftend/import_report.json`.
- Validates all documents.
- Admission rules:
  - All tiers: `import_report.strictLoad.verdict` must be `ALLOW`.
  - T2: requires non-empty `evidenceDigests`.
  - T3: requires `signature.v1` evidence.
- On success, appends the block to a new snapshot and writes `latest.json`.

Failure codes:
- `MARKET_ADMIT_DENY` with reason codes in the message.

---

## C) Notes

- Market snapshots are distribution catalogs only.
- Runtime enforcement remains policy + evidence gated (Phase 3 deferred).

