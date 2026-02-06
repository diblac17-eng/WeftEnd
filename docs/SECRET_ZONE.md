# SecretZone (v0)

What it is
- A **consent boundary** for sensitive actions (e.g., `id.sign`).
- A **nonce‑bound channel** that prevents spoofed or ambient requests.
- A **fail‑closed gate**: if the channel is missing or mismatched, the action is denied.

What it does today
- SecretZone is **wired into strict execution** as a host boundary.
- It becomes active **only if** a consent‑gated capability is requested (currently `id.sign`).
- If no consent is requested or no `secretZoneHost` is provided, it remains **dormant**.

What it does not do (yet)
- It **does not store keys**.
- It **does not make policy decisions** by itself.
- It **does not guarantee a UI prompt** (that is host‑specific).

Why it exists
- To separate **sensitive actions** from normal execution.
- To support future additions (key custody, human approval, device‑bound consent) **without changing receipts**.

Current status
- **Active boundary**, but only used when `id.sign` is explicitly requested.
- **Future‑ready** for secure key custody and UI‑based consent flows.
