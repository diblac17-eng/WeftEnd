/* src/cli/inspect_compile_smoke.test.ts */
/**
 * Inspect compile smoke: ensure inspectReleaseFolder is exported.
 */

declare const require: (id: string) => any;

type TestFn = () => void;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
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

suite("cli/inspect compile smoke", () => {
  register("inspectReleaseFolder is exported", () => {
    const mod = require("./inspect");
    assert(mod && typeof mod.inspectReleaseFolder === "function", "inspectReleaseFolder missing");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`inspect_compile_smoke.test.ts: ${t.name} failed${detail}`);
    }
  }
}

export {};
