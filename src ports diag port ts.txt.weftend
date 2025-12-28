/* src/ports/diag-port.ts */
/**
 * WeftEnd (WebLayers v2.6) — DiagPort (interface only)
 *
 * Phase 1: port interface, no implementation.
 */

export type DiagLevel = "debug" | "info" | "warn" | "error";

export interface DiagEvent {
  at: string; // ISO
  level: DiagLevel;
  code: string;
  message: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}

export interface DiagPort {
  emit(event: DiagEvent): void;
}