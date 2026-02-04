/* src/runtime/library_root.ts */
// Resolve the local WeftEnd library root (deterministic, no path printing).

declare const require: any;
declare const process: any;

const path = require("path");
const { spawnSync } = require("child_process");

export type LibraryRootSourceV0 = "ENV" | "REGISTRY" | "LOCALAPPDATA" | "HOME" | "CWD";

const normalizeLibraryRoot = (base: string): string => {
  const trimmed = String(base || "").trim();
  if (!trimmed) return "";
  const leaf = path.basename(trimmed);
  if (leaf.toLowerCase() === "library") return trimmed;
  return path.join(trimmed, "Library");
};

const readRegistryOutRoot = (): string | undefined => {
  if (process.platform !== "win32") return undefined;
  const result = spawnSync(
    "reg",
    ["query", "HKCU\\Software\\WeftEnd\\Shell", "/v", "OutRoot"],
    { encoding: "utf8" }
  );
  if (result.status !== 0 || !result.stdout) return undefined;
  const lines = result.stdout.split(/\r?\n/);
  for (const line of lines) {
    if (!line || !line.includes("OutRoot")) continue;
    const match = line.match(/OutRoot\s+REG_\w+\s+(.+)/i);
    if (match && match[1]) return match[1].trim();
  }
  return undefined;
};

export const resolveLibraryRootV0 = (): { root: string; source: LibraryRootSourceV0 } => {
  const envRoot = (process.env.WEFTEND_LIBRARY_ROOT || "").trim();
  if (envRoot) {
    return { root: normalizeLibraryRoot(envRoot), source: "ENV" };
  }
  const regOut = readRegistryOutRoot();
  if (regOut) {
    return { root: normalizeLibraryRoot(regOut), source: "REGISTRY" };
  }
  const localApp = (process.env.LOCALAPPDATA || "").trim();
  if (localApp) {
    return { root: normalizeLibraryRoot(path.join(localApp, "WeftEnd")), source: "LOCALAPPDATA" };
  }
  const home = (process.env.HOME || "").trim();
  if (home) {
    return { root: normalizeLibraryRoot(path.join(home, ".weftend")), source: "HOME" };
  }
  return { root: normalizeLibraryRoot(path.join(process.cwd(), "weftend")), source: "CWD" };
};
