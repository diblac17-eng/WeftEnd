// scripts/guard_common.js
// Shared helpers for guardrail scripts.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();

function cmpStrV0(a, b) {
  return Buffer.compare(Buffer.from(String(a), "utf8"), Buffer.from(String(b), "utf8"));
}

function normalizeRelPath(input) {
  return String(input || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function splitLines(text) {
  if (!text) return [];
  return String(text)
    .split(/\r?\n/)
    .map((line) => normalizeRelPath(line.trim()))
    .filter((line) => line.length > 0);
}

function uniqSorted(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = normalizeRelPath(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  out.sort(cmpStrV0);
  return out;
}

function runProcess(cmd, args, options) {
  const opts = options || {};
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    stdio: opts.stdio || "pipe",
    encoding: opts.encoding || "utf8",
    windowsHide: true,
    env: opts.env || { ...process.env },
  });
  if (res.error) throw res.error;
  const code = typeof res.status === "number" ? res.status : 1;
  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");
  if (code !== 0 && !opts.allowFail) {
    const detail = stderr || stdout || "<no output>";
    throw new Error(`${cmd} ${args.join(" ")} failed (${code}): ${detail}`);
  }
  return { code, stdout, stderr };
}

function runGit(args, allowFail = false) {
  return runProcess("git", args, { allowFail, stdio: "pipe", encoding: "utf8" });
}

function gitText(args, allowFail = false) {
  const res = runGit(args, allowFail);
  if (res.code !== 0) return "";
  return String(res.stdout || "").trim();
}

function runNodeScript(scriptRelPath, args, stdioMode = "inherit", envExtra) {
  const full = path.join(ROOT, scriptRelPath);
  const res = runProcess(process.execPath, [full, ...(args || [])], {
    stdio: stdioMode,
    env: { ...process.env, ...(envExtra || {}) },
    allowFail: true,
  });
  return res.code;
}

function runNpm(args, envExtra, stdioMode = "inherit") {
  const env = { ...process.env, ...(envExtra || {}) };
  const npmCli = String(env.npm_execpath || "");
  if (npmCli) {
    return runProcess(process.execPath, [npmCli, ...args], {
      stdio: stdioMode,
      env,
      allowFail: true,
    });
  }
  if (process.platform === "win32") {
    const cmdline = `npm ${args.map((v) => (/\s/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v)).join(" ")}`;
    return runProcess("cmd.exe", ["/d", "/s", "/c", cmdline], {
      stdio: stdioMode,
      env,
      allowFail: true,
    });
  }
  return runProcess("npm", args, {
    stdio: stdioMode,
    env,
    allowFail: true,
  });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  try {
    return JSON.parse(String(fs.readFileSync(filePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stagePath = `${filePath}.stage`;
  fs.writeFileSync(stagePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(stagePath, filePath);
}

module.exports = {
  ROOT,
  cmpStrV0,
  normalizeRelPath,
  splitLines,
  uniqSorted,
  runProcess,
  runGit,
  gitText,
  runNodeScript,
  runNpm,
  readJson,
  writeJsonAtomic,
};
