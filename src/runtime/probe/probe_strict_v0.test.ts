/* src/runtime/probe/probe_strict_v0.test.ts */
/**
 * Strict probe should record denials without crashing.
 */

import { canonicalJSON } from "../../core/canon";
import { runStrictProbeV0 } from "../examiner/probe_strict_v0";
import type { ProbeActionV0 } from "../examiner/probe_script_v0";

type TestFn = () => void;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    fail(`${msg}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

const g: any = globalThis as any;
const hasBDD = typeof g.describe === "function" && typeof g.it === "function";
const localTests: Array<{ name: string; fn: TestFn }> = [];

function register(name: string, fn: TestFn): void {
  if (hasBDD) g.it(name, fn);
  else localTests.push({ name, fn });
}

function suite(name: string, define: () => void): void {
  if (hasBDD) g.describe(name, define);
  else define();
}

const sumCaps = (caps: Record<string, number> | undefined): number =>
  Object.values(caps ?? {}).reduce((total, value) => total + (typeof value === "number" ? value : 0), 0);

const sortedKeys = (caps: Record<string, number> | undefined): string[] =>
  Object.keys(caps ?? {}).sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

const htmlWithScript = (scriptBody: string): string =>
  [
    "<!doctype html>",
    "<html>",
    "<body>",
    "<button id=\"go\">Go</button>",
    "<script>",
    scriptBody,
    "</script>",
    "</body>",
    "</html>",
  ].join("");

const clickGo: ProbeActionV0[] = [{ kind: "click", targetId: "go" }];

suite("runtime/probe strict", () => {
  register("DENY fetch records CAP_DENY_NET", () => {
    const html = htmlWithScript([
      "(function () {",
      "  var go = document.getElementById(\"go\");",
      "  if (go) {",
      "    go.addEventListener(\"click\", async function () {",
      "      await fetch(\"https://example.com\");",
      "    });",
      "  }",
      "})();",
    ].join("\n"));
    const result = runStrictProbeV0(html, { interactions: clickGo, maxScriptBytes: 2048 });
    const reasons = result.probe.reasonCodes ?? [];
    assert(result.strictAvailable, "expected strict probe available");
    assert(reasons.includes("CAP_DENY_NET"), "expected CAP_DENY_NET reason");
    assert(sumCaps(result.probe.deniedCaps) >= 1, "expected denied cap count >= 1");
  });

  register("DENY storage records CAP_DENY_STORAGE", () => {
    const html = htmlWithScript([
      "(function () {",
      "  var go = document.getElementById(\"go\");",
      "  if (go) {",
      "    go.addEventListener(\"click\", function () {",
      "      localStorage.setItem(\"k\", \"v\");",
      "    });",
      "  }",
      "})();",
    ].join("\n"));
    const result = runStrictProbeV0(html, { interactions: clickGo, maxScriptBytes: 2048 });
    const reasons = result.probe.reasonCodes ?? [];
    assert(result.strictAvailable, "expected strict probe available");
    assert(reasons.includes("CAP_DENY_STORAGE"), "expected CAP_DENY_STORAGE reason");
    assert(sumCaps(result.probe.deniedCaps) >= 1, "expected denied cap count >= 1");
  });

  register("multiple denials are deterministic and sorted", () => {
    const html = htmlWithScript([
      "(function () {",
      "  var go = document.getElementById(\"go\");",
      "  if (go) {",
      "    go.addEventListener(\"click\", function () {",
      "      try {",
      "        fetch(\"https://example.com\");",
      "      } catch (e) {}",
      "      try {",
      "        new WebSocket(\"wss://socket.example.com\");",
      "      } catch (e) {}",
      "      try {",
      "        localStorage.setItem(\"k\", \"v\");",
      "      } catch (e) {}",
      "    });",
      "  }",
      "})();",
    ].join("\n"));
    const resultA = runStrictProbeV0(html, { interactions: clickGo, maxScriptBytes: 2048 });
    const resultB = runStrictProbeV0(html, { interactions: clickGo, maxScriptBytes: 2048 });
    const deniedKeys = sortedKeys(resultA.probe.deniedCaps);
    const expectedDenied = ["net.fetch", "net.websocket", "storage.write"];
    assertEq(canonicalJSON(deniedKeys), canonicalJSON(expectedDenied), "expected denied caps list");
    assertEq(
      canonicalJSON(resultA.probe.reasonCodes ?? []),
      canonicalJSON(["CAP_DENY_NET", "CAP_DENY_STORAGE"]),
      "expected sorted reason codes"
    );
    assertEq(canonicalJSON(resultA.probe), canonicalJSON(resultB.probe), "expected deterministic probe output");
  });

  register("top-level CAP_DENY is not a SCRIPT_ERROR", () => {
    const html = htmlWithScript([
      "(function () {",
      "  new WebSocket(\"wss://socket.example.com\");",
      "})();",
    ].join("\n"));
    const result = runStrictProbeV0(html, { maxScriptBytes: 2048 });
    const reasons = result.probe.reasonCodes ?? [];
    assert(reasons.includes("CAP_DENY_NET"), "expected CAP_DENY_NET reason");
    assert(!reasons.includes("SCRIPT_ERROR"), "did not expect SCRIPT_ERROR");
  });

  register("top-level throw yields SCRIPT_ERROR", () => {
    const html = htmlWithScript([
      "(function () {",
      "  throw new Error(\"boom\");",
      "})();",
    ].join("\n"));
    const result = runStrictProbeV0(html, { maxScriptBytes: 2048 });
    const reasons = result.probe.reasonCodes ?? [];
    assert(reasons.includes("SCRIPT_ERROR"), "expected SCRIPT_ERROR");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`probe_strict_v0.test.ts: ${t.name} failed${detail}`);
    }
  }
}
