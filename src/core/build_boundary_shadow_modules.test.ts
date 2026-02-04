/* src/core/build_boundary_shadow_modules.test.ts */
/**
 * Build-boundary guard: shadow modules outside src/ must be stubbed or removed.
 */

declare const require: (id: string) => any;
declare const process: any;
const fs = require("fs");
const path = require("path");

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

const MARKER = "NOT_IN_BUILD_BOUNDARY";

suite("core/build boundary shadow modules", () => {
  register("shadow modules outside src are stubbed or removed", () => {
    const root = process.cwd();
    const candidates = [
      "strict_executor.ts",
      "release_loader.ts",
      "cap_kernel.ts",
      "portal_model_core.ts",
    ];

    for (const rel of candidates) {
      const full = path.join(root, rel);
      if (!fs.existsSync(full)) continue;
      const content = fs.readFileSync(full, "utf8");
      assert(
        content.includes(MARKER),
        `Shadow module must be stubbed with ${MARKER}: ${rel}`
      );
    }
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`build_boundary_shadow_modules.test.ts: ${t.name} failed${detail}`);
    }
  }
}

export {};
