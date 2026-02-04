# Game-Side Integration Stub (Workshop + WeftEnd)

Minimal pattern a game can wire in before loading a Workshop item.

## Steps

1) Locate the Workshop item folder (Steam provides the install path).
2) Read the WeftEnd pointer from metadata (browse time).
3) On install/use, recompute digests from the folder and verify policy.
4) If `ACCEPT`, load the mod; else deny and show reason codes.

## Pseudocode (engine-agnostic)

```js
const folderPath = steam.getItemInstallPath(itemId);
const pointer = readPointerFromMetadata(itemId); // never "verified" at browse

const verify = verifyInstalledWorkshopItemV1(fs, folderPath, pointer, {
  policyDigest: POLICY_DIGEST,
  requiredEvidenceKinds: ["signature.v1"],
});

if (verify.verdict !== "ACCEPT") {
  ui.showError("Mod blocked", verify.reasonCodes);
  return;
}

loadModFromFolder(folderPath);
```

This is the minimum safe wiring: pointer != proof, and verification happens before load.
