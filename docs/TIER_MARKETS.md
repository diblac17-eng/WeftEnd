# Tier Markets (Phase 2 contract)

Status: normative for types/validation. Runtime enforcement is Phase 3. If this conflicts with `docs/weblayers-v2-spec.md`, `docs/PROJECT_STATE.md`, or `docs/INTEGRATION_CONTRACT.md`, stop and raise a Proposal.

---

## Pillars (must stay true)
- **No market-to-market calls (M1):** markets never accept RPC/requests from other markets. Downflow is replication only.
- **Snapshots, not RPC (M2):** markets publish sealed snapshots (digest-addressed). Downstream replicates/validates; no parameters, no “do X for me.”
- **Tier purity (M3):** a market accepts blocks from same or higher tier only; never from lower tiers.
- **Top tier is outbound-only (M4):** top tier can publish snapshots down; it cannot ingest from lower tiers. Only human/governance inside top tier can mint.
- **Promotion = re-mint (M5):** lower tiers can submit `PromotionRequest` references; higher tiers re-build/re-verify/re-stamp, producing a new hash in their tier.
- **Deterministic ordering (M6):** all snapshot lists are stable-sorted. Same input => same ordering => same digests.
- **Portal can’t lie (M7):** market UIs derive solely from verified snapshots + stamps + reason codes. Verification failure shows `UNVERIFIED` with reasons.

---

## Tiers and ordering
- Tiers: `T3` (highest) > `T2` > `T1` > `T0` (lowest).
- Rank helper: `T3=3, T2=2, T1=1, T0=0`.
- Downflow allowed: higher → lower (rank decreases) via snapshots.
- Upflow import forbidden: lower → higher is not allowed; only reference promotions (re-mint in higher tier).

---

## Allowed interfaces
- **Human/Tool → Market:** search, fetch block by hash, publish (if authorized), submit promotion request (reference only).
- **Market → Lower Markets:** publish snapshot for replication (sealed, digest-addressed).

## Explicitly denied
- Market → Market RPC calls.
- Lower → Higher direct block import.

---

## Promotion workflow (reference-only)
1) Lower tier submits `PromotionRequest` with block hash reference.
2) Higher tier independently re-builds/re-verifies/re-stamps the block; emits new hash and stamps in its own snapshot.
3) No raw code or payload flows upward; only references.

---

## Deterministic ordering rules
- Snapshot blocks: stable-sorted by `blockHash` (lex).
- Stamps within a block: stable-sorted by `(shopId, policyDigest, acceptDecision, stampDigest)`.
- Reason codes within stamps: stable-sorted lex.
- Upstream list (if present): stable-sorted by `(tier, snapshotDigest)`.

---

## Trust invariants
- Every block entry must carry stamps; every stamp tier matches the snapshot tier; every stamp blockHash matches the entry hash.
- Upstream provenance must never claim a lower tier feeding a higher snapshot (upflow denied).
- If it’s not in a verified snapshot, it’s not in the market.

---

## Summary rules
- Downflow = sealed snapshot replication.
- Upflow = forbidden except reference promotions; higher tier re-mints.
- No RPC between markets.
- Deterministic ordering everywhere.
