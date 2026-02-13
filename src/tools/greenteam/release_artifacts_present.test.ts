/* src/tools/greenteam/release_artifacts_present.test.ts */
/**
 * Green Team: required docs and shell tools present.
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

const expectFile = (relPath: string) => {
  const full = path.join(process.cwd(), relPath);
  assert(fs.existsSync(full), `missing required file: ${relPath}`);
  assert(fs.statSync(full).isFile(), `expected file: ${relPath}`);
};

suite("greenteam/release-artifacts", () => {
  register("docs and shell tools are present", () => {
    [
      "docs/INSTALL.md",
      "docs/QUICKSTART.txt",
      "docs/WHY_RECEIPTS.md",
      "docs/TROUBLESHOOTING.md",
      "docs/REPORT_LIBRARY.md",
    ].forEach(expectFile);

    [
      "tools/windows/shell/install_weftend_context_menu.ps1",
      "tools/windows/shell/uninstall_weftend_context_menu.ps1",
      "tools/windows/shell/weftend_safe_run.ps1",
      "tools/windows/shell/weftend_bind.ps1",
      "tools/windows/shell/report_card_viewer.ps1",
      "tools/windows/shell/weftend_shell_doctor.ps1",
      "WEFTEND_PORTABLE.cmd",
      "WEFTEND_PORTABLE_MENU.cmd",
    ].forEach(expectFile);
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`release_artifacts_present.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
