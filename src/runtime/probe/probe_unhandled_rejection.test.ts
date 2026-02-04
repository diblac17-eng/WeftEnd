/* src/runtime/probe/probe_unhandled_rejection.test.ts */
/**
 * Ensure denials do not surface as unhandled promise rejections.
 */

import { runStrictProbeV0 } from "../examiner/probe_strict_v0";
import type { ProbeActionV0 } from "../examiner/probe_script_v0";

declare const process: any;

type TestFn = () => void | Promise<void>;

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

suite("runtime/probe unhandled rejection", () => {
  register("async denials do not emit unhandledRejection", async () => {
    const html = htmlWithScript([
      "(function () {",
      "  var go = document.getElementById(\"go\");",
      "  if (go) {",
      "    go.addEventListener(\"click\", async function () {",
      "      fetch(\"https://example.com\");",
      "      localStorage.setItem(\"k\", \"v\");",
      "    });",
      "  }",
      "})();",
    ].join("\n"));

    assert(typeof process?.on === "function", "process.on unavailable");

    let unhandledCount = 0;
    const handler = () => {
      unhandledCount += 1;
    };
    process.on("unhandledRejection", handler);

    let result: ReturnType<typeof runStrictProbeV0> | null = null;
    let threw = false;
    try {
      result = await Promise.resolve().then(() =>
        runStrictProbeV0(html, { interactions: clickGo, maxScriptBytes: 2048 })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    } catch {
      threw = true;
    } finally {
      if (typeof process?.off === "function") process.off("unhandledRejection", handler);
      else if (typeof process?.removeListener === "function") process.removeListener("unhandledRejection", handler);
    }

    assert(!threw, "probe run should not throw or reject");
    assertEq(unhandledCount, 0, "expected no unhandledRejection events");
    assert(result, "expected probe result");

    const reasons = result?.probe.reasonCodes ?? [];
    assert(reasons.includes("CAP_DENY_NET"), "expected CAP_DENY_NET reason");
    assert(reasons.includes("CAP_DENY_STORAGE"), "expected CAP_DENY_STORAGE reason");
    assert(sumCaps(result?.probe.deniedCaps) >= 1, "expected denied caps recorded");
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`probe_unhandled_rejection.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
