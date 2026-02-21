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
  "weftend_bind.ps1",
  "weftend_make_shortcut.ps1",
  "report_card_viewer.ps1",
  "launchpad_panel.ps1",
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
    assert(/WeftEndBind/.test(text), "expected bind context menu");
    assert(/WeftEndUnbind/.test(text), "expected unbind context menu");
    assert(/-Action bind/.test(text), "expected bind command action");
    assert(/-Action unbind/.test(text), "expected unbind command action");
    assert(/weftend_bind\.ps1/.test(text), "expected bind script reference");
    assert(/-OpenLibrary/.test(text), "expected -OpenLibrary flag");
    assert(/WeftEnd Launchpad\.lnk/.test(text), "expected launchpad shortcut");
    assert(!/weftend_menu\.ps1/.test(text), "menu script reference must be removed");
    assert(/WeftEnd Download\.lnk/.test(text), "expected download shortcut");
    assert(
      !/Install-LaunchpadShortcut -ShortcutPath \(Join-Path \$startMenu "WeftEnd\.lnk"\)/.test(text),
      "must not install a generic WeftEnd shortcut"
    );
    assert(
      !/Install-LibraryShortcut -ShortcutPath \(Join-Path \$startMenu "WeftEnd Library\.lnk"\)/.test(text),
      "must not install a Library shortcut"
    );
    assert(/launchpad_panel\.ps1/.test(text), "expected launchpad panel script reference");
    assert(/open_release_folder\.ps1/.test(text), "expected open_release_folder script reference");
    assert(/WScript\.Shell/.test(text), "expected shortcut creation via WScript.Shell");
    assert(/\$shortcut\.WindowStyle = 7/.test(text), "expected minimized shortcut window style");
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
    assert(/HKCU:\\Software\\Classes\\lnkfile\\shell\\WeftEndSafeRun\\command/.test(text), "expected lnk command key");
    assert(/HKCU:\\Software\\Classes\\\*\\shell\\WeftEndBind\\command/.test(text), "expected star bind key");
    assert(/HKCU:\\Software\\Classes\\\*\\shell\\WeftEndUnbind\\command/.test(text), "expected star unbind key");
    assert(/HKCU:\\Software\\Classes\\lnkfile\\shell\\WeftEndBind\\command/.test(text), "expected lnk bind key");
    assert(/HKCU:\\Software\\Classes\\lnkfile\\shell\\WeftEndUnbind\\command/.test(text), "expected lnk unbind key");
    assert(/HKCU:\\Software\\Classes\\Directory\\shell\\WeftEndBind\\command/.test(text), "expected directory bind key");
    assert(/HKCU:\\Software\\Classes\\Directory\\shell\\WeftEndUnbind\\command/.test(text), "expected directory unbind key");
    assert(
      /HKCU:\\Software\\Classes\\\*\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected star open-library command key"
    );
    assert(
      /HKCU:\\Software\\Classes\\lnkfile\\shell\\WeftEndSafeRunOpenLibrary\\command/.test(text),
      "expected lnk open-library command key"
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
    assert(/adapterMeta=class:/.test(text), "expected adapter metadata report-card line");
    assert(/capabilities=requested:/.test(text), "expected capability summary report-card line");
    assert(/\.sys/.test(text) && /\.drv/.test(text), "expected sys/drv native guard coverage");
    assert(/ARTIFACT_SHORTCUT_UNSUPPORTED/.test(text), "expected shortcut unsupported reason");
    assert(/Alias\("Target"\)/.test(text), "expected legacy -Target alias compatibility");
    assert(/TARGET_MISSING/.test(text), "expected explicit target-missing reason");
    assert(/WEFTEND_FAILED_BEFORE_RECEIPT/.test(text), "expected actionable pre-receipt reason");
    assert(/report_card\.txt/.test(text), "expected report card artifact");
    assert(/report_card_v0\.json/.test(text), "expected report card json artifact");
    assert(/run_/.test(text), "expected deterministic run id prefix");
    assert(/Library/.test(text), "expected Library output subfolder");
    assert(/Start-ReportCardViewer/.test(text), "expected report viewer launch");
    assert(/Start-Process -FilePath \$explorerPath/.test(text), "expected explorer open for output folder");
    assert(/AllowLaunch/.test(text), "expected AllowLaunch gate");
    assert(/Start-Process -FilePath \$TargetPath/.test(text), "expected launch support");
    assert(!/Invoke-Item/.test(text), "wrapper must not invoke shell open");
    assert(!/&\s*\$Target/.test(text), "wrapper must not execute target path");
    assert(/WITHHELD/.test(text), "expected WITHHELD wrapper result");
    assert(/DENY/.test(text), "expected DENY wrapper result");
    assert(/OpenLibrary/.test(text), "expected OpenLibrary support");
    assert(/LaunchpadMode/.test(text), "expected LaunchpadMode support");

    const blockMatch = text.match(/function Write-ReportCard[\s\S]*?function Read-ReceiptSummary/);
    if (blockMatch && blockMatch[0]) {
      const block = blockMatch[0];
      assert(!/[A-Za-z]:\\/.test(block), "report card block must not include absolute paths");
      assert(!/\\Users\\/.test(block), "report card block must not include user paths");
    }
  });

  register("launchpad assets use quiet run-mode defaults", () => {
    const panelPath = path.join(shellDir, "launchpad_panel.ps1");
    const panelText = fs.readFileSync(panelPath, "utf8");
    assert(/--open-run/.test(panelText), "expected launchpad sync to use --open-run");
    assert(!/--open-library"\)/.test(panelText), "launchpad sync must not force --open-library");
    assert(/\* \(WeftEnd\)\.lnk/.test(panelText), "expected launchpad to list only WeftEnd shortcuts");
    assert(/Invoke-LaunchpadSync -Silent/.test(panelText), "expected launchpad refresh/auto-refresh silent sync");
    assert(/Get-LaunchpadShortcutMetadata/.test(panelText), "expected launchpad shortcut metadata validation");
    assert(/WeftEnd Launchpad Shortcut v1/.test(panelText), "expected launchpad shortcut description trust marker");
    assert(/-LaunchpadMode/.test(panelText), "expected launchpad shortcut args to require LaunchpadMode");
    assert(/-AllowLaunch/.test(panelText), "expected launchpad shortcut args to require AllowLaunch");
    assert(/-Open\\s\+0/.test(panelText), "expected launchpad shortcut args to require Open 0");
    assert(/-OpenLibrary/.test(panelText), "expected launchpad shortcut args to reject OpenLibrary");
    assert(/Read-AdapterTagForRun/.test(panelText), "expected history adapter-tag helper");
    assert(/Read-AdapterEvidenceForRun/.test(panelText), "expected history adapter-evidence helper");
    assert(/Read-RunEvidenceSnapshot/.test(panelText), "expected history evidence snapshot helper");
    assert(/Compute-FileSha256Digest/.test(panelText), "expected history file digest helper");
    assert(/Get-LatestRunIdForTargetDir/.test(panelText), "expected history latest-run fallback helper");
    assert(/Read-ReportCardSummaryForRun/.test(panelText), "expected history report-card fallback helper");
    assert(/Invoke-AdapterDoctorText/.test(panelText), "expected adapter doctor helper");
    assert(/Copy-DoctorOutputText/.test(panelText), "expected doctor output copy helper");
    assert(/Update-HistoryDetailsBox/.test(panelText), "expected history details update helper");
    assert(/SelectedIndexChanged/.test(panelText), "expected history selection details wiring");
    assert(/Open-HistoryRunFolder/.test(panelText), "expected history open-run helper");
    assert(/Open-HistoryAdapterEvidenceFolder/.test(panelText), "expected history evidence-folder helper");
    assert(/Update-HistoryActionButtons/.test(panelText), "expected history action-button state helper");
    assert(/Copy-HistoryDetailsText/.test(panelText), "expected history copy helper");
    assert(/Copy-HistoryDigestText/.test(panelText), "expected history digest copy helper");
    assert(/Open Evidence/.test(panelText), "expected launchpad history Open Evidence action");
    assert(/Copy Details/.test(panelText), "expected launchpad history Copy Details action");
    assert(/Copy Digests/.test(panelText), "expected launchpad history Copy Digests action");
    assert(/Run Adapter Doctor/.test(panelText), "expected launchpad doctor adapter action");
    assert(/Run Adapter Doctor \(Strict\)/.test(panelText), "expected launchpad doctor strict adapter action");
    assert(/Copy Doctor Output/.test(panelText), "expected launchpad doctor copy action");
    assert(/"adapter", "doctor", "--text"/.test(panelText), "expected launchpad adapter doctor text-mode command");
    assert(/\$args \+= "--strict"/.test(panelText), "expected launchpad adapter doctor strict flag wiring");
    assert(/Copy-DoctorOutputText -DoctorBox \$doctorText -StatusLabel \$statusLabel/.test(panelText), "expected doctor copy button/key wiring");
    assert(/Clipboard\]::SetText/.test(panelText), "expected history details clipboard copy action");
    assert(/Control -and \$e\.KeyCode -eq \[System\.Windows\.Forms\.Keys\]::C/.test(panelText), "expected history Ctrl+C copy binding");
    assert(/if \(\$e\.Shift\)\s*\{\s*Copy-HistoryDigestText/.test(panelText), "expected history Ctrl+Shift+C digest copy binding");
    assert(/Columns\.Add\("Adapter"/.test(panelText), "expected launchpad history Adapter column");
    assert(/\+plugin/.test(panelText), "expected launchpad adapter plugin marker");
    assert(/capability_ledger_v0\.json/.test(panelText), "expected launchpad adapter tag capability ledger lookup");
    assert(/Adapter Class:/.test(panelText), "expected adapter detail text in history pane");
    assert(/Safe Receipt Digest:/.test(panelText), "expected safe receipt digest detail in history pane");
    assert(/Operator Receipt Digest:/.test(panelText), "expected operator receipt digest detail in history pane");

    const shortcutPath = path.join(shellDir, "weftend_make_shortcut.ps1");
    const shortcutText = fs.readFileSync(shortcutPath, "utf8");
    assert(/LaunchpadMode/.test(shortcutText), "expected LaunchpadMode flag in shortcut tool");
    assert(/-Open 0/.test(shortcutText), "expected quiet mode for launchpad shortcuts");
    assert(/WindowStyle = 7/.test(shortcutText), "expected minimized shortcut window style");
    assert(/Description = if \(\$LaunchpadMode\.IsPresent\)/.test(shortcutText), "expected launchpad description marker");
    assert(/WeftEnd Launchpad Shortcut v1/.test(shortcutText), "expected launchpad description text");
  });

  register("report viewer includes optional adapter evidence panel", () => {
    const viewerPath = path.join(shellDir, "report_card_viewer.ps1");
    const viewerText = fs.readFileSync(viewerPath, "utf8");
    assert(/Load-AdapterEvidence/.test(viewerText), "expected adapter evidence loader");
    assert(/Show Adapter Evidence/.test(viewerText), "expected adapter evidence toggle label");
    assert(/Hide Adapter Evidence/.test(viewerText), "expected adapter evidence hide label");
    assert(/Compute-FileSha256Digest/.test(viewerText), "expected report viewer digest helper");
    assert(/Build-SummaryClipboardText/.test(viewerText), "expected report viewer summary clipboard builder");
    assert(/Build-DigestClipboardText/.test(viewerText), "expected report viewer digest clipboard builder");
    assert(/Try-CopyClipboardText/.test(viewerText), "expected report viewer clipboard helper");
    assert(/capability_ledger_v0\.json/.test(viewerText), "expected capability ledger artifact support");
    assert(/adapter_summary_v0\.json/.test(viewerText), "expected adapter summary artifact support");
    assert(/adapter_findings_v0\.json/.test(viewerText), "expected adapter findings artifact support");
    assert(/Capabilities: requested=/.test(viewerText), "expected capability summary line");
    assert(/Safe Receipt Digest:/.test(viewerText), "expected safe receipt digest summary line");
    assert(/Operator Receipt Digest:/.test(viewerText), "expected operator receipt digest summary line");
    assert(/Copy Digests/.test(viewerText), "expected report viewer copy digests action");
    assert(/safeReceiptDigest=/.test(viewerText), "expected digest copy payload fields");
    assert(/operatorReceiptDigest=/.test(viewerText), "expected digest copy payload fields");
    assert(/KeyPreview = \$true/.test(viewerText), "expected report viewer key preview enabled");
    assert(/if \(\$e\.Control -and \$e\.KeyCode -eq \[System\.Windows\.Forms\.Keys\]::C\)/.test(viewerText), "expected report viewer Ctrl+C binding");
    assert(/if \(\$e\.Shift\)/.test(viewerText), "expected report viewer digest shortcut branch");
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
