/* src/runtime/library_keys.ts */
// Deterministic library key helpers (no paths).

import { computeArtifactDigestV0 } from "./store/artifact_store";

export const sanitizeLibraryTargetKeyV0 = (name: string): string => {
  const base = name && name.trim() ? name : "target";
  let clean = base.toLowerCase();
  clean = clean.replace(/[^a-z0-9._-]/g, "_");
  clean = clean.replace(/\./g, "_");
  clean = clean.replace(/^[_\.\-]+/, "").replace(/[_\.\-]+$/, "");
  if (!clean) clean = `target_${computeArtifactDigestV0(base).replace("fnv1a32:", "")}`;
  if (clean.length > 48) clean = clean.slice(0, 48);
  return clean;
};

