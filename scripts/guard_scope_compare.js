// scripts/guard_scope_compare.js
// Branch-comparison scope guardrail for pre-commit/pre-push workflows.

const path = require("path");
const fs = require("fs");
const {
  ROOT,
  cmpStrV0,
  normalizeRelPath,
  splitLines,
  uniqSorted,
  runProcess,
  runGit,
  gitText,
  writeJsonAtomic,
} = require("./guard_common");

const OUT_DIR = path.join(ROOT, "out", "guardrails");
const DEFAULT_SCOPE_FILE = path.join(ROOT, ".weftend", "guard_scope.json");
const VERSION = "weftend.guardScopeCompare/0";

function parseArgs(argv) {
  const out = {
    mode: "precommit",
    scopeFile: DEFAULT_SCOPE_FILE,
    writePath: "",
    printJson: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--mode") {
      i += 1;
      out.mode = String(argv[i] || "").trim();
    } else if (arg === "--scope-file") {
      i += 1;
      out.scopeFile = path.resolve(ROOT, String(argv[i] || ""));
    } else if (arg === "--write") {
      i += 1;
      out.writePath = path.resolve(ROOT, String(argv[i] || ""));
    } else if (arg === "--json") {
      out.printJson = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const mode = String(out.mode || "").toLowerCase();
  if (mode !== "precommit" && mode !== "prepush") {
    throw new Error(`Invalid --mode value: ${out.mode}`);
  }
  out.mode = mode;
  if (!out.writePath) {
    out.writePath = path.join(OUT_DIR, `guard_scope_${mode}_last.json`);
  }
  return out;
}

function run(cmd, args, allowFail = false) {
  return runProcess(cmd, args, { allowFail, stdio: "pipe", encoding: "utf8" });
}

function git(args, allowFail = false) {
  return runGit(args, allowFail);
}

function gitFileList(args, allowFail = false) {
  return uniqSorted(splitLines(gitText(args, allowFail)));
}

function readScope(scopeFilePath) {
  const relScope = normalizeRelPath(path.relative(ROOT, scopeFilePath));
  const missing = {
    declared: false,
    schema: "NONE",
    version: -1,
    allowedFiles: [relScope],
    allowedPrefixes: [],
    note: "scope file missing; default hard block remains active",
  };

  if (!fs.existsSync(scopeFilePath)) return missing;
  const stat = fs.statSync(scopeFilePath);
  if (!stat.isFile()) throw new Error(`Scope file is not a file: ${relScope}`);

  let parsed;
  try {
    const raw = String(fs.readFileSync(scopeFilePath, "utf8")).replace(/^\uFEFF/, "");
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in scope file ${relScope}: ${String(e.message || e)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid scope file payload: ${relScope}`);
  }

  const scopeObj = parsed.scope && typeof parsed.scope === "object" ? parsed.scope : parsed;
  const filesRaw = Array.isArray(scopeObj.allowed_files)
    ? scopeObj.allowed_files
    : Array.isArray(scopeObj.allowedFiles)
      ? scopeObj.allowedFiles
      : [];
  const prefixesRaw = Array.isArray(scopeObj.allowed_prefixes)
    ? scopeObj.allowed_prefixes
    : Array.isArray(scopeObj.allowedPrefixes)
      ? scopeObj.allowedPrefixes
      : [];

  const allowedFiles = uniqSorted(
    filesRaw.map((v) => {
      if (typeof v !== "string") throw new Error(`scope.allowed_files must contain strings only (${relScope})`);
      return normalizeRelPath(v);
    })
  );
  const allowedPrefixes = uniqSorted(
    prefixesRaw.map((v) => {
      if (typeof v !== "string") throw new Error(`scope.allowed_prefixes must contain strings only (${relScope})`);
      return normalizeRelPath(v);
    })
  );

  if (!allowedFiles.includes(relScope)) {
    allowedFiles.push(relScope);
    allowedFiles.sort(cmpStrV0);
  }

  return {
    declared: true,
    schema: typeof parsed.schema === "string" ? parsed.schema : "UNKNOWN",
    version: Number.isFinite(parsed.v) ? Number(parsed.v) : -1,
    allowedFiles,
    allowedPrefixes,
    note: "",
  };
}

function inScope(relPath, scope) {
  if (scope.allowedFiles.includes(relPath)) return true;
  for (const prefix of scope.allowedPrefixes) {
    const p = normalizeRelPath(prefix);
    if (!p) continue;
    if (relPath === p) return true;
    if (relPath.startsWith(`${p}/`)) return true;
  }
  return false;
}

function main() {
  const args = parseArgs(process.argv);
  const headSha = gitText(["rev-parse", "--short", "HEAD"]);
  const branch = gitText(["rev-parse", "--abbrev-ref", "HEAD"]);
  const upstreamRef = gitText(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], true);
  const mainVerify = git(["rev-parse", "--verify", "--quiet", "main"], true);
  if (mainVerify.code !== 0) {
    const failPayload = {
      schema: VERSION,
      mode: args.mode,
      status: "FAIL",
      code: "GUARD_MAIN_BRANCH_MISSING",
      headSha,
      branch,
    };
    writeJsonAtomic(args.writePath, failPayload);
    console.error("[guard:scope] FAIL code=GUARD_MAIN_BRANCH_MISSING");
    process.exit(40);
  }
  if (!upstreamRef) {
    const failPayload = {
      schema: VERSION,
      mode: args.mode,
      status: "FAIL",
      code: "GUARD_UPSTREAM_MISSING",
      headSha,
      branch,
    };
    writeJsonAtomic(args.writePath, failPayload);
    console.error("[guard:scope] FAIL code=GUARD_UPSTREAM_MISSING");
    process.exit(40);
  }

  const mainBase = gitText(["merge-base", "HEAD", "main"]);
  const upstreamBase = gitText(["merge-base", "HEAD", upstreamRef]);
  const staged = gitFileList(["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB"]);
  const unstaged = gitFileList(["diff", "--name-only", "--diff-filter=ACDMRTUXB"]);
  const branchDeltaMain = gitFileList(["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${mainBase}..HEAD`]);
  const branchDeltaUpstream = gitFileList(["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${upstreamBase}..HEAD`]);

  const candidate =
    args.mode === "prepush"
      ? uniqSorted([...staged, ...unstaged, ...branchDeltaMain, ...branchDeltaUpstream])
      : uniqSorted([...staged, ...unstaged]);

  const scope = readScope(args.scopeFile);
  const inScopeFiles = [];
  const outOfScopeFiles = [];
  for (const file of candidate) {
    if (inScope(file, scope)) inScopeFiles.push(file);
    else outOfScopeFiles.push(file);
  }

  let status = "PASS";
  let code = "SCOPE_GUARD_PASS";
  if (candidate.length === 0) {
    code = "SCOPE_GUARD_NO_CHANGES";
  } else if (!scope.declared || (scope.allowedFiles.length <= 1 && scope.allowedPrefixes.length === 0)) {
    status = "FAIL";
    code = "SCOPE_GUARD_SCOPE_UNDECLARED";
  } else if (outOfScopeFiles.length > 0) {
    status = "FAIL";
    code = "SCOPE_GUARD_OUT_OF_SCOPE";
  }

  const payload = {
    schema: VERSION,
    mode: args.mode,
    status,
    code,
    branch,
    headSha,
    bases: {
      main: "main",
      upstream: upstreamRef,
      mainMergeBase: mainBase,
      upstreamMergeBase: upstreamBase,
    },
    scope: {
      file: normalizeRelPath(path.relative(ROOT, args.scopeFile)),
      declared: scope.declared,
      schema: scope.schema,
      version: scope.version,
      allowedFiles: scope.allowedFiles,
      allowedPrefixes: scope.allowedPrefixes,
      note: scope.note,
    },
    changed: {
      staged,
      unstaged,
      branchDeltaMain,
      branchDeltaUpstream,
      candidate,
      inScope: inScopeFiles,
      outOfScope: outOfScopeFiles,
    },
  };
  writeJsonAtomic(args.writePath, payload);

  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    console.log(`[guard:scope] mode=${args.mode} status=${status} code=${code}`);
    console.log(`[guard:scope] branch=${branch} head=${headSha} upstream=${upstreamRef}`);
    console.log(
      `[guard:scope] candidate=${candidate.length} inScope=${inScopeFiles.length} outOfScope=${outOfScopeFiles.length}`
    );
    if (!scope.declared) {
      console.log("[guard:scope] scope.declared=NO (default hard block for changed files)");
    }
    if (outOfScopeFiles.length > 0) {
      console.log("[guard:scope] OUT_OF_SCOPE files:");
      for (const file of outOfScopeFiles) console.log(`  - ${file}`);
      console.log("[guard:scope] Update .weftend/guard_scope.json allowlist and rerun.");
    }
  }

  process.exit(status === "PASS" ? 0 : 1);
}

main();
