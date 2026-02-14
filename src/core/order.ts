/* src/core/order.ts */
// Stable ordering helpers (locale-independent).

export const cmpStrV0 = (a: string, b: string): number => {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
};

export const cmpNumV0 = (a: number, b: number): number => {
  const left = Number(a ?? 0);
  const right = Number(b ?? 0);
  return left - right;
};

