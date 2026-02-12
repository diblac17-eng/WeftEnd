// src/runtime/examiner/probe_strict_v0.ts
// Deterministic deny-all probe for HTML (v0).

declare const require: any;
const vm = require("vm");

import type { MintProbeResultV1 } from "../../core/types";
import type { ProbeActionV0 } from "./probe_script_v0";

export interface ProbeStrictOptionsV0 {
  interactions?: ProbeActionV0[];
  maxScriptBytes: number;
}

export interface ProbeStrictResultV0 {
  strictAvailable: boolean;
  strictUnavailableReason?: string;
  probe: MintProbeResultV1;
}

type ListenerMap = Record<string, Array<(event: any) => void>>;
type HandlerWrapper = (handler: (event: any) => any, event: any) => void;

class FakeElement {
  id: string;
  listeners: ListenerMap = {};
  onclick: ((event: any) => void) | null = null;
  private invoke: HandlerWrapper;
  constructor(id: string, invoke: HandlerWrapper) {
    this.id = id;
    this.invoke = invoke;
  }
  addEventListener(type: string, handler: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }
  dispatchEvent(event: any) {
    const handlers = this.listeners[event.type] ?? [];
    handlers.forEach((fn) => this.invoke(fn, event));
    if (event.type === "click" && typeof this.onclick === "function") {
      this.invoke(this.onclick, event);
    }
  }
}

class FakeDocument {
  private elements: Map<string, FakeElement>;
  listeners: ListenerMap = {};
  body: FakeElement;
  documentElement: FakeElement;
  private invoke: HandlerWrapper;
  constructor(ids: string[], invoke: HandlerWrapper) {
    this.invoke = invoke;
    this.elements = new Map(ids.map((id) => [id, new FakeElement(id, invoke)]));
    this.body = new FakeElement("body", invoke);
    this.documentElement = new FakeElement("documentElement", invoke);
  }
  getElementById(id: string) {
    return this.elements.get(id) ?? null;
  }
  querySelector(sel: string) {
    if (sel.startsWith("#")) return this.getElementById(sel.slice(1));
    return null;
  }
  addEventListener(type: string, handler: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }
  dispatchEvent(event: any) {
    const handlers = this.listeners[event.type] ?? [];
    handlers.forEach((fn) => this.invoke(fn, event));
  }
}

class ProbeRecorder {
  attemptedCaps: Record<string, number> = {};
  deniedCaps: Record<string, number> = {};
  reasonCodes = new Set<string>();
  addCapDeny(capId: string, reason: string) {
    this.attemptedCaps[capId] = (this.attemptedCaps[capId] ?? 0) + 1;
    this.deniedCaps[capId] = (this.deniedCaps[capId] ?? 0) + 1;
    this.reasonCodes.add(reason);
  }
  addReason(code: string) {
    this.reasonCodes.add(code);
  }
}

const extractInlineScripts = (html: string): string[] => {
  const scripts: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(html))) {
    const attrs = match[1] || "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    scripts.push(match[2] || "");
  }
  return scripts;
};

const extractIds = (html: string): string[] => {
  const ids = new Set<string>();
  const re = /\bid\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(html))) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
};

