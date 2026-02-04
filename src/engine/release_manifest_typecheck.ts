// src/engine/release_manifest_typecheck.ts
// Compile-time guard: pathDigest is required for release manifest bodies.

import type { ReleaseManifestBodyV0 } from "../core/types";

// @ts-expect-error pathDigest must be provided
const _missing: ReleaseManifestBodyV0 = {
  planDigest: "plan-typed",
  policyDigest: "policy-typed",
  blocks: [],
};

void _missing;

export {};
