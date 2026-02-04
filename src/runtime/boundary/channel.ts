// src/runtime/boundary/channel.ts
// MessageChannel helpers (v0).

declare const require: (id: string) => any;

export type MessagePortLike = {
  postMessage: (msg: unknown, transfer?: unknown[]) => void;
  onmessage?: ((ev: { data: unknown }) => void) | null;
  on?: (event: "message", listener: (data: unknown) => void) => void;
  start?: () => void;
  close?: () => void;
};

type MessageChannelLike = { port1: MessagePortLike; port2: MessagePortLike };

const getMessageChannel = (): MessageChannelLike => {
  const g = globalThis as any;
  if (g.MessageChannel) return new g.MessageChannel();
  const wt = require("worker_threads");
  return new wt.MessageChannel();
};

export const createBoundChannel = (): { hostPort: MessagePortLike; childPort: MessagePortLike } => {
  const ch = getMessageChannel();
  return { hostPort: ch.port1, childPort: ch.port2 };
};

export const attachPortToWorker = (worker: { postMessage: (msg: unknown, transfer?: unknown[]) => void }, childPort: MessagePortLike) => {
  worker.postMessage({ kind: "init_port" }, [childPort as unknown as any]);
};

export const attachPortToIframe = (
  iframe: { contentWindow?: { postMessage: (msg: unknown, targetOrigin: string, transfer?: unknown[]) => void } | null },
  childPort: MessagePortLike
) => {
  if (!iframe.contentWindow) return;
  iframe.contentWindow.postMessage({ kind: "init_port" }, "*", [childPort as unknown as any]);
};
