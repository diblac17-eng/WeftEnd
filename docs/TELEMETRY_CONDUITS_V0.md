# TELEMETRY_CONDUITS_V0

Local, pull-only telemetry conduits (v0).

Goals
- Deterministic, bounded, aggregate-only telemetry snapshots.
- Pull-only: no push, no network, no background export.
- Local-only: stored under the release folder, never outside unless explicitly exported.
- Non-tracking: no stable IDs, no wall-clock time, no free-form strings.
- k-floor enforced: no aggregates emitted when sampleCount < k.

Non-goals
- Real-time streaming, network emitters, or push channels.
- Per-user or per-session identity.
- Raw event logs or unbounded telemetry payloads.

Data model (v0)

TelemetryAggregateV0
- schema: "weftend.telemetry.aggregate/0"
- bind: { pathDigest }
- kFloor, sampleCount
- aggregates: bounded count maps only (cap denies, reason families, tartarus kinds)

TelemetryChunkV0
- schema: "weftend.telemetry.chunk/0"
- streamId
- chunkId (content hash of the canonical body)
- prevChunkId
- windowStartTick, windowEndTick (tick order, not wall time)
- payload: TelemetryAggregateV0
- evidenceRefs[], tartarusRefs[] (digest refs only)
- ttlSeconds (used as tick TTL in v0)
- kAnonymityFloor, coverage

TelemetryJournalV0
- schema: "weftend.telemetry.journal/0"
- streamId
- headChunkId
- updatedAtTick (tick, not time)

TelemetryConduitStoreV0
- schema: "weftend.telemetry.conduitStore/0"
- journal + chunks[]
- Stored at: `receipts/telemetry_conduit.json`

TelemetryConduitSnapshotV0
- schema: "weftend.telemetry.conduitSnapshot/0"
- streamId, headChunkId
- chunks[] (bounded, TTL pruned)
- dropped counters: ttlPruned, capPruned, kFloorSkipped, duplicateSkipped
- reasonCodes[] (optional, stable-sorted)

Determinism + boundedness
- Canonical JSON is the only hashing/serialization path.
- Chunks are stable-sorted and content-addressed.
- Store caps: max chunks, max chunk bytes.
- TTL pruning is deterministic (drop expired by tick).
- Reason lists are stable-sorted and bounded.
- Dropped counters are explicit and bounded.

Privacy guardrails
- No stable IDs or wall-clock time in any conduit artifact.
- Payloads are aggregate-only, no free-form text.
- Privacy validation applies to snapshots and payloads.

CLI (v0)
- `weftend telemetry-conduit <releaseDir> --out <path> --k <minCount> [--preview] [--apply]`
- Preview prints a snapshot to stdout (no writes).
- Apply writes `telemetry_conduit_snapshot.json` to `--out` and updates the local store.

Failure behavior
- k-floor not met: no chunk appended; snapshot includes reason code and dropped counter.
- Invalid inputs: fail closed with stable, bounded issues.
