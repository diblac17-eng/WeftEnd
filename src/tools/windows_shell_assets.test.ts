/* src/tools/windows_shell_assets.test.ts */
/**
 * Windows shell assets sanity (deterministic, no hardcoded paths).
 */

declare const require: any;
declare const __dirname: string;

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

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const shellDir = path.join(repoRoot, "tools", "windows", "shell");
const windowsDir = path.join(repoRoot, "tools", "windows");
const scripts = [
  "install_weftend_context_menu.ps1",
  "uninstall_weftend_context_menu.ps1",
  "weftend_safe_run.ps1",
  "weftend_make_shortcut.ps1",
  "launchpad_panel.ps1",
  "weftend_menu.ps1",
  "weftend_shell_doctor.ps1",
  "weftend_shell_doctor.cmd",
  "README_WINDOWS_SHELL.md",
];
const windowsScripts = [
  "open_release_folder.ps1",
  "OPEN_RELEASE_FOLDER.cmd",
  "INSTALL_WINDOWS.cmd",
  "UNINSTALL_WINDOWS.cmd",
];
const rootPortableScripts = [
  "WEFTEND_PORTABLE.cmd",
  "WEFTEND_PORTABLE_MENU.cmd",
];

suite("tools/windows shell assets", () => {
  register("scripts exist and avoid hardcoded paths/secrets", () => {
    scripts.forEach((name) => {
      const full = path.join(shellDir, name);
      assert(fs.existsSync(full), `missing ${name}`);
      const text = fs.readFileSync(full, "utf8");
      assert(!/[A-Za-z]:\\\\/.test(text), `${name} must not contain absolute Windows paths`);
      assert(!/\\\\/.test(text), `${name} must not contain UNC paths`);
      assert(!/C:\\\\Users\\\\/i.test(text), `${name} must not contain user path hints`);
      assert(!/D:\\\\/.test(text), `${name} must not contain drive hints`);
      assert(!/WEFTEND_SIGNING_KEY/.test(text), `${name} must not contain secrets`);
    });
  });

  register("install script references registry + LOCALAPPDATA", () => {
    const installPath = path.join(shellDir, "install_weftend_context_menu.ps1");
    const text = fs.readFileSync(installPath, "utf8");
    assert(/Software\\Classes/.test(text), "expected Classes registry usage");
    assert(/HKCU:\\Software\\WeftEnd\\Shell/.test(text), "expected config registry usage");
    assert(/LOCALAPPDATA/.test(text), "expected LOCALAPPDATA usage");
    assert(/Directory\\Background/.test(text), "expected Directory\\\\Background context menu");
    assert(/SystemFileAssociations\\\.eml/.test(text), "expected .eml context menu");
    assert(/SystemFileAssociations\\\.mbox/.test(text), "expected .mbox context menu");
    assert(/SystemFileAssociations\\\.msg/.test(text), "expected .msg context menu");
    assert(/%V/.test(text), "expected %V target token for folder background");
    assert(/-Target/.test(text), "expected Target command parameter");
    assert(/WeftEndSafeRunOpenLibrary/.test(text), "expected open-library context menu");
    assert(/-OpenLibrary/.test(text), "expected -OpenLibrary flag");
    assert(/WeftEnd Library\.lnk/.test(text), "expected Start Menu shortcut");
    assert(/WeftEnd Launchpad\.lnk/.test(text), "expected launchpad shortcut");
    assert(/WeftEnd\.lnk/.test(text), "expected main menu shortcut");
    assert(/weftend_menu\.ps1/.test(text), "expected menu script reference");
    assert(/WeftEnd Download\.lnk/.test(text), "expected download shortcut");
    assert(/launchpad_panel\.ps1/.test(text), "expected launchpad panel script reference");
    assert(/open_release_folder\.ps1/.test(text), "expected open_release_folder script reference");
    assert(/WScript\.Shell/.test(text), "expected shortcut creation via WScript.Shell");
  });

  register("windows tools scripts exist and avoid hardcoded paths/secrets", () => {
    windowsScripts.forEach((name) => {
      const full = path.join(windowsDir, name);
      assert(fs.existsSync(full), `missing ${name}`);
      const text = fs.readFileSync(full, "utf8");
      assert(!/[A-Za-z]:\\\\/.test(text), `${name} must not contain absolute Windows paths`);
      assert(!/\\\\/.test(text), `${name} must not contain UNC paths`);
      assert(!/C:\\\\Users\\\\/i.test(text), `${name} must not contain user path hints`);
      assert(!/D:\\\\/.test(text), `${name} must not contain drive hints`);
    });
  });

  register("portable launch scripts exist and avoid hardcoded paths/secrets", () => {
    rootPortableScripts.forEach((name) => {
      const full = path.join(repoRoot, name);
      assert(fs.existsSync(full), `missing ${name}`);
      const text = fs.readFileSync(full, "utf8");
      assert(!/[A-Za-z]:\\\\/.test(text), `${name} must not contain absolute Windows paths`);
      assert(!/\\\\/.test(text), `${name} must not contain UNC paths`);
      assert(!/C:\\\\Users\\\\/i.test(text), `${name} must not contain user path hints`);
      assert(!/D:\\\\/.test(text), `${name} must not contain drive hints`);
      assert(/runtime\\node\\node\.exe/i.test(text), `${name} must prefer bundled runtime`);
    });
  });

  register("shell doctor checks expected registry keys", () => {
    const doctorPath = path.join(shellDir, "weftend_shell_doctor.ps1");
    const text = fs.readFileSync(doctorPath, "utf8");
    assert(/HKCU:\\Software\\WeftEnd\\Shell/.test(text), "expected config registry key");
    assert(/HKCU:\\Software\\Classes\\\*\\shell\\WeftEndSafeRun\\command/.test(text), "expected star command key");
    assert(
      /HKCU:\\Software\\Classes\\\*\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected star open-library command key"
    );
    assert(/HKCU:\\Software\\Classes\\Directory\\shell\\WeftEndSafeRun\\command/.test(text), "expected directory command key");
    assert(
      /HKCU:\\Software\\Classes\\Directory\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected directory open-library command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\Directory\\Background\\shell\\WeftEndSafeRun\\command/.test(text),
      "expected background command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\Directory\\Background\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected background open-library command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\SystemFileAssociations\\\.zip\\shell\\WeftEndSafeRun\\command/.test(text),
      "expected zip command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\SystemFileAssociations\\\.eml\\shell\\WeftEndSafeRun\\command/.test(text),
      "expected eml command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\SystemFileAssociations\\\.mbox\\shell\\WeftEndSafeRun\\command/.test(text),
      "expected mbox command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\SystemFileAssociations\\\.msg\\shell\\WeftEndSafeRun\\command/.test(text),
      "expected msg command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\SystemFileAssociations\\\.zip\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected zip open-library command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\SystemFileAssociations\\\.eml\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected eml open-library command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\SystemFileAssociations\\\.mbox\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected mbox open-library command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\SystemFileAssociations\\\.msg\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected msg open-library command key"
    );
    assert(/RepoRoot/.test(text), "expected RepoRoot check");
    assert(/OutRoot/.test(text), "expected OutRoot check");
    assert(/%1/.test(text), "expected %1 token check");
    assert(/%V/.test(text), "expected %V token check");
  });

  register("wrapper emits deterministic result fields", () => {
    const wrapperPath = path.join(shellDir, "weftend_safe_run.ps1");
    const text = fs.readFileSync(wrapperPath, "utf8");
    assert(/result=\$Result/.test(text), "expected wrapper result field");
    assert(/exitCode=\$ExitCode/.test(text), "expected wrapper exitCode field");
    assert(/reason=\$Reason/.test(text), "expected wrapper reason field");
    assert(/topReasonCode/.test(text), "expected topReasonCode extraction");
    assert(/analysisVerdict/.test(text), "expected analysisVerdict extraction");
    assert(/Extract-ReasonCodeFromOutput/.test(text), "expected output reason extraction helper");
    assert(/Is-OpaqueNativeArtifact/.test(text), "expected native-artifact hard guard helper");
    assert(/Is-EmailArtifact/.test(text), "expected email-artifact routing helper");
    assert(/input=inputType:/.test(text), "expected input/adapter report-card line");
    assert(/\.sys/.test(text) && /\.drv/.test(text), "expected sys/drv native guard coverage");
    assert(/ARTIFACT_SHORTCUT_UNSUPPORTED/.test(text), "expected shortcut unsupported reason");
    assert(/Alias\("Target"\)/.test(text), "expected legacy -Target alias compatibility");
    assert(/TARGET_MISSING/.test(text), "expected explicit target-missing reason");
    assert(/WEFTEND_FAILED_BEFORE_RECEIPT/.test(text), "expected actionable pre-receipt reason");
    assert(/report_card\.txt/.test(text), "expected report card artifact");
    assert(/run_/.test(text), "expected deterministic run id prefix");
    assert(/Library/.test(text), "expected Library output subfolder");
    assert(/Start-Process -FilePath \$notepadPath/.test(text), "expected report-card notepad open");
    assert(/Start-Process -FilePath \$explorerPath/.test(text), "expected explorer open for output folder");
    assert(/AllowLaunch/.test(text), "expected AllowLaunch gate");
    assert(/Start-Process -FilePath \$TargetPath/.test(text), "expected launch support");
    assert(!/Invoke-Item/.test(text), "wrapper must not invoke shell open");
    assert(!/&\s*\$Target/.test(text), "wrapper must not execute target path");
    assert(/WITHHELD/.test(text), "expected WITHHELD wrapper result");
    assert(/DENY/.test(text), "expected DENY wrapper result");
    assert(/OpenLibrary/.test(text), "expected OpenLibrary support");

    const blockMatch = text.match(/function Write-ReportCard[\s\S]*?function Read-ReceiptSummary/);
    if (blockMatch && blockMatch[0]) {
      const block = blockMatch[0];
      assert(!/[A-Za-z]:\\/.test(block), "report card block must not include absolute paths");
      assert(!/\\Users\\/.test(block), "report card block must not include user paths");
    }
  });
});

if (!hasBDD) {
  (async () => {
    for (const t of localTests) {
      try {
        await t.fn();
      } catch (e: any) {
        const detail = e?.message ? `\n${e.message}` : "";
        throw new Error(`windows_shell_assets.test.ts: ${t.name} failed${detail}`);
      }
    }
  })().catch((e) => {
    setTimeout(() => {
      throw e;
    }, 0);
  });
}
