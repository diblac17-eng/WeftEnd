/* src/runtime/open_external.ts */
// OS-level open helper (no path printing).

declare const require: any;
declare const process: any;

const { spawnSync } = require("child_process");

export const openExternalV0 = (target: string): { ok: true } | { ok: false; error: Array<{ code: string; message: string }> } => {
  const safeTarget = String(target || "").trim();
  if (!safeTarget) {
    return { ok: false, error: [{ code: "OPEN_EXTERNAL_INVALID", message: "target missing" }] };
  }

  let cmd = "";
  let args: string[] = [];
  if (process.platform === "win32") {
    cmd = "explorer.exe";
    args = [safeTarget];
  } else if (process.platform === "darwin") {
    cmd = "open";
    args = [safeTarget];
  } else {
    cmd = "xdg-open";
    args = [safeTarget];
  }

  const result = spawnSync(cmd, args, { stdio: "ignore" });
  if (result.status === 0) return { ok: true };

  if (process.platform === "win32") {
    // Fallback for cases where explorer.exe fails (e.g., shell not initialized).
    const fallback = spawnSync("cmd", ["/c", "start", "", safeTarget], { stdio: "ignore" });
    if (fallback.status === 0) return { ok: true };
  }

  return { ok: false, error: [{ code: "OPEN_EXTERNAL_FAILED", message: "open failed" }] };
};
