// src/core/bounds.ts
// Shared deterministic truncation helpers (ASCII-only markers).

export const makeTruncationMarker = (dropped: number): string => `...(+${dropped})`;

export const truncateListWithMarker = (items: string[], maxItems: number): { items: string[]; dropped: number } => {
  const limit = Math.max(0, Math.floor(maxItems));
  if (items.length <= limit) return { items, dropped: 0 };
  const dropped = items.length - limit;
  const marker = makeTruncationMarker(dropped);
  if (limit === 0) return { items: [marker], dropped };
  return { items: [...items.slice(0, limit), marker], dropped };
};

export const truncateTextWithMarker = (value: string, maxChars: number): { value: string; dropped: number } => {
  const limit = Math.max(0, Math.floor(maxChars));
  if (value.length <= limit) return { value, dropped: 0 };
  const dropped = value.length - limit;
  const marker = makeTruncationMarker(dropped);
  if (limit <= marker.length) return { value: marker.slice(0, limit), dropped };
  return { value: `${value.slice(0, limit - marker.length)}${marker}`, dropped };
};
