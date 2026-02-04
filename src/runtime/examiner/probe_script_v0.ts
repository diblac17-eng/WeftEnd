// src/runtime/examiner/probe_script_v0.ts
// Deterministic interaction script parser (v0).

export type ProbeActionV0 =
  | { kind: "click"; targetId: string }
  | { kind: "key"; key: string; ctrl: boolean; meta: boolean; shift: boolean }
  | { kind: "wait"; ticks: number };

export interface ProbeScriptLimitsV0 {
  maxBytes: number;
  maxSteps: number;
}

export interface ProbeScriptParseResultV0 {
  actions: ProbeActionV0[];
  issues: string[];
  truncated: boolean;
}

const isNonEmpty = (v: string) => v.trim().length > 0;

const parseKeyChord = (text: string): { key: string; ctrl: boolean; meta: boolean; shift: boolean } | null => {
  const parts = text.split("+").map((p) => p.trim().toLowerCase()).filter(isNonEmpty);
  if (parts.length === 0) return null;
  let ctrl = false;
  let meta = false;
  let shift = false;
  let key = "";
  for (const part of parts) {
    if (part === "ctrl" || part === "control") ctrl = true;
    else if (part === "meta" || part === "cmd" || part === "command") meta = true;
    else if (part === "shift") shift = true;
    else if (!key) key = part;
  }
  if (!key) return null;
  return { key, ctrl, meta, shift };
};

const parseLines = (script: string): string[] =>
  script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"));

export const parseProbeScriptV0 = (
  script: string,
  limits: ProbeScriptLimitsV0
): ProbeScriptParseResultV0 => {
  const issues: string[] = [];
  const actions: ProbeActionV0[] = [];
  if (script.length > limits.maxBytes) {
    issues.push("SCRIPT_TOO_LARGE");
    return { actions, issues, truncated: true };
  }
  const lines = parseLines(script);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("repeat ")) {
      const match = /^repeat\s+(\d+)\s*\{$/i.exec(line);
      if (!match) {
        issues.push("SCRIPT_REPEAT_INVALID");
        i += 1;
        continue;
      }
      const count = Math.max(0, Math.floor(Number(match[1])));
      const block: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== "}") {
        block.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) {
        issues.push("SCRIPT_REPEAT_UNCLOSED");
        break;
      }
      i += 1;
      for (let r = 0; r < count; r += 1) {
        for (const stmt of block) {
          if (actions.length >= limits.maxSteps) {
            return { actions, issues: [...issues, "SCRIPT_STEP_LIMIT"], truncated: true };
          }
          const parsed = parseProbeScriptV0(stmt, { maxBytes: limits.maxBytes, maxSteps: 1 });
          if (parsed.actions.length === 1) actions.push(parsed.actions[0]);
          if (parsed.issues.length > 0) issues.push(...parsed.issues);
        }
      }
      continue;
    }

    if (actions.length >= limits.maxSteps) {
      return { actions, issues: [...issues, "SCRIPT_STEP_LIMIT"], truncated: true };
    }

    if (line.startsWith("click ")) {
      const target = line.slice(6).trim();
      if (!target.startsWith("#") || target.length <= 1) {
        issues.push("SCRIPT_CLICK_INVALID");
        i += 1;
        continue;
      }
      actions.push({ kind: "click", targetId: target.slice(1) });
      i += 1;
      continue;
    }

    if (line.startsWith("key ")) {
      const chord = line.slice(4).trim();
      const parsed = parseKeyChord(chord);
      if (!parsed) {
        issues.push("SCRIPT_KEY_INVALID");
        i += 1;
        continue;
      }
      actions.push({ kind: "key", key: parsed.key, ctrl: parsed.ctrl, meta: parsed.meta, shift: parsed.shift });
      i += 1;
      continue;
    }

    if (line.startsWith("wait ")) {
      const value = line.slice(5).trim();
      if (value !== "0") {
        issues.push("SCRIPT_WAIT_INVALID");
      } else {
        actions.push({ kind: "wait", ticks: 0 });
      }
      i += 1;
      continue;
    }

    issues.push("SCRIPT_LINE_UNKNOWN");
    i += 1;
  }
  return { actions, issues, truncated: false };
};

