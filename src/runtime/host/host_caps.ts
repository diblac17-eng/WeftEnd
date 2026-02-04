// src/runtime/host/host_caps.ts
// Host cap summary helpers (deny-by-default).

import type { CapDenyTelemetry } from "../kernel/cap_kernel";
import { stableSortUniqueStringsV0 } from "../../core/trust_algebra_v0";

export interface HostCapsSummaryV0 {
  requested: string[];
  granted: string[];
  denied: string[];
}

export const buildHostCapsSummaryV0 = (
  grantedCaps: string[],
  telemetry: CapDenyTelemetry[]
): HostCapsSummaryV0 => {
  const requested: string[] = [];
  const denied: string[] = [];

  telemetry.forEach((event) => {
    if (!event || typeof event.capId !== "string") return;
    requested.push(event.capId);
    denied.push(event.capId);
  });

  const granted = Array.isArray(grantedCaps) ? grantedCaps.slice() : [];
  return {
    requested: stableSortUniqueStringsV0([...requested, ...granted]),
    granted: stableSortUniqueStringsV0(granted),
    denied: stableSortUniqueStringsV0(denied),
  };
};
