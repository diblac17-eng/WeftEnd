# Entitlements (Offline License) — v1

Purpose
WeftEnd supports an **offline entitlement file** to enable paid/enterprise automation features (watchlist, background scans, integrations). This file is **signed** by the vendor and **verified locally**. No network required.

What this is
- A small JSON file (schema: `weftend.entitlement/1`).
- Signed with a vendor private key (Ed25519).
- Verified locally using the vendor public key.

What this is not
- Not a cloud activation.
- Not a telemetry channel.
- Not a secret stored inside receipts.

How to issue (vendor)
```
npm run weftend -- license issue \
  --key <private.pem> \
  --out <license.json> \
  --customer <id> \
  --tier enterprise \
  --features watchlist,auto_scan,ticket_pack_auto \
  --issued 2026-02-05 \
  --key-id weftend-vendor-1
```

How to verify (operator)
```
npm run weftend -- license verify --license <license.json> --pub <public.pem>
```

Storage (recommended)
- Place the license file in a known local location (e.g., `%LOCALAPPDATA%\WeftEnd\license.json`).
- Do not store private keys on the operator machine.

Privacy
- Entitlements are never embedded into receipts.
- Only a **license digest** should be recorded (future enhancement).

Key separation
- **Release signing keys** (publishers) are separate from **entitlement keys** (vendor).
- Do not reuse the same key pair.