export const runStrictProbeV0 = (html: string | undefined, opts: ProbeStrictOptionsV0): ProbeStrictResultV0 => {
  if (!html || html.trim().length === 0) {
    return {
      strictAvailable: false,
      strictUnavailableReason: "PROBE_NO_HTML",
      probe: {
        status: "WARN",
        reasonCodes: ["PROBE_NO_HTML"],
        deniedCaps: {},
        attemptedCaps: {},
      },
    };
  }

  const recorder = new ProbeRecorder();
  const getCapDenyCode = (err: any): string | null => {
    const msg = typeof err === "string" ? err : err?.message;
    if (typeof msg === "string" && msg.startsWith("CAP_DENY_")) return msg;
    return null;
  };
  const invokeHandler: HandlerWrapper = (handler, event) => {
    try {
      const result = handler(event);
      if (result && typeof result.then === "function") {
        result.catch((err: any) => {
          const code = getCapDenyCode(err);
          if (code) recorder.addReason(code);
          else recorder.addReason("SCRIPT_ERROR");
        });
      }
    } catch (err: any) {
      const code = getCapDenyCode(err);
      if (code) recorder.addReason(code);
      else recorder.addReason("SCRIPT_ERROR");
    }
  };
  const ids = extractIds(html);
  const document = new FakeDocument(ids, invokeHandler);
  const windowListeners: ListenerMap = {};
  const windowAny: any = {
    document,
    addEventListener: (type: string, handler: (event: any) => void) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(handler);
    },
    dispatchEvent: (event: any) => {
      const handlers = windowListeners[event.type] ?? [];
      handlers.forEach((fn) => invokeHandler(fn, event));
    },
  };

  const deny = (capId: string, reason: string) => {
    recorder.addCapDeny(capId, reason);
    throw new Error(reason);
  };

  const fetch = (..._args: any[]) => {
    recorder.addCapDeny("net.fetch", "CAP_DENY_NET");
    return Promise.resolve({
      ok: false,
      status: 0,
      json: async () => null,
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    });
  };

  const FakeXHR = class {
    open() {
      recorder.addCapDeny("net.fetch", "CAP_DENY_NET");
    }
    send() {
      throw new Error("CAP_DENY_NET");
    }
  };

  const FakeWebSocket = function () {
    recorder.addCapDeny("net.websocket", "CAP_DENY_NET");
    throw new Error("CAP_DENY_NET");
  };

  const FakeEventSource = function () {
    recorder.addCapDeny("net.eventsource", "CAP_DENY_NET");
    throw new Error("CAP_DENY_NET");
  };

  const storageStub = {
    getItem: (_k: string) => deny("storage.read", "CAP_DENY_STORAGE"),
    setItem: (_k: string, _v: string) => deny("storage.write", "CAP_DENY_STORAGE"),
    removeItem: (_k: string) => deny("storage.write", "CAP_DENY_STORAGE"),
    clear: () => deny("storage.write", "CAP_DENY_STORAGE"),
  };

  const navigatorStub = {
    sendBeacon: () => {
      recorder.addCapDeny("net.sendBeacon", "CAP_DENY_NET");
      return false;
    },
  };

  Object.defineProperty(document as any, "cookie", {
    get() {
      recorder.addCapDeny("ui.cookie", "CAP_DENY_COOKIE");
      return "";
    },
    set() {
      recorder.addCapDeny("ui.cookie", "CAP_DENY_COOKIE");
    },
  });

  const sandbox: any = {
    window: windowAny,
    document,
    navigator: navigatorStub,
    localStorage: storageStub,
    sessionStorage: storageStub,
    fetch,
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWebSocket,
    EventSource: FakeEventSource,
    indexedDB: {
      open: () => deny("storage.indexeddb", "CAP_DENY_STORAGE"),
    },
    open: () => deny("ui.window.open", "CAP_DENY_UI"),
    console,
    setTimeout: (fn: any) => {
      if (typeof fn === "function") fn();
      return 0;
    },
    clearTimeout: () => undefined,
  };

  const context = vm.createContext(sandbox);
  const scripts = extractInlineScripts(html).filter((s) => s.trim().length > 0);
  for (const script of scripts) {
    if (script.length > opts.maxScriptBytes) {
      recorder.addReason("SCRIPT_TOO_LARGE");
      continue;
    }
    try {
      vm.runInContext(script, context);
    } catch (err: any) {
      const code = getCapDenyCode(err);
      if (code) recorder.addReason(code);
      else recorder.addReason("SCRIPT_ERROR");
    }
  }

  const interactions = opts.interactions ?? [];
  for (const action of interactions) {
    if (action.kind === "wait") continue;
    if (action.kind === "click") {
      const el = document.getElementById(action.targetId);
      if (!el) {
        recorder.addReason("INTERACTION_TARGET_MISSING");
        continue;
      }
      el.dispatchEvent({ type: "click" });
      continue;
    }
    if (action.kind === "key") {
      const event = {
        type: "keydown",
        key: action.key,
        ctrlKey: action.ctrl,
        metaKey: action.meta,
        shiftKey: action.shift,
      };
      windowAny.dispatchEvent(event);
      document.dispatchEvent(event);
    }
  }

  const reasonCodes = Array.from(recorder.reasonCodes).sort((a, b) => a.localeCompare(b));
  const status = reasonCodes.length > 0 ? "WARN" : "OK";
  return {
    strictAvailable: true,
    probe: {
      status,
      reasonCodes,
      deniedCaps: recorder.deniedCaps,
      attemptedCaps: recorder.attemptedCaps,
    },
  };
};
