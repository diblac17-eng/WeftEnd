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
    assert(/`"\$psMenuHostExe`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File/.test(text), "expected context menu command to use resolved powershell host path");
    assert(!/\$command = "powershell\.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File/.test(text), "context menu command must avoid bare powershell command-name invocation");
    assert(/\$iconHostExe -NoProfile -ExecutionPolicy Bypass -File \$iconScript/.test(text), "expected install script icon generation to use resolved powershell executable path");
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

  register("windows cli commands resolve powershell host path before spawn", () => {
    const launchpadCli = fs.readFileSync(path.join(repoRoot, "src", "cli", "launchpad.ts"), "utf8");
    assert(/const resolvePowerShellExe = \(\): string =>/.test(launchpadCli), "launchpad cli missing powershell host resolver helper");
    assert(/spawnSync\(resolvePowerShellExe\(\), args/.test(launchpadCli), "launchpad cli must use resolved powershell host path");
    assert(!/spawnSync\("powershell\.exe"/.test(launchpadCli), "launchpad cli must avoid command-name powershell spawn");

    const shortcutCli = fs.readFileSync(path.join(repoRoot, "src", "cli", "shortcut.ts"), "utf8");
    assert(/const resolvePowerShellExe = \(\): string =>/.test(shortcutCli), "shortcut cli missing powershell host resolver helper");
    assert(/spawnSync\(resolvePowerShellExe\(\), args/.test(shortcutCli), "shortcut cli must use resolved powershell host path");
    assert(!/spawnSync\("powershell\.exe"/.test(shortcutCli), "shortcut cli must avoid command-name powershell spawn");

    const watchCli = fs.readFileSync(path.join(repoRoot, "src", "cli", "watch.ts"), "utf8");
    assert(/const resolvePowerShellExe = \(\): string =>/.test(watchCli), "watch cli missing powershell host resolver helper");
    assert(/spawnSync\(resolvePowerShellExe\(\), \["-NoProfile", "-Command", script\]/.test(watchCli), "watch cli must use resolved powershell host path for popup flow");
    assert(!/spawnSync\("powershell\.exe", \["-NoProfile", "-Command", script\]/.test(watchCli), "watch cli must avoid command-name powershell spawn");
  });

  register("windows tools scripts resolve powershell host path in wrappers", () => {
    const openFolderPs1 = fs.readFileSync(path.join(windowsDir, "open_release_folder.ps1"), "utf8");
    assert(/\$powershellExe = Join-Path \$env:WINDIR/.test(openFolderPs1), "expected open_release_folder script powershell path resolution");
    assert(/& \$powershellExe -NoProfile -ExecutionPolicy Bypass -File \$zipScript -OutDir \$outDir/.test(openFolderPs1), "expected open_release_folder script to invoke resolved powershell path");
    assert(!/& powershell -NoProfile -ExecutionPolicy Bypass -File/.test(openFolderPs1), "open_release_folder script must avoid command-name powershell invocation");

    const zipWrapperPs1 = fs.readFileSync(path.join(windowsDir, "weftend_release_zip.ps1"), "utf8");
    assert(/Set-StrictMode -Version Latest/.test(zipWrapperPs1), "expected tools/windows release zip wrapper strict mode enforcement");
    assert(/\$powershellExe = Join-Path \$env:WINDIR/.test(zipWrapperPs1), "expected tools/windows release zip wrapper powershell path resolution");
    assert(/& \$powershellExe -ExecutionPolicy Bypass -File \$zipScript -OutDir \$OutDir/.test(zipWrapperPs1), "expected tools/windows release zip wrapper to invoke resolved powershell path");
    assert(!/& powershell -ExecutionPolicy Bypass -File/.test(zipWrapperPs1), "tools/windows release zip wrapper must avoid command-name powershell invocation");
  });

  register("windows cmd wrappers resolve powershell host path", () => {
    const cmdWrappers = ["OPEN_RELEASE_FOLDER.cmd", "INSTALL_WINDOWS.cmd", "UNINSTALL_WINDOWS.cmd", "FIRST_5_MINUTES.cmd"];
    cmdWrappers.forEach((name) => {
      const text = fs.readFileSync(path.join(windowsDir, name), "utf8");
      assert(/set "PS_EXE=%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/i.test(text), `${name} must resolve system powershell path first`);
      assert(/if not exist "%PS_EXE%" set "PS_EXE=powershell\.exe"/i.test(text), `${name} must include resolved powershell fallback`);
      assert(/"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File/i.test(text), `${name} must invoke resolved powershell executable`);
    });
  });

  register("install wrapper repairs shortcuts before strict shell doctor", () => {
    const installCmd = fs.readFileSync(path.join(windowsDir, "INSTALL_WINDOWS.cmd"), "utf8");
    assert(/weftend_shell_doctor\.ps1" -RepairShortcuts/i.test(installCmd), "INSTALL_WINDOWS.cmd must run shell doctor shortcut repair");
    const repairIdx = installCmd.search(/weftend_shell_doctor\.ps1"\s+-RepairShortcuts/i);
    const strictIdx = installCmd.search(/weftend_shell_doctor\.ps1"\s*[\r\n]/i);
    assert(repairIdx >= 0 && strictIdx > repairIdx, "INSTALL_WINDOWS.cmd must run shortcut repair before strict shell doctor check");
  });

  register("release ops script uses deterministic candidate sorting", () => {
    const releaseOpsPath = path.join(repoRoot, "scripts", "weftend_release_ops.ps1");
    const text = fs.readFileSync(releaseOpsPath, "utf8");
    assert(/Set-StrictMode -Version Latest/.test(text), "expected release ops strict mode enforcement");
    assert(/function Get-StableSortKey/.test(text), "expected release ops stable sort-key helper");
    assert(/Sort-Object @{ Expression = \{ Get-StableSortKey -value \$_.FullName \} }/.test(text), "expected release ops deterministic publish.json sort");
    assert(!/Sort-Object FullName/.test(text), "release ops must avoid locale-sensitive Sort-Object FullName");
  });

  register("release zip wrapper uses resolved powershell executable", () => {
    const wrapperPath = path.join(repoRoot, "scripts", "weftend_release_zip.ps1");
    const text = fs.readFileSync(wrapperPath, "utf8");
    assert(/Set-StrictMode -Version Latest/.test(text), "expected release zip wrapper strict mode enforcement");
    assert(/\$repoRoot = \(Resolve-Path \(Join-Path \$scriptDir \"\.\.\"\)\)\.Path/.test(text), "expected release zip wrapper to normalize reporoot to resolved path string");
    assert(/\$powershellExe = Join-Path \$env:WINDIR/.test(text), "expected release zip wrapper powershell path resolution");
    assert(/& \$powershellExe -ExecutionPolicy Bypass -File \$zipScript -OutDir \$OutDir/.test(text), "expected release zip wrapper to invoke resolved powershell executable path");
    assert(!/& powershell -ExecutionPolicy Bypass -File/.test(text), "release zip wrapper must avoid command-name powershell invocation");
  });

  register("shell doctor checks expected registry keys", () => {
    const doctorPath = path.join(shellDir, "weftend_shell_doctor.ps1");
    const text = fs.readFileSync(doctorPath, "utf8");
    assert(/RepairReportViewer/.test(text), "expected report-viewer repair switch in shell doctor");
    assert(/RepairShortcuts/.test(text), "expected shortcut-repair switch in shell doctor");
    assert(/RepairShortcuts: OK/.test(text), "expected shell doctor shortcut repair success status");
    assert(/SHELL_DOCTOR_REPAIR_SHORTCUTS_FAILED/.test(text), "expected deterministic shell doctor shortcut-repair failure code");
    assert(/STARTMENU_LAUNCHPAD_SHORTCUT/.test(text), "expected start-menu launchpad shortcut check");
    assert(/STARTMENU_DOWNLOAD_SHORTCUT/.test(text), "expected start-menu download shortcut check");
    assert(/DESKTOP_LAUNCHPAD_SHORTCUT/.test(text), "expected desktop launchpad shortcut check");
    assert(/DESKTOP_DOWNLOAD_SHORTCUT/.test(text), "expected desktop download shortcut check");
    assert(/if \(-not \(Test-Path -Path \$configKey\)\)/.test(text), "expected shell doctor repair path to create missing config key");
    assert(/Set-ItemProperty -Path \$configKey -Name "ReportViewerAutoOpen" -Value "1"/.test(text), "expected shell doctor to repair ReportViewerAutoOpen");
    assert(/Set-ItemProperty -Path \$configKey -Name "ReportViewerStartFailCount" -Value "0"/.test(text), "expected shell doctor to reset startup failure counter");
    assert(/SHELL_DOCTOR_REPAIR_FAILED/.test(text), "expected deterministic shell doctor repair failure code");
    assert(/if \(-not \$repairOk\) \{ exit 40 \}/.test(text), "expected shell doctor repair mode to fail closed on write failure");
    assert(/ShellDoctorStatus: PASS/.test(text), "expected shell doctor deterministic pass status line");
    assert(/SHELL_DOCTOR_CONFIG_INVALID/.test(text), "expected shell doctor deterministic config-failure code");
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
    assert(/ReportViewerStartFailCount/.test(text), "expected report viewer failure-count diagnostic");
    assert(/%1/.test(text), "expected %1 token check");
    assert(/%V/.test(text), "expected %V token check");

    const doctorCmdPath = path.join(shellDir, "weftend_shell_doctor.cmd");
    const doctorCmdText = fs.readFileSync(doctorCmdPath, "utf8");
    assert(/set "psExe=%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/i.test(doctorCmdText), "expected shell doctor cmd wrapper to resolve system powershell path");
    assert(/if not exist "%psExe%" set "psExe=powershell\.exe"/i.test(doctorCmdText), "expected shell doctor cmd wrapper to fallback when resolved powershell path is missing");
    assert(/"%psExe%" -NoProfile -ExecutionPolicy Bypass -File/i.test(doctorCmdText), "expected shell doctor cmd wrapper to invoke resolved powershell executable");
    assert(doctorCmdText.includes("%*"), "expected shell doctor cmd wrapper to forward arguments");
  });

  register("launchpad doctor includes shortcut repair action", () => {
    const launchpadPath = path.join(shellDir, "launchpad_panel.ps1");
    const text = fs.readFileSync(launchpadPath, "utf8");
    assert(/Repair Shortcuts/.test(text), "expected launchpad doctor shortcut repair button text");
    assert(/Invoke-ShellDoctorText -RepairShortcuts/.test(text), "expected launchpad doctor shortcut repair invocation");
  });

  register("launchpad history actions resync latest run before opening artifacts", () => {
    const launchpadPath = path.join(shellDir, "launchpad_panel.ps1");
    const text = fs.readFileSync(launchpadPath, "utf8");
    assert(/function Sync-HistoryRowSnapshot/.test(text), "expected launchpad history row snapshot sync helper");
    assert(/function Open-ReportViewerFromHistory[\s\S]*?Sync-HistoryRowSnapshot -Item \$selected/.test(text), "report viewer history action must resync selected row");
    assert(/function Open-HistoryRunFolder[\s\S]*?Sync-HistoryRowSnapshot -Item \$selected/.test(text), "run-folder history action must resync selected row");
    assert(/function Open-HistoryAdapterEvidenceFolder[\s\S]*?Sync-HistoryRowSnapshot -Item \$selected/.test(text), "adapter-evidence history action must resync selected row");
  });

  register("launchpad doctor actions row is horizontally scrollable", () => {
    const launchpadPath = path.join(shellDir, "launchpad_panel.ps1");
    const text = fs.readFileSync(launchpadPath, "utf8");
    assert(/\$doctorLayout\.RowStyles\.Add\(\(New-Object System\.Windows\.Forms\.RowStyle\(\[System\.Windows\.Forms\.SizeType\]::Absolute, 56\)\)\)/.test(text), "doctor actions row must reserve height for horizontal scrollbar");
    assert(/\$doctorActions\.WrapContents = \$false/.test(text), "doctor actions row must stay single-line scroll strip");
    assert(/\$doctorActions\.AutoScroll = \$true/.test(text), "doctor actions row must enable horizontal scrolling");
  });

  register("launchpad history actions row is horizontally scrollable", () => {
    const launchpadPath = path.join(shellDir, "launchpad_panel.ps1");
    const text = fs.readFileSync(launchpadPath, "utf8");
    assert(/\$historyLayout\.RowStyles\.Add\(\(New-Object System\.Windows\.Forms\.RowStyle\(\[System\.Windows\.Forms\.SizeType\]::Absolute, 56\)\)\)/.test(text), "history actions row must reserve height for horizontal scrollbar");
    assert(/\$historyActions\.WrapContents = \$false/.test(text), "history actions row must stay single-line scroll strip");
    assert(/\$historyActions\.AutoScroll = \$true/.test(text), "history actions row must enable horizontal scrolling");
  });

  register("launchpad main actions row is horizontally scrollable", () => {
    const launchpadPath = path.join(shellDir, "launchpad_panel.ps1");
    const text = fs.readFileSync(launchpadPath, "utf8");
    assert(/\$launchLayout\.RowStyles\.Add\(\(New-Object System\.Windows\.Forms\.RowStyle\(\[System\.Windows\.Forms\.SizeType\]::Absolute, 56\)\)\)/.test(text), "launch actions row must reserve height for horizontal scrollbar");
    assert(/\$launchActions\.WrapContents = \$false/.test(text), "launch actions row must stay single-line scroll strip");
    assert(/\$launchActions\.AutoScroll = \$true/.test(text), "launch actions row must enable horizontal scrolling");
  });

  register("launchpad history details keep latest-run logic separate from display token", () => {
    const launchpadPath = path.join(shellDir, "launchpad_panel.ps1");
    const text = fs.readFileSync(launchpadPath, "utf8");
    assert(/function Update-HistoryDetailsBox[\s\S]*?\$latestRunDisplay = \$latestRun/.test(text), "history details must derive a separate display token for latest run");
    assert(/function Update-HistoryDetailsBox[\s\S]*?if \(-not \$latestRunDisplay[\s\S]*?\$latestRunDisplay = "LATEST_UNAVAILABLE"/.test(text), "history details must map missing latest run to display token");
    assert(!/function Update-HistoryDetailsBox[\s\S]*?\$latestRun = "LATEST_UNAVAILABLE"/.test(text), "history details must not replace latest run logic value with display token");
  });

  register("report viewer normalizes clipboard and subtitle placeholders", () => {
    const viewerPath = path.join(shellDir, "report_card_viewer.ps1");
    const text = fs.readFileSync(viewerPath, "utf8");
    assert(/function Get-DisplayStateValue/.test(text), "report viewer missing display-state normalizer");
    assert(/function Build-SummaryClipboardText[\s\S]*Get-DisplayStateValue -Value \$Model\.compareVerdict -Fallback "NOT_APPLICABLE"/.test(text), "report viewer summary clipboard must normalize compare placeholders");
    assert(/function Build-DigestClipboardText[\s\S]*Get-DisplayStateValue -Value \$Model\.reportCardDigest -Fallback "NOT_AVAILABLE"/.test(text), "report viewer digest clipboard must normalize missing digest placeholders");
    assert(/\$subtitle\.Text = \("Target: " \+ \(Get-DisplayStateValue -Value \$model\.libraryKey -Fallback \$LibraryKey\)/.test(text), "report viewer subtitle must normalize display placeholders");
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
    assert(/ReportViewerStartFailCount/.test(text), "expected report viewer startup failure counter");
    assert(/reportViewerDisableThreshold/.test(text), "expected report viewer disable threshold");
    assert(/reportViewerStartupFailures=/.test(text), "expected report viewer startup-failure diagnostics");
    assert(/Start-Process -FilePath \$explorerPath/.test(text), "expected explorer open for output folder");
    assert(/AllowLaunch/.test(text), "expected AllowLaunch gate");
    assert(/Start-Process -FilePath \$effectiveLaunchPath/.test(text), "expected launch support");
    assert(!/Invoke-Item/.test(text), "wrapper must not invoke shell open");
    assert(!/&\s*\$Target/.test(text), "wrapper must not execute target path");
    assert(/WITHHELD/.test(text), "expected WITHHELD wrapper result");
    assert(/DENY/.test(text), "expected DENY wrapper result");
    assert(/OpenLibrary/.test(text), "expected OpenLibrary support");
    assert(/LaunchpadMode/.test(text), "expected LaunchpadMode support");
    assert(/Write-LatestSnapshotReferenceForRun/.test(text), "expected wrapper snapshot reference writer");
    assert(/snapshot_ref_latest\.json/.test(text), "expected wrapper to maintain latest snapshot reference");
    assert(/SNAPSHOT_REFERENCE_WRITTEN/.test(text), "expected wrapper snapshot write status code");
    assert(/snapshotRef=/.test(text), "expected wrapper result snapshot reference status line");

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
    assert(/if \(-not \$Silent\.IsPresent\)\s*\{[\s\S]*?Set-StatusLine -StatusLabel \$statusLabel -Message \$msg -IsError \$false/.test(panelText), "expected silent sync success path to keep status-line quiet");
    assert(/\$label = if \(\$Silent\.IsPresent\) \{ "Refresh warning: " \} else \{ "Sync error: " \}/.test(panelText), "expected silent refresh failures to use explicit warning label");
    assert(/function Get-StableSortKey/.test(panelText), "expected deterministic launchpad sort-key helper");
    assert(/Get-StableSortKey -Value \$_.Name/.test(panelText), "expected launchpad name sorting to use stable sort key");
    assert(!/Sort-Object Name/.test(panelText), "launchpad must avoid locale-sensitive Sort-Object Name");
    assert(/Get-LaunchpadShortcutMetadata/.test(panelText), "expected launchpad shortcut metadata validation");
    assert(/WeftEnd Launchpad Shortcut v1/.test(panelText), "expected launchpad shortcut description trust marker");
    assert(/-LaunchpadMode/.test(panelText), "expected launchpad shortcut args to require LaunchpadMode");
    assert(/-AllowLaunch/.test(panelText), "expected launchpad shortcut args to require AllowLaunch");
    assert(/-Open\\s\+0/.test(panelText), "expected launchpad shortcut args to require Open 0");
    assert(/-OpenLibrary/.test(panelText), "expected launchpad shortcut args to reject OpenLibrary");
    assert(/Read-AdapterTagForRun/.test(panelText), "expected history adapter-tag helper");
    assert(/Get-HistoryKindLabel/.test(panelText), "expected history kind-label helper");
    assert(/Read-AdapterEvidenceForRun/.test(panelText), "expected history adapter-evidence helper");
    assert(/Read-RunEvidenceSnapshot/.test(panelText), "expected history evidence snapshot helper");
    assert(/Compute-FileSha256Digest/.test(panelText), "expected history file digest helper");
    assert(/Get-LatestRunIdForTargetDir/.test(panelText), "expected history latest-run fallback helper");
    assert(/Read-ReportCardSummaryForRun/.test(panelText), "expected history report-card fallback helper");
    assert(/selectedTargetKey/.test(panelText), "expected history selection key preservation variable");
    assert(/if \(\$selectedTargetKey -and \$selectedTargetKey\.Trim\(\) -ne ""\)/.test(panelText), "expected history selection reapply guard");
    assert(/\$candidate\.Selected = \$true/.test(panelText), "expected history selection to be restored after refresh");
    assert(/\$candidate\.Focused = \$true/.test(panelText), "expected history focus to be restored after refresh");
    assert(/\$candidate\.EnsureVisible\(\)/.test(panelText), "expected history restored selection to be visible");
    assert(/targetKind/.test(panelText) && /artifactKind/.test(panelText), "expected report-card kind metadata extraction");
    assert(/ReportViewerStartFailCount/.test(panelText), "expected launchpad viewer startup counter reset support");
    assert(/Invoke-AdapterDoctorText/.test(panelText), "expected adapter doctor helper");
    assert(/Invoke-ShellDoctorText/.test(panelText), "expected shell doctor helper");
    assert(/-RepairReportViewer/.test(panelText), "expected shell doctor repair-viewer switch wiring");
    assert(/& \$powershellExe @args/.test(panelText), "expected shell doctor invocation to use resolved powershell executable path");
    assert(/Copy-DoctorOutputText/.test(panelText), "expected doctor output copy helper");
    assert(/Update-HistoryDetailsBox/.test(panelText), "expected history details update helper");
    assert(/function Get-AutoRefreshStateToken/.test(panelText), "expected auto-refresh state token helper");
    assert(/Auto Refresh: /.test(panelText), "expected auto-refresh state line in history details");
    assert(/SelectedIndexChanged/.test(panelText), "expected history selection details wiring");
    assert(/\$chkAuto\.Add_CheckedChanged\(\{[\s\S]*?Update-HistoryDetailsBox -ListView \$historyList -DetailBox \$historyDetail/.test(panelText), "expected auto-refresh toggle to refresh history details text");
    assert(/Open-HistoryRunFolder/.test(panelText), "expected history open-run helper");
    assert(/Open-HistoryAdapterEvidenceFolder/.test(panelText), "expected history evidence-folder helper");
    assert(/Update-HistoryActionButtons/.test(panelText), "expected history action-button state helper");
    assert(/Copy-HistoryDetailsText/.test(panelText), "expected history copy helper");
    assert(/Copy-HistoryDigestText/.test(panelText), "expected history digest copy helper");
    assert(/Set-ItemProperty -Path \$configPath -Name "ReportViewerAutoOpen" -Value "1"/.test(panelText), "expected launchpad viewer auto-open reset on successful open");
    assert(/Set-ItemProperty -Path \$configPath -Name "ReportViewerStartFailCount" -Value "0"/.test(panelText), "expected launchpad viewer failure counter reset on successful open");
    assert(/if \(\$runDir -and \(Test-Path -LiteralPath \$runDir\)\)\s*\{[\s\S]*?\$args \+= @\("-RunDir", \$runDir\)/.test(panelText), "expected history report open to prefer latest run directory when available");
    assert(/\$args \+= @\("-TargetDir", \$targetDir\)/.test(panelText), "expected history report open fallback to target directory when run directory unavailable");
    assert(/if \(\$latestRun -and \$latestRun -ne "-"\)\s*\{[\s\S]*?\$args \+= @\("-RunId", \$latestRun\)/.test(panelText), "expected history report open fallback to pass latest run id when present");
    assert(/Start-Process -FilePath \$powershellExe -ArgumentList \$args -WindowStyle Hidden/.test(panelText), "expected history report viewer host to launch hidden");
    assert(/Open Evidence/.test(panelText), "expected launchpad history Open Evidence action");
    assert(/Copy Details/.test(panelText), "expected launchpad history Copy Details action");
    assert(/Copy Digests/.test(panelText), "expected launchpad history Copy Digests action");
    assert(/Run Adapter Doctor/.test(panelText), "expected launchpad doctor adapter action");
    assert(/Run Adapter Doctor \(Strict\)/.test(panelText), "expected launchpad doctor strict adapter action");
    assert(panelText.includes("(?m)^\\[([A-Z0-9_]+)\\]"), "expected adapter doctor reason-code parsing from bracketed output");
    assert(panelText.includes("strict\\.reasons=([A-Z0-9_, -]+)"), "expected adapter doctor strict.reasons parsing fallback");
    assert(/Repair Viewer/.test(panelText), "expected launchpad doctor repair viewer action");
    assert(/Copy Doctor Output/.test(panelText), "expected launchpad doctor copy action");
    assert(/Build-ShellDoctorPanelText/.test(panelText), "expected shell doctor panel formatter");
    assert(/Build-AdapterDoctorPanelText/.test(panelText), "expected adapter doctor panel formatter");
    assert(/DOCTOR SUMMARY \(Shell\//.test(panelText), "expected shell doctor summary heading");
    assert(/DOCTOR SUMMARY \(Adapter\//.test(panelText), "expected adapter doctor summary heading");
    assert(/checks\.ok=/.test(panelText), "expected shell doctor summary counters");
    assert(/plugins\.missing=/.test(panelText), "expected adapter doctor summary counters");
    assert(/status\.lines:/.test(panelText), "expected doctor status-lines block");
    assert(/check\.matrix:/.test(panelText), "expected shell doctor check matrix block");
    assert(/adapter\.matrix:/.test(panelText), "expected adapter doctor matrix block");
    assert(/Get-DoctorStateToken/.test(panelText), "expected shared doctor state token helper");
    assert(panelText.includes("(?m)^ShellDoctorStatus:\\s*FAIL\\s+code=([A-Z0-9_]+)\\s*$"), "expected shell doctor explicit fail-status code parsing");
    assert(panelText.includes("code=([A-Z0-9_]+)"), "expected shell doctor output code parsing");
    assert(/"adapter", "doctor", "--text"/.test(panelText), "expected launchpad adapter doctor text-mode command");
    assert(/\$args \+= "--strict"/.test(panelText), "expected launchpad adapter doctor strict flag wiring");
    assert(/Copy-DoctorOutputText -DoctorBox \$doctorText -StatusLabel \$statusLabel/.test(panelText), "expected doctor copy button/key wiring");
    assert(/Clipboard\]::SetText/.test(panelText), "expected history details clipboard copy action");
    assert(/Control -and \$e\.KeyCode -eq \[System\.Windows\.Forms\.Keys\]::C/.test(panelText), "expected history Ctrl+C copy binding");
    assert(/if \(\$e\.Shift\)\s*\{\s*Copy-HistoryDigestText/.test(panelText), "expected history Ctrl+Shift+C digest copy binding");
    assert(/Columns\.Add\("Adapter"/.test(panelText), "expected launchpad history Adapter column");
    assert(/Columns\.Add\("Kind"/.test(panelText), "expected launchpad history Kind column");
    assert(/\$historyList\.MultiSelect = \$false/.test(panelText), "expected launchpad history single-row selection mode");
    assert(/\+plugin/.test(panelText), "expected launchpad adapter plugin marker");
    assert(/capability_ledger_v0\.json/.test(panelText), "expected launchpad adapter tag capability ledger lookup");
    assert(/Adapter Class:/.test(panelText), "expected adapter detail text in history pane");
    assert(/Kind:/.test(panelText), "expected kind detail text in history pane");
    assert(/Safe Receipt Digest:/.test(panelText), "expected safe receipt digest detail in history pane");
    assert(/Privacy Lint Digest:/.test(panelText), "expected privacy lint digest detail in history pane");
    assert(/Operator Receipt Digest:/.test(panelText), "expected operator receipt digest detail in history pane");
    assert(/Report Card Digest:/.test(panelText), "expected report card digest detail in history pane");
    assert(/Compare Receipt Digest:/.test(panelText), "expected compare receipt digest detail in history pane");
    assert(/Compare Report Digest:/.test(panelText), "expected compare report digest detail in history pane");
    assert(/Compare Verdict:/.test(panelText), "expected compare verdict detail in history pane");
    assert(/Compare Buckets:/.test(panelText), "expected compare buckets detail in history pane");
    assert(/Compare Bucket Count:/.test(panelText), "expected compare bucket count detail in history pane");
    assert(/Compare Change Count:/.test(panelText), "expected compare change count detail in history pane");
    assert(/Ensure-LatestSnapshotReferenceForTarget/.test(panelText), "expected automatic latest snapshot reference helper");
    assert(/latestUpdated/.test(panelText), "expected snapshot import latest pointer update reporting");

    const shortcutPath = path.join(shellDir, "weftend_make_shortcut.ps1");
    const shortcutText = fs.readFileSync(shortcutPath, "utf8");
    assert(/\$iconHostExe -NoProfile -ExecutionPolicy Bypass -File \$iconScript/.test(shortcutText), "expected shortcut icon generation to use resolved powershell executable path");
    assert(/LaunchpadMode/.test(shortcutText), "expected LaunchpadMode flag in shortcut tool");
    assert(/-Open 0/.test(shortcutText), "expected quiet mode for launchpad shortcuts");
    assert(/OpenOnChangedOnly/.test(shortcutText), "expected shortcut changed-only UI flag support");
    assert(/LaunchTargetPath/.test(shortcutText), "expected shortcut launch-target override support");
    assert(/WindowStyle = 7/.test(shortcutText), "expected minimized shortcut window style");
    assert(/Description = if \(\$LaunchpadMode\.IsPresent\)/.test(shortcutText), "expected launchpad description marker");
    assert(/WeftEnd Launchpad Shortcut v1/.test(shortcutText), "expected launchpad description text");
  });

  register("bind script metadata avoids wall-clock fields", () => {
    const bindPath = path.join(shellDir, "weftend_bind.ps1");
    const bindText = fs.readFileSync(bindPath, "utf8");
    assert(!/DateTime\]::UtcNow/.test(bindText), "bind metadata must avoid wall-clock timestamp generation");
    assert(!/createdAtUtc/.test(bindText), "bind metadata must avoid createdAtUtc field drift");
    assert(/-OpenOnChangedOnly/.test(bindText), "bind flow must only auto-open UI on changed/blocked runs");
  });

  register("report viewer includes optional adapter evidence panel", () => {
    const viewerPath = path.join(shellDir, "report_card_viewer.ps1");
    const viewerText = fs.readFileSync(viewerPath, "utf8");
    assert(/Load-AdapterEvidence/.test(viewerText), "expected adapter evidence loader");
    assert(/Get-ObjectProperty/.test(viewerText), "expected safe object property helper in report viewer");
    assert(!/safeReceipt\.adapter\./.test(viewerText), "report viewer must not strict-access missing adapter object");
    assert(/Show Adapter Evidence/.test(viewerText), "expected adapter evidence toggle label");
    assert(/Hide Adapter Evidence/.test(viewerText), "expected adapter evidence hide label");
    assert(/\$btnToggleEvidence\.Tag = \$false/.test(viewerText), "expected adapter evidence toggle initial collapsed state");
    assert(/\$adapterPanel\.Visible = \$true/.test(viewerText), "expected adapter evidence toggle expand behavior");
    assert(/\$adapterPanel\.Visible = \$false/.test(viewerText), "expected adapter evidence toggle collapse behavior");
    assert(/\$detailsLayout\.RowStyles\[1\]\.SizeType = \[System\.Windows\.Forms\.SizeType\]::AutoSize/.test(viewerText), "expected adapter evidence expand row-style update");
    assert(/\$detailsLayout\.RowStyles\[1\]\.SizeType = \[System\.Windows\.Forms\.SizeType\]::Absolute/.test(viewerText), "expected adapter evidence collapse row-style update");
    assert(/\$detailsLayout\.RowStyles\[1\]\.Height = 0/.test(viewerText), "expected adapter evidence collapse row height reset");
    assert(/Compute-FileSha256Digest/.test(viewerText), "expected report viewer digest helper");
    assert(/Build-SummaryClipboardText/.test(viewerText), "expected report viewer summary clipboard builder");
    assert(/Build-DigestClipboardText/.test(viewerText), "expected report viewer digest clipboard builder");
    assert(/Try-CopyClipboardText/.test(viewerText), "expected report viewer clipboard helper");
    assert(/capability_ledger_v0\.json/.test(viewerText), "expected capability ledger artifact support");
    assert(/adapter_summary_v0\.json/.test(viewerText), "expected adapter summary artifact support");
    assert(/adapter_findings_v0\.json/.test(viewerText), "expected adapter findings artifact support");
    assert(/Capabilities: requested=/.test(viewerText), "expected capability summary line");
    assert(/Status:/.test(viewerText), "expected status summary line");
    assert(/Run Id:/.test(viewerText), "expected run id summary line");
    assert(/Library Key:/.test(viewerText), "expected library key summary line");
    assert(/Report Card Digest:/.test(viewerText), "expected report card digest summary line");
    assert(/Safe Receipt Digest:/.test(viewerText), "expected safe receipt digest summary line");
    assert(/Privacy Lint Digest:/.test(viewerText), "expected privacy lint digest summary line");
    assert(/Operator Receipt Digest:/.test(viewerText), "expected operator receipt digest summary line");
    assert(/Compare Receipt Digest:/.test(viewerText), "expected compare receipt digest summary line");
    assert(/Compare Report Digest:/.test(viewerText), "expected compare report digest summary line");
    assert(/Compare Verdict:/.test(viewerText), "expected compare verdict summary line");
    assert(/Compare Buckets:/.test(viewerText), "expected compare buckets summary line");
    assert(/Compare Bucket Count:/.test(viewerText), "expected compare bucket count summary line");
    assert(/Compare Change Count:/.test(viewerText), "expected compare change count summary line");
    assert(/Copy Digests/.test(viewerText), "expected report viewer copy digests action");
    assert(/libraryKey=/.test(viewerText), "expected library key in summary clipboard payload");
    assert(/reportCardDigest=/.test(viewerText), "expected report card digest copy payload fields");
    assert(/safeReceiptDigest=/.test(viewerText), "expected digest copy payload fields");
    assert(/privacyLintDigest=/.test(viewerText), "expected privacy lint digest copy payload fields");
    assert(/operatorReceiptDigest=/.test(viewerText), "expected digest copy payload fields");
    assert(/compareReceiptDigest=/.test(viewerText), "expected compare receipt digest copy payload fields");
    assert(/compareReportDigest=/.test(viewerText), "expected compare report digest copy payload fields");
    assert(/compareVerdict=/.test(viewerText), "expected compare verdict copy payload field");
    assert(/compareBuckets=/.test(viewerText), "expected compare buckets copy payload field");
    assert(/compareBucketCount=/.test(viewerText), "expected compare bucket count copy payload field");
    assert(/compareChangeCount=/.test(viewerText), "expected compare change count copy payload field");
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
