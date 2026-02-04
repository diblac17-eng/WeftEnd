/* src/core/build_boundary.test.ts */
/**
 * Build boundary guard: only src/** is compiled by tsconfig.
 */

declare const require: any;
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

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf8"));

suite("core/build boundary", () => {
  register("tsconfig includes only src/**", () => {
    const configPath = path.join(process.cwd(), "tsconfig.json");
    const tsconfig = readJson(configPath);
    const include = Array.isArray(tsconfig.include) ? tsconfig.include : [];
    assert(include.length > 0, "tsconfig.include must be non-empty");
    include.forEach((entry: string) => {
      assert(typeof entry === "string", "tsconfig.include entries must be strings");
      assert(entry.startsWith("src/"), "tsconfig.include must not reference non-src paths");
    });
    assert(include.includes("src/**/*.ts"), "tsconfig.include must contain src/**/*.ts");
  });

  register("tsconfig excludes dist and node_modules", () => {
    const configPath = path.join(process.cwd(), "tsconfig.json");
    const tsconfig = readJson(configPath);
    const exclude = Array.isArray(tsconfig.exclude) ? tsconfig.exclude : [];
    assert(exclude.includes("dist"), "tsconfig.exclude must include dist");
    assert(exclude.includes("node_modules"), "tsconfig.exclude must include node_modules");
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `\n${e.message}` : "";
      throw new Error(`build_boundary.test.ts: ${t.name} failed${detail}`);
    }
  }
}

export {};
