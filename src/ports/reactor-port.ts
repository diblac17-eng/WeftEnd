/* src/ports/reactor-port.ts */
/**
 * WeftEnd (WebLayers v2.6) — ReactorPort (interface only)
 *
 * Purpose:
 * - Represents the Inner cyclic runtime loop (gaming/streaming “reactor”).
 * - The Outer DAG remains acyclic and produces approved snapshots.
 *
 * Hard law (no loopholes):
 * - Outer → Reactor: approved snapshot = pinned artifacts + compiled plan/grants/constraints.
 * - Reactor → Outer: telemetry/derived data only (no new authority).
 * - The reactor MUST NOT expand authority beyond the compiled plan in the snapshot.
 *
 * Phase 1: port interface only. No implementation.
 * Import law: ports may import from core only.
 */

import type { ArtifactRef, NodeId, Result, RuntimeBundle } from "../core/types";

export interface ReactorError {
  code: string;
  message: string;
}

/**
 * Approved snapshot produced by the Outer DAG.
 * - bundle.plan is the *only* capability surface the reactor may run under.
 * - bundle packages/artifacts must already be present/pinned (no ambient fetch).
 */
export interface ReactorSnapshot {
  bundle: RuntimeBundle;

  /**
   * Audit garnish only (do NOT use for ordering/trust).
   * Ordering is enforced by snapshotSeq + explicit application rules.
   */
  approvedAt: string; // ISO

  /** Monotonic host-provided sequence number to order snapshot application. */
  snapshotSeq: number;

  note?: string;
}

export interface ReactorStartRequest {
  /** Identifies which plan node’s grants/constraints govern the reactor loop. */
  reactorNodeId: NodeId;

  /** Initial approved snapshot (must be present). */
  initial: ReactorSnapshot;

  /** Optional host config (pure hints; reactor may ignore). */
  config?: {
    /** Target tick rate hint. */
    tickHz?: number;
    /**
     * Maximum events returned per poll call.
     * If exceeded, reactor must fail closed (Err) or report overflow explicitly.
     */
    maxEventsPerPoll?: number;
  };
}

export type ReactorInput =
  | {
      kind: "tick";
      /** Host monotonic tick counter (preferred for determinism). */
      tick: number;
      dtMs: number;
    }
  | {
      kind: "event";
      /** Host monotonic tick counter the event is associated with. */
      tick: number;
      type: string;
      data?: Record<string, unknown>;
    };

export type ReactorEvent =
  | {
      kind: "telemetry";
      seq: number; // monotonic per session
      tick: number;
      level: "debug" | "info" | "warn" | "error";
      code: string;
      message: string;
      nodeId?: NodeId;
      data?: Record<string, unknown>;
    }
  | {
      kind: "derived";
      seq: number; // monotonic per session
      tick: number;
      /**
       * Optional “derived artifact” output.
       * Host should treat this as *data* output only (no new authority).
       * Convention: nodeId should be under `data:` (grammar stays unchanged).
       */
      nodeId: NodeId;
      artifact: ArtifactRef;
      meta?: Record<string, unknown>;
    };

export interface ReactorPollResult {
  /**
   * Must be ordered by seq ascending.
   * Tie-breakers must be explicit in implementation (but interface requires stable order).
   */
  events: ReactorEvent[];

  /** Reactor’s current tick counter (host can sanity-check). */
  tick: number;

  /**
   * If the reactor drops events (should be rare), it must report it explicitly.
   * Fail-closed is acceptable (Err) instead of dropping.
   */
  droppedEvents?: number;
}

export interface ReactorHandle {
  /**
   * Apply a newer approved snapshot.
   * - Must reject older or equal snapshotSeq (fail closed).
   * - Must only apply at safe boundaries (tick/frame boundary).
   */
  applySnapshot(next: ReactorSnapshot): Promise<Result<void, ReactorError>>;

  /**
   * Submit inputs for the reactor to consume.
   * Host can drive the loop deterministically via tick inputs.
   */
  submit(inputs: ReactorInput[]): Promise<Result<void, ReactorError>>;

  /**
   * Poll output events since last poll.
   * Must be deterministic ordering (seq asc) and bounded by maxEventsPerPoll if configured.
   */
  poll(): Promise<Result<ReactorPollResult, ReactorError>>;

  stop(): Promise<Result<void, ReactorError>>;
}

export interface ReactorPort {
  start(req: ReactorStartRequest): Promise<Result<ReactorHandle, ReactorError>>;
}