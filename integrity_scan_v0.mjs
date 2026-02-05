// test/harness/integrity_scan_v0.mjs
// Harness-only Integrity Scan helpers (deterministic, bounded, time-free).

const INTEGRITY_KIND = "weftend.integrity.report.v0";
const MAX_REASON_CODES = 32;
const MAX_ISSUES = 32;
const MAX_PULSES = 256;
const MAX_STR_BYTES = 128;
const MAX_SCRIPT_BYTES = 2048;
const MAX_ACTIONS = 50;
const MAX_REPEAT = 20;
const MAX_NESTING = 4;

const fnv1a32 = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const canonicalJSON = (obj) => {
  const seen = new WeakSet();
  const normalize = (v) => {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (Array.isArray(v)) return v.map(normalize);
    if (t === "object") {
      if (seen.has(v)) throw new Error("CYCLE_IN_CANONICAL_JSON");
      seen.add(v);
      const out = {};
      Object.keys(v)
        .sort()
        .forEach((k) => {
          out[k] = normalize(v[k]);
        });
      return out;
    }
    return null;
  };
  return JSON.stringify(normalize(obj));
};

const utf8ByteLen = (value) => {
  if (value === null || value === undefined) return 0;
  const text = String(value);
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return Buffer.from(text, "utf8").length;
};

const truncateUtf8 = (value, maxBytes) => {
  const text = String(value ?? "");
  if (utf8ByteLen(text) <= maxBytes) return text;
  if (typeof TextEncoder === "undefined" || typeof TextDecoder === "undefined") {
    return Buffer.from(text, "utf8").slice(0, maxBytes).toString("utf8");
  }
  const enc = new TextEncoder().encode(text);
  const sliced = enc.slice(0, maxBytes);
  return new TextDecoder("utf-8", { fatal: false }).decode(sliced);
};

const normalizeHtml = (html) => {
  if (typeof html !== "string") return "";
  return html.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
};

const digestString = (value) => `fnv1a32:${fnv1a32(String(value))}`;

const normalizeStringList = (list, maxItems) => {
  const items = Array.isArray(list) ? list : [];
  const filtered = items
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => truncateUtf8(item.trim(), MAX_STR_BYTES));
  const unique = Array.from(new Set(filtered)).sort();
  const dropped = unique.length > maxItems ? unique.length - maxItems : 0;
  return { list: unique.slice(0, maxItems), dropped };
};

const normalizeScript = (script) => {
  if (typeof script !== "string") return "";
  return script.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
};

const serializeSteps = (steps) => canonicalJSON(steps);

