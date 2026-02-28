/* src/cli/windows_bind_smoke.test.ts */
export {};

declare const require: any;
declare const process: any;
declare const Buffer: any;

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const isWin = process.platform === "win32";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-bind-smoke-"));

const psLiteral = (value: string): string => String(value || "").replace(/'/g, "''");

const runPowerShell = (powershellExe: string, script: string, cwd: string) => {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return spawnSync(
    powershellExe,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { encoding: "utf8", cwd }
  );
};

const readShortcutSnapshot = (powershellExe: string, shortcutPath: string, cwd: string): any => {
  const script = [
    "$w = New-Object -ComObject WScript.Shell",
    `$sc = $w.CreateShortcut('${psLiteral(shortcutPath)}')`,
    "$out = [ordered]@{",
    "  targetPath = [string]$sc.TargetPath",
    "  arguments = [string]$sc.Arguments",
    "  description = [string]$sc.Description",
    "  workingDirectory = [string]$sc.WorkingDirectory",
    "}",
    "$out | ConvertTo-Json -Depth 4 -Compress",
  ].join("\n");
  const r = runPowerShell(powershellExe, script, cwd);
  assert(r.status === 0, `read shortcut snapshot failed status=${String(r.status)} stderr=${String(r.stderr || "").trim()}`);
  return JSON.parse(String(r.stdout || "").trim() || "{}");
};

const run = async () => {
  if (!isWin) {
    console.log("windows_bind_smoke: SKIP (non-windows)");
    return;
  }

  const windir = String(process.env.WINDIR || "C:\\Windows");
  const powershellExe = path.join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (!fs.existsSync(powershellExe)) {
    console.log("windows_bind_smoke: SKIP (powershell host unavailable)");
    return;
  }

  const repoRoot = process.cwd();
  const bindScript = path.join(repoRoot, "tools", "windows", "shell", "weftend_bind.ps1");
  assert(fs.existsSync(bindScript), "missing weftend_bind.ps1");

  const tmp = makeTempDir();
  const appPath = path.join(tmp, "demo.cmd");
  const shortcutPath = path.join(tmp, "Demo.lnk");
  fs.writeFileSync(appPath, "@echo off\r\necho demo\r\n", "utf8");

  {
    const createShortcutScript = [
      "$w = New-Object -ComObject WScript.Shell",
      `$sc = $w.CreateShortcut('${psLiteral(shortcutPath)}')`,
      `$sc.TargetPath = '${psLiteral(appPath)}'`,
      "$sc.Arguments = '--original-mode'",
      "$sc.Description = 'Original Shortcut'",
      "$sc.WindowStyle = 7",
      "$sc.Save()",
    ].join("\n");
    const created = runPowerShell(powershellExe, createShortcutScript, repoRoot);
    assert(created.status === 0, `shortcut seed create failed status=${String(created.status)} stderr=${String(created.stderr || "").trim()}`);
  }

  const runBind = (action: "bind" | "unbind") =>
    spawnSync(
      powershellExe,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", bindScript, "-Action", action, "-TargetPath", shortcutPath],
      { encoding: "utf8", cwd: repoRoot }
    );

  const firstBind = runBind("bind");
  assert(firstBind.status === 0, `initial bind failed status=${String(firstBind.status)} stderr=${String(firstBind.stderr || "").trim()}`);
  assert(String(firstBind.stdout || "").includes("[BIND_OK mode=rewrap]"), "initial bind must report BIND_OK mode=rewrap");

  const firstSnapshot = readShortcutSnapshot(powershellExe, shortcutPath, repoRoot);
  const firstArgs = String(firstSnapshot.arguments || "");
  assert(firstArgs.includes("-AllowLaunch"), "bound shortcut args must include -AllowLaunch");
  assert(firstArgs.includes("-OpenOnChangedOnly"), "bound shortcut args must include -OpenOnChangedOnly");
  assert(firstArgs.includes("-LaunchTargetPath"), "bound shortcut args must include -LaunchTargetPath");
  assert(firstArgs.includes("weftend_safe_run.ps1"), "bound shortcut args must target weftend_safe_run");

  {
    const removeAllowLaunchScript = [
      "$w = New-Object -ComObject WScript.Shell",
      `$sc = $w.CreateShortcut('${psLiteral(shortcutPath)}')`,
      "$args = [string]$sc.Arguments",
      "$args = [System.Text.RegularExpressions.Regex]::Replace($args, '(?i)\\s-AllowLaunch(\\s|$)', ' ')",
      "$sc.Arguments = ($args -replace '\\s+', ' ').Trim()",
      "$sc.Save()",
    ].join("\n");
    const updated = runPowerShell(powershellExe, removeAllowLaunchScript, repoRoot);
    assert(updated.status === 0, `failed to remove -AllowLaunch from shortcut args status=${String(updated.status)} stderr=${String(updated.stderr || "").trim()}`);
  }

  const rebound = runBind("bind");
  assert(rebound.status === 0, `rebind failed status=${String(rebound.status)} stderr=${String(rebound.stderr || "").trim()}`);
  assert(String(rebound.stdout || "").includes("[BIND_UPGRADED mode=rewrap]"), "rebind must upgrade legacy shortcut flags");

  const secondSnapshot = readShortcutSnapshot(powershellExe, shortcutPath, repoRoot);
  const secondArgs = String(secondSnapshot.arguments || "");
  assert(secondArgs.includes("-AllowLaunch"), "rebound shortcut args must restore -AllowLaunch");
  assert(secondArgs.includes("-OpenOnChangedOnly"), "rebound shortcut args must keep -OpenOnChangedOnly");
  assert(secondArgs.includes("-LaunchTargetPath"), "rebound shortcut args must keep -LaunchTargetPath");

  const unbind = runBind("unbind");
  assert(unbind.status === 0, `unbind failed status=${String(unbind.status)} stderr=${String(unbind.stderr || "").trim()}`);
  assert(String(unbind.stdout || "").includes("[UNBIND_OK mode=rewrap_restore]"), "unbind must restore wrapped shortcut state");

  const unboundSnapshot = readShortcutSnapshot(powershellExe, shortcutPath, repoRoot);
  assert(String(unboundSnapshot.targetPath || "").toLowerCase() === String(appPath).toLowerCase(), "unbind must restore original shortcut target");
  assert(!String(unboundSnapshot.arguments || "").includes("weftend_safe_run.ps1"), "unbind must remove weftend wrapper args");

  const residue = fs.readdirSync(tmp).filter((name: string) => name.toLowerCase().endsWith(".stage"));
  assert(residue.length === 0, "bind flow must not leave .stage residue in working directory");
};

run()
  .then(() => {
    console.log("windows_bind_smoke: PASS");
  })
  .catch((err) => {
    const msg = err?.message ? `\n${err.message}` : "";
    throw new Error(`windows_bind_smoke.test failed${msg}`);
  });
