// src/runtime/strict/sandbox_bootstrap.ts
// Dedicated Worker bootstrap for Strict sandbox (v0).

import type {
  SandboxInit,
  SandboxInvoke,
  SandboxMessage,
  SandboxResult,
  SandboxSelfTest,
  SandboxSelfTestResult,
  StrictMode,
  MessagePortLike,
} from "./types";

declare const require: (id: string) => any;
declare const process: any;

type CompartmentCtor = new (endowments?: Record<string, unknown>) => {
  evaluate: (source: string) => unknown;
};

try {
  if (typeof require === "function") {
    require("ses");
  }
} catch {
  // ignore
}

const forbiddenGlobals = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
];

const getCompartmentCtor = (): CompartmentCtor | null => {
  const g: any = globalThis as any;
  if (typeof g.Compartment === "function") return g.Compartment as CompartmentCtor;

  try {
    if (typeof require === "function") {
      require("ses");
    }
  } catch {
    // ignore
  }

  if (typeof g.Compartment === "function") return g.Compartment as CompartmentCtor;

  try {
    if (typeof g.importScripts === "function") {
      g.importScripts("/node_modules/ses/dist/ses.umd.min.js");
    }
  } catch {
    // ignore
  }

  if (typeof g.Compartment === "function") return g.Compartment as CompartmentCtor;

  return null;
};

const getNodeParentPort = () => {
  try {
    const wt = require("worker_threads");
    return wt?.parentPort ?? null;
  } catch {
    return null;
  }
};

const parentPort = getNodeParentPort();

const addInitListener = (handler: (data: SandboxMessage) => void) => {
  if (parentPort && typeof parentPort.on === "function") {
    parentPort.on("message", (data: unknown) => handler(data as SandboxMessage));
  } else if (typeof (globalThis as any).addEventListener === "function") {
    (globalThis as any).addEventListener("message", (evt: { data: unknown }) => handler(evt.data as SandboxMessage));
  } else if ("onmessage" in globalThis) {
    (globalThis as any).onmessage = (evt: { data: unknown }) => handler(evt.data as SandboxMessage);
  }
};

const addPortListener = (port: MessagePortLike, handler: (data: SandboxMessage) => void) => {
  if (typeof port.on === "function") {
    port.on("message", (data: unknown) => handler(data as SandboxMessage));
  } else if (typeof port.onmessage !== "undefined") {
    port.onmessage = (evt: { data: unknown }) => handler(evt.data as SandboxMessage);
  }
  if (typeof port.start === "function") port.start();
};

const pending = new Map<string, (msg: SandboxResult) => void>();
let reqCounter = 0;
let planDigest = "";
let callerBlockHash = "";
let sessionNonce = "";
let executionMode: StrictMode = "strict";
let initialized = false;
let sandboxPort: MessagePortLike | null = null;
let stagedSource: string | undefined;
let stagedEntry: string | undefined;
let stagedArgs: unknown;
let ranEntry = false;
let untrustedPostMessageUsed = false;
let testKeepGlobal: string | undefined;
let compartment: { evaluate: (source: string) => unknown } | null = null;
let exportsObj: Record<string, unknown> | null = null;

const sortReasonCodes = (codes: string[]): string[] => Array.from(new Set(codes)).sort();

const safeGlobal = (key: string): unknown => {
  try {
    return (globalThis as any)[key];
  } catch {
    return undefined;
  }
};

const buildEndowments = (): Record<string, unknown> => {
  const endowments: Record<string, unknown> = { caps, exports: exportsObj ?? {} };
  endowments.postMessage = () => {
    untrustedPostMessageUsed = true;
    throw new Error("UNTRUSTED_CHANNEL");
  };
  const textEncoder = safeGlobal("TextEncoder");
  if (typeof textEncoder === "function") endowments.TextEncoder = textEncoder;
  const textDecoder = safeGlobal("TextDecoder");
  if (typeof textDecoder === "function") endowments.TextDecoder = textDecoder;
  const urlCtor = safeGlobal("URL");
  if (typeof urlCtor === "function") endowments.URL = urlCtor;
  if (testKeepGlobal) endowments[testKeepGlobal] = () => "test-only";
  return endowments;
};

const ensureCompartment = (): { ok: boolean; reasonCodes?: string[] } => {
  if (compartment && exportsObj) return { ok: true };
  const Ctor = getCompartmentCtor();
  if (!Ctor) return { ok: false, reasonCodes: ["STRICT_COMPARTMENT_UNAVAILABLE"] };
  exportsObj = {};
  compartment = new Ctor(buildEndowments());
  return { ok: true };
};

const sealPostMessage = () => {
  try {
    (globalThis as any).postMessage = () => {
      untrustedPostMessageUsed = true;
      throw new Error("UNTRUSTED_CHANNEL");
    };
  } catch {
    // ignore
  }
};

const postToHost = (msg: SandboxMessage | SandboxResult | SandboxSelfTestResult) => {
  if (sandboxPort && typeof sandboxPort.postMessage === "function") {
    sandboxPort.postMessage(msg);
  }
};

const asEnvelope = <T extends { kind: string }>(msg: T): T & { executionMode: StrictMode; planDigest: string; sessionNonce: string } => ({
  ...msg,
  executionMode,
  planDigest,
  sessionNonce,
});