const parseInteractionScript = (script) => {
  const issues = [];
  const normalized = normalizeScript(script);
  if (utf8ByteLen(normalized) > MAX_SCRIPT_BYTES) {
    issues.push("INTERACTION_SCRIPT_TOO_LARGE");
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const cloneStep = (step) => {
    if (!step || typeof step !== "object") return null;
    if (step.kind === "click") return { kind: "click", targetId: step.targetId };
    if (step.kind === "key") {
      return {
        kind: "key",
        key: step.key,
        ctrl: Boolean(step.ctrl),
        shift: Boolean(step.shift),
        alt: Boolean(step.alt),
        meta: Boolean(step.meta),
      };
    }
    if (step.kind === "wait") return { kind: "wait" };
    return null;
  };

  const parseBlock = (startIndex, depth) => {
    const steps = [];
    let i = startIndex;
    while (i < lines.length) {
      const line = lines[i];
      if (line === "}") {
        return { steps, nextIndex: i + 1, closed: true };
      }
      if (line.startsWith("repeat ")) {
        const match = line.match(/^repeat\s+(\d+)\s*\{$/);
        if (!match) {
          issues.push("INTERACTION_SCRIPT_INVALID");
          i += 1;
          continue;
        }
        const count = Number(match[1]);
        if (!Number.isFinite(count) || count < 0 || count > MAX_REPEAT) {
          issues.push("INTERACTION_REPEAT_INVALID");
        }
        if (depth + 1 > MAX_NESTING) {
          issues.push("INTERACTION_REPEAT_NESTING");
        }
        const inner = parseBlock(i + 1, depth + 1);
        if (!inner.closed) {
          issues.push("INTERACTION_REPEAT_UNTERMINATED");
          return { steps, nextIndex: lines.length, closed: false };
        }
        const safeCount = Number.isFinite(count) ? Math.min(Math.max(count, 0), MAX_REPEAT) : 0;
        for (let r = 0; r < safeCount; r += 1) {
          inner.steps.forEach((step) => {
            const cloned = cloneStep(step);
            if (cloned) steps.push(cloned);
          });
        }
        i = inner.nextIndex;
        continue;
      }
      const clickMatch = line.match(/^click\s+#([A-Za-z0-9_-]+)$/);
      if (clickMatch) {
        steps.push({ kind: "click", targetId: clickMatch[1] });
        i += 1;
        continue;
      }
      const keyMatch = line.match(/^key\s+([a-z0-9+_-]+)$/i);
      if (keyMatch) {
        const raw = keyMatch[1].toLowerCase();
        const parts = raw.split("+");
        const key = parts.pop() || "";
        steps.push({
          kind: "key",
          key,
          ctrl: parts.includes("ctrl") || parts.includes("control"),
          shift: parts.includes("shift"),
          alt: parts.includes("alt"),
          meta: parts.includes("meta"),
        });
        i += 1;
        continue;
      }
      const waitMatch = line.match(/^wait\s+(\d+)$/);
      if (waitMatch) {
        const amount = Number(waitMatch[1]);
        if (amount !== 0) issues.push("INTERACTION_WAIT_INVALID");
        steps.push({ kind: "wait" });
        i += 1;
        continue;
      }
      issues.push("INTERACTION_SCRIPT_INVALID");
      i += 1;
    }
    return { steps, nextIndex: i, closed: false };
  };

  const parsed = parseBlock(0, 0);
  if (parsed.closed) {
    issues.push("INTERACTION_SCRIPT_INVALID");
  }

  let dropped = 0;
  let steps = parsed.steps;
  if (steps.length > MAX_ACTIONS) {
    dropped = steps.length - MAX_ACTIONS;
    steps = steps.slice(0, MAX_ACTIONS);
    issues.push("INTERACTION_STEP_LIMIT");
  }

  const issueList = normalizeStringList(issues, MAX_ISSUES).list;
  const scriptDigest = digestString(serializeSteps(steps));
  return {
    steps,
    issues: issueList,
    droppedSteps: dropped,
    scriptDigest,
  };
};

const normalizeCapCounts = (value) => {
  const base = value && typeof value === "object" ? value : {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    capRequest: num(base.capRequest),
    capDeny: num(base.capDeny),
    capAllow: num(base.capAllow),
    inconsistent: num(base.inconsistent),
    attemptedWithoutRequest: num(base.attemptedWithoutRequest),
    allowedWithoutEvidence: num(base.allowedWithoutEvidence),
  };
};

const canonicalizeIntegrityReportV0 = (report) => {
  const base = report && typeof report === "object" ? report : {};
  const input = base.input && typeof base.input === "object" ? base.input : {};
  const policy = base.policy && typeof base.policy === "object" ? base.policy : {};
  const capCounts = normalizeCapCounts(base.capCounts);
  const reasonCodes = normalizeStringList(base.reasonCodes, MAX_REASON_CODES).list;
  const issues = normalizeStringList(base.issues, MAX_ISSUES).list;
  const status = base.status === "OK" || base.status === "WARN" || base.status === "DENY" ? base.status : "OK";
  const allowlist = normalizeStringList(policy.allowlist, 64).list;
  const inputHtmlDigest = typeof input.htmlDigest === "string" ? truncateUtf8(input.htmlDigest, MAX_STR_BYTES) : "";
  const snapshotDigest =
    typeof input.snapshotDigest === "string" ? truncateUtf8(input.snapshotDigest, MAX_STR_BYTES) : "";
  const blockId = typeof input.blockId === "string" ? truncateUtf8(input.blockId, MAX_STR_BYTES) : "";
  const blockDigest =
    typeof input.blockDigest === "string" ? truncateUtf8(input.blockDigest, MAX_STR_BYTES) : "";
  const interactionDigest =
    typeof input.interactionDigest === "string" ? truncateUtf8(input.interactionDigest, MAX_STR_BYTES) : "";
  const digest = typeof base.digest === "string" ? truncateUtf8(base.digest, MAX_STR_BYTES) : "";

  return {
    kind: INTEGRITY_KIND,
    input: {
      htmlDigest: inputHtmlDigest || digestString(""),
      ...(snapshotDigest ? { snapshotDigest } : {}),
      ...(blockId ? { blockId } : {}),
      ...(blockDigest ? { blockDigest } : {}),
      ...(interactionDigest ? { interactionDigest } : {}),
    },
    policy: {
      mode: "deny-all",
      ...(allowlist.length > 0 ? { allowlist } : {}),
    },
    capCounts,
    reasonCodes,
    status,
    issues,
    ...(digest ? { digest } : {}),
  };
};

const digestIntegrityReportV0 = (report) => {
  const base = canonicalizeIntegrityReportV0(report);
  const scrubbed = { ...base };
  delete scrubbed.digest;
  return digestString(canonicalJSON(scrubbed));
};

const buildIntegrityScanSrcdoc = (html, steps = []) => {
  const normalized = normalizeHtml(html);
  const csp =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
    "img-src data: blob:; media-src 'none'; connect-src 'none'; frame-src 'none'; " +
    "base-uri 'none'; object-src 'none';";
  const shim =
    "(function(){\"use strict\";" +
    "const MAX_PULSES=256;const pulses=[];" +
    `const steps=${serializeSteps(Array.isArray(steps) ? steps : [])};` +
    "const emit=(kind,data)=>{if(pulses.length>=MAX_PULSES)return;const entry={kind};" +
    "if(data&&typeof data==='object'){if(data.capId)entry.capId=String(data.capId);" +
    "if(Array.isArray(data.reasonCodes))entry.reasonCodes=data.reasonCodes.slice(0,4);}pulses.push(entry);};" +
    "const deny=(capId,code)=>{emit('CAP_REQUEST',{capId});emit('CAP_DENY',{capId,reasonCodes:[code]});};" +
    "const denySync=(capId,code)=>{deny(capId,code);throw new Error('CAP_DENY');};" +
    "window.fetch=()=>{deny('net.fetch','NET_DISABLED_IN_V0');return Promise.reject(new Error('CAP_DENY'));};" +
    "const xhrOpen=XMLHttpRequest.prototype.open;" +
    "XMLHttpRequest.prototype.open=function(){deny('net.xhr','NET_DISABLED_IN_V0');return xhrOpen.apply(this,arguments);};" +
    "XMLHttpRequest.prototype.send=function(){denySync('net.xhr','NET_DISABLED_IN_V0');};" +
    "window.WebSocket=function(){denySync('net.websocket','NET_DISABLED_IN_V0');};" +
    "window.EventSource=function(){denySync('net.eventsource','NET_DISABLED_IN_V0');};" +
    "if(navigator&&navigator.sendBeacon){navigator.sendBeacon=function(){deny('net.beacon','NET_DISABLED_IN_V0');return false;};}" +
    "Object.defineProperty(window,'localStorage',{get(){denySync('storage.local','STORAGE_DISABLED');}});" +
    "Object.defineProperty(window,'sessionStorage',{get(){denySync('storage.session','STORAGE_DISABLED');}});" +
    "if(window.indexedDB){window.indexedDB.open=function(){denySync('storage.indexeddb','STORAGE_DISABLED');};}" +
    "Object.defineProperty(document,'cookie',{get(){deny('cookie.read','COOKIE_DISABLED');return '';},set(){deny('cookie.write','COOKIE_DISABLED');}});" +
    "window.open=function(){denySync('window.open','WINDOW_OPEN_DISABLED');};" +
    "const issues=[];" +
    "const addIssue=(code)=>{if(issues.length>=32)return;issues.push(code);};" +
    "const runSteps=async()=>{" +
    "for(const step of steps){" +
    "if(!step||typeof step!=='object')continue;" +
    "if(step.kind==='click'){" +
    "const el=document.getElementById(step.targetId||'');" +
    "if(!el){addIssue('INTERACTION_TARGET_MISSING');continue;}" +
    "el.dispatchEvent(new MouseEvent('click',{bubbles:true}));" +
    "} else if(step.kind==='key'){" +
    "const key=step.key||'';" +
    "document.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:!!step.ctrl,shiftKey:!!step.shift,altKey:!!step.alt,metaKey:!!step.meta,bubbles:true}));" +
    "} else if(step.kind==='wait'){" +
    "await Promise.resolve();" +
    "}" +
    "}" +
    "};" +
    "let done=false;const finish=(extra)=>{if(done)return;done=true;" +
    "const outIssues=issues.slice(0,32).concat(extra||[]);" +
    "parent.postMessage({kind:'weftend.integrity.v0',pulses,issues:outIssues},'*');};" +
    "window.addEventListener('error',()=>{emit('SCRIPT_ERROR');});" +
    "window.addEventListener('unhandledrejection',()=>{emit('SCRIPT_ERROR');});" +
    "window.addEventListener('load',()=>{Promise.resolve().then(runSteps).then(()=>finish([])).catch(()=>{addIssue('INTERACTION_SCRIPT_ERROR');finish([]);});});" +
    "})();";

  const injection = `<meta http-equiv="Content-Security-Policy" content="${csp}"><script>${shim}</script>`;

  if (/<head[\\s>]/i.test(normalized)) {
    return normalized.replace(/<head[\\s>][^>]*>/i, (match) => `${match}${injection}`);
  }
  if (/<html[\\s>]/i.test(normalized)) {
    return normalized.replace(/<html[\\s>][^>]*>/i, (match) => `${match}<head>${injection}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${injection}</head><body>${normalized}</body></html>`;
};

const computeCapCounts = (pulses) => {
  const counts = {
    capRequest: 0,
    capDeny: 0,
    capAllow: 0,
    inconsistent: 0,
    attemptedWithoutRequest: 0,
    allowedWithoutEvidence: 0,
  };
  const requested = new Set();
  const allowed = new Set();
  const denied = new Set();

  const list = Array.isArray(pulses) ? pulses : [];
  list.slice(0, MAX_PULSES).forEach((pulse) => {
    if (!pulse || typeof pulse !== "object") return;
    const kind = typeof pulse.kind === "string" ? pulse.kind : "";
    const capId = typeof pulse.capId === "string" ? pulse.capId : "";
    if (kind === "CAP_REQUEST") {
      counts.capRequest += 1;
      if (capId) requested.add(capId);
    } else if (kind === "CAP_DENY") {
      counts.capDeny += 1;
      if (capId) denied.add(capId);
      if (capId && !requested.has(capId)) counts.attemptedWithoutRequest += 1;
    } else if (kind === "CAP_ALLOW") {
      counts.capAllow += 1;
      if (capId) allowed.add(capId);
      if (capId && !requested.has(capId)) counts.attemptedWithoutRequest += 1;
      const codes = Array.isArray(pulse.reasonCodes) ? pulse.reasonCodes : [];
      if (!codes.includes("EVIDENCE_OK")) counts.allowedWithoutEvidence += 1;
    }
  });

  allowed.forEach((capId) => {
    if (denied.has(capId)) counts.inconsistent += 1;
  });
  return counts;
};

const buildIntegrityReportV0 = ({
  html,
  snapshotDigest,
  blockId,
  blockDigest,
  interactionDigest,
  pulses,
  issues,
}) => {
  const htmlDigest = digestString(normalizeHtml(html));
  const capCounts = computeCapCounts(pulses);
  const reasonRaw = [];
  const list = Array.isArray(pulses) ? pulses : [];
  list.slice(0, MAX_PULSES).forEach((pulse) => {
    if (!pulse || typeof pulse !== "object") return;
    const kind = typeof pulse.kind === "string" ? pulse.kind : "";
    if (kind) reasonRaw.push(kind);
    if (Array.isArray(pulse.reasonCodes)) {
      pulse.reasonCodes.forEach((code) => {
        if (typeof code === "string") reasonRaw.push(code);
      });
    }
  });

  const issueList = Array.isArray(issues) ? issues.filter((i) => typeof i === "string") : [];
  const reasonRes = normalizeStringList(reasonRaw, MAX_REASON_CODES);
  const issueRes = normalizeStringList(issueList, MAX_ISSUES);

  let status = "OK";
  if (issueRes.list.length > 0) status = "DENY";
  else if (capCounts.allowedWithoutEvidence > 0) status = "DENY";
  else if (capCounts.capDeny > 0 || reasonRes.list.includes("SCRIPT_ERROR")) status = "WARN";

  const report = canonicalizeIntegrityReportV0({
    kind: INTEGRITY_KIND,
    input: {
      htmlDigest,
      ...(snapshotDigest ? { snapshotDigest } : {}),
      ...(blockId ? { blockId } : {}),
      ...(blockDigest ? { blockDigest } : {}),
      ...(interactionDigest ? { interactionDigest } : {}),
    },
    policy: { mode: "deny-all" },
    capCounts,
    reasonCodes: reasonRes.list,
    status,
    issues: issueRes.list,
  });

  const digest = digestIntegrityReportV0(report);
  return {
    report: canonicalizeIntegrityReportV0({ ...report, digest }),
    dropped: {
      reasonCodes: reasonRes.dropped,
      issues: issueRes.dropped,
      pulses: list.length > MAX_PULSES ? list.length - MAX_PULSES : 0,
    },
  };
};

const wrapBlockHtml = (html) => {
  const normalized = normalizeHtml(html);
  return `<!doctype html><html><head><meta charset=\"utf-8\"><style>body{margin:0;font-family:system-ui,Segoe UI,Arial,sans-serif;}</style></head><body>${normalized}</body></html>`;
};

export {
  INTEGRITY_KIND,
  MAX_REASON_CODES,
  MAX_ISSUES,
  MAX_PULSES,
  MAX_SCRIPT_BYTES,
  MAX_ACTIONS,
  canonicalJSON,
  digestIntegrityReportV0,
  canonicalizeIntegrityReportV0,
  buildIntegrityScanSrcdoc,
  buildIntegrityReportV0,
  parseInteractionScript,
  wrapBlockHtml,
};
