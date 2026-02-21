/* src/tools/greenteam/container_local_only_contract.test.ts */
/**
 * Green Team: container scan local-only Docker command contract.
 */

export {};

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

type TestFn = () => void | Promise<void>;

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

const readProbe = (): string => {
  const relPath = "src/runtime/container/docker_probe_v0.ts";
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing source file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
  return String(fs.readFileSync(full, "utf8"));
};

suite("greenteam/container-local-only-contract", () => {
  register("docker probe keeps local-only read-only command surface", () => {
    const text = readProbe();

    assert(
      text.includes('runDocker(["version", "--format", "{{json .Client}}"])'),
      "docker probe must check docker client availability via version"
    );
    assert(
      text.includes('runDocker(["image", "inspect", normalizedInputRef])'),
      "docker probe must inspect local image metadata"
    );

    const forbidden = [
      /\brunDocker\(\[\s*"pull"/,
      /\brunDocker\(\[\s*"login"/,
      /\brunDocker\(\[\s*"run"/,
      /\brunDocker\(\[\s*"build"/,
      /\brunDocker\(\[\s*"push"/,
      /\brunDocker\(\[\s*"create"/,
      /\brunDocker\(\[\s*"start"/,
      /\brunDocker\(\[\s*"exec"/,
    ];
    forbidden.forEach((re) => {
      assert(!re.test(text), `forbidden docker command surface detected: ${String(re)}`);
    });
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`container_local_only_contract.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