const invokeCap = (capId: string, args: unknown): Promise<{ ok: boolean; value?: unknown; reasonCodes?: string[] }> => {
  const reqId = `cap-${reqCounter++}`;
  const msg: SandboxInvoke = asEnvelope({ kind: "invoke", reqId, capId, args, callerBlockHash });
  postToHost(msg);
  return new Promise((resolve) => {
    pending.set(reqId, (res: SandboxResult) => {
      if (res.ok) resolve({ ok: true, value: res.value });
      else resolve({ ok: false, reasonCodes: res.reasonCodes });
    });
  });
};

const caps = Object.freeze({
  net: Object.freeze({
    fetch: (args: unknown) => invokeCap("net.fetch", args),
  }),
  storage: Object.freeze({
    read: (args: unknown) => invokeCap("storage.read", args),
    write: (args: unknown) => invokeCap("storage.write", args),
  }),
});

const runEntry = async (exportsObj: Record<string, unknown>, entryExportName?: string, entryArgs?: unknown) => {
  if (!entryExportName) return;
  const entry = exportsObj[entryExportName];
  if (typeof entry !== "function") {
    postToHost(asEnvelope({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["SANDBOX_ENTRY_MISSING"] }));
    return;
  }
  try {
    const value = await (entry as any)(entryArgs);
    postToHost(asEnvelope({ kind: "result", reqId: "entry", ok: true, value }));
  } catch {
    const reasons = untrustedPostMessageUsed ? ["UNTRUSTED_CHANNEL"] : ["SANDBOX_EXECUTION_ERROR"];
    postToHost(asEnvelope({ kind: "result", reqId: "entry", ok: false, reasonCodes: reasons }));
  }
};

const handlePortMessage = async (msg: SandboxMessage) => {
  if (!isEnvelope(msg)) return;
  if (msg.executionMode !== "strict") return;
  if (msg.planDigest !== planDigest || msg.sessionNonce !== sessionNonce) return;

  if (msg.kind === "result" && pending.has(msg.reqId)) {
    const resolver = pending.get(msg.reqId)!;
    pending.delete(msg.reqId);
    resolver(msg as SandboxResult);
    return;
  }

  if (msg.kind === "selftest") {
    const result = runSelfTest(msg);
    postToHost(result);
    if (result.ok && stagedSource && !ranEntry) {
      ranEntry = true;
      await evaluateAndRun(stagedSource, stagedEntry, stagedArgs);
    }
    return;
  }
};

const runSelfTest = (msg: SandboxSelfTest): SandboxSelfTestResult => {
  const init = ensureCompartment();
  if (!init.ok) {
    return {
      kind: "selftest.result",
      reqId: msg.reqId,
      ok: false,
      details: { forbiddenPresent: [] },
      reasonCodes: init.reasonCodes ?? ["STRICT_COMPARTMENT_UNAVAILABLE"],
      executionMode,
      planDigest,
      sessionNonce,
    };
  }

  const details = (compartment as any).evaluate(
    "({\n" +
      "  fetch: typeof fetch,\n" +
      "  XMLHttpRequest: typeof XMLHttpRequest,\n" +
      "  WebSocket: typeof WebSocket,\n" +
      "  EventSource: typeof EventSource,\n" +
      "  importScripts: typeof importScripts,\n" +
      "  localStorage: typeof localStorage,\n" +
      "  sessionStorage: typeof sessionStorage,\n" +
      "  indexedDB: typeof indexedDB,\n" +
      "  caches: typeof caches\n" +
      "})"
  ) as Record<string, string>;

  const present = forbiddenGlobals.filter((name) => details[name] !== "undefined");
  const ok = present.length === 0;
  const reasonCodes = ok ? undefined : sortReasonCodes(present.map((n) => `SANDBOX_HARDENING_FAILED:${n}`));
  return {
    kind: "selftest.result",
    reqId: msg.reqId,
    ok,
    details: { forbiddenPresent: present },
    reasonCodes,
    executionMode,
    planDigest,
    sessionNonce,
  };
};

const evaluateAndRun = async (sourceText: string, entryExportName?: string, entryArgs?: unknown) => {
  if (!compartment || !exportsObj) {
    postToHost(
      asEnvelope({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["STRICT_COMPARTMENT_UNAVAILABLE"] })
    );
    return;
  }
  try {
    compartment.evaluate(sourceText);
  } catch {
    postToHost(asEnvelope({ kind: "result", reqId: "entry", ok: false, reasonCodes: ["SANDBOX_EVAL_ERROR"] }));
    return;
  }
  await runEntry(exportsObj, entryExportName, entryArgs);
};

addInitListener((msg: SandboxMessage) => {
  if (msg.kind !== "init" || initialized) return;
  initialized = true;

  const init = msg as SandboxInit;
  executionMode = init.executionMode;
  planDigest = init.planDigest;
  sessionNonce = init.sessionNonce;
  callerBlockHash = init.callerBlockHash;
  stagedSource = isString(init.sourceText) ? init.sourceText : undefined;
  stagedEntry = init.entryExportName;
  stagedArgs = init.entryArgs;
  testKeepGlobal = init.testKeepGlobal;

  sandboxPort = init.port ?? null;
  if (!sandboxPort) return;

  addPortListener(sandboxPort, handlePortMessage);

  sealPostMessage();
  try {
    Object.freeze(globalThis);
  } catch {
    // ignore
  }

  postToHost(asEnvelope({ kind: "result", reqId: "init", ok: true, value: { ok: true } }));
});

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isEnvelope(msg: SandboxMessage): msg is SandboxMessage {
  return (
    typeof (msg as any).executionMode === "string" &&
    typeof (msg as any).planDigest === "string" &&
    typeof (msg as any).sessionNonce === "string"
  );
}
