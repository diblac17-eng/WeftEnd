// scripts/verify_360.js
// 360 commit gate with evidence-first behavior:
// - host preconditions do not silently block analysis
// - every run writes a receipt/report
// - failures are explicit and bounded

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();
const OUT_ROOT = path.join(root, "out", "verify_360");
const HISTORY_ROOT = path.join(OUT_ROOT, "history");
const MAX_STEPS = 64;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const stableSortUnique = (items) =>
  Array.from(new Set((items || []).filter((x) => typeof x === "string" && x.length > 0))).sort(cmp);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value)
      .sort(cmp)
      .forEach((k) => {
        out[k] = canonicalize(value[k]);
      });
    return out;
  }
  return value;
};

const canonicalJSON = (value) => `${JSON.stringify(canonicalize(value), null, 2)}\n`;

const sha256Text = (text) => {
  const h = crypto.createHash("sha256");
  h.update(String(text || ""));
  return `sha256:${h.digest("hex")}`;
};

const sha256File = (filePath) => {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return `sha256:${h.digest("hex")}`;
};

const rel = (absPath) => path.relative(root, absPath).split(path.sep).join("/");

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

const nextRunDir = () => {
  ensureDir(HISTORY_ROOT);
  const dirs = fs
    .readdirSync(HISTORY_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^run_[0-9]{6}$/.test(d.name))
    .map((d) => d.name)
    .sort(cmp);
  const last = dirs.length > 0 ? Number.parseInt(dirs[dirs.length - 1].slice(4), 10) : 0;
  const next = Number.isFinite(last) ? last + 1 : 1;
  return path.join(HISTORY_ROOT, `run_${String(next).padStart(6, "0")}`);
};

const npmExec = () => {
  const cli = process.env.npm_execpath || "";
  if (cli.length > 0) return { cmd: process.execPath, argsPrefix: [cli] };
  return { cmd: "npm", argsPrefix: [] };
};

const runCommand = (label, cmd, args, envExtra = {}) => {
  const env = { ...process.env, ...envExtra };
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env,
    windowsHide: true,
  });
  const status = typeof res.status === "number" ? res.status : 1;
  return {
    label,
    ok: status === 0,
    exitCode: status,
  };
};

const gitChangedFiles = () => {
  const res = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (typeof res.status !== "number" || res.status !== 0) return null;
  const out = String(res.stdout || "");
  return out
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 4)
    .map((line) => {
      const body = line.slice(3).trim();
      const renameIdx = body.indexOf("->");
      const pathText = renameIdx >= 0 ? body.slice(renameIdx + 2).trim() : body;
      return pathText.split(path.sep).join("/");
    });
};

const runPostingEtiquetteCheck = () => {
  const targets = ["README.md", "docs/RELEASE_ANNOUNCEMENT.txt", "docs/RELEASE_NOTES.txt"];
  const issues = [];
  const bannedPatterns = [
    { code: "ETIQUETTE_AI_SELF_REFERENCE", re: /\b(as an ai|language model|chatgpt|llm)\b/i },
    { code: "ETIQUETTE_APOLOGY_TONE", re: /\b(i apologize|sorry\b|i can't|i cannot)\b/i },
    { code: "ETIQUETTE_HYPE_LANGUAGE", re: /\b(revolutionary|game[\s-]?changer|unbeatable|world[\s-]?class)\b/i },
  ];
  const mojibakeRe = /�|â€™|â€œ|â€|Ã./;
  const emojiRe = /[\u{1F300}-\u{1FAFF}]/u;

  targets.forEach((relPath) => {
    const absPath = path.join(root, relPath);
    if (!fs.existsSync(absPath)) return;
    const text = fs.readFileSync(absPath, "utf8");
    if (mojibakeRe.test(text)) issues.push({ code: "ETIQUETTE_MOJIBAKE_TEXT", relPath });
    if (emojiRe.test(text)) issues.push({ code: "ETIQUETTE_EMOJI_PRESENT", relPath });
    bannedPatterns.forEach(({ code, re }) => {
      if (re.test(text)) issues.push({ code, relPath });
    });
    if (relPath === "docs/RELEASE_ANNOUNCEMENT.txt") {
      if (!/\bHighlights\b/i.test(text)) issues.push({ code: "ETIQUETTE_RELEASE_HIGHLIGHTS_MISSING", relPath });
      if (!/\bValidation\b/i.test(text)) issues.push({ code: "ETIQUETTE_RELEASE_VALIDATION_MISSING", relPath });
    }
  });

  return issues.sort((a, b) => {
    const c0 = cmp(a.code, b.code);
    if (c0 !== 0) return c0;
    return cmp(a.relPath, b.relPath);
  });
};

const compareFilesEqual = (a, b) => {
  const hasA = fs.existsSync(a);
  const hasB = fs.existsSync(b);
  if (!hasA && !hasB) return { ok: true };
  if (hasA !== hasB) return { ok: false, reason: "VERIFY360_FILE_MISSING" };
  const aa = fs.readFileSync(a);
  const bb = fs.readFileSync(b);
  if (!aa.equals(bb)) return { ok: false, reason: "VERIFY360_NONDETERMINISTIC_OUTPUT" };
  return { ok: true };
};

const deterministicFileList = [
  "safe_run_receipt.json",
  "operator_receipt.json",
  "report_card.txt",
  "report_card_v0.json",
  path.join("analysis", "adapter_summary_v0.json"),
  path.join("analysis", "adapter_findings_v0.json"),
];

const writeOutputs = (runDir, payload) => {
  ensureDir(runDir);
  const jsonPath = path.join(runDir, "verify_360_receipt.json");
  const txtPath = path.join(runDir, "verify_360_report.txt");
  fs.writeFileSync(jsonPath, canonicalJSON(payload), "utf8");

  const lines = [];
  lines.push(`VERIFY360 ${payload.verdict}`);
  lines.push(`runId=${payload.runId}`);
  lines.push(`reasonCodes=${(payload.reasonCodes || []).join(",") || "-"}`);
  lines.push(`steps=${payload.steps.length}`);
  payload.steps.forEach((s) => {
    lines.push(
      `${s.id} status=${s.status} exit=${typeof s.exitCode === "number" ? s.exitCode : "-"} reasons=${(s.reasonCodes || []).join("|") || "-"}`
    );
  });
  fs.writeFileSync(txtPath, `${lines.join("\n")}\n`, "utf8");

  ensureDir(OUT_ROOT);
  fs.writeFileSync(path.join(OUT_ROOT, "latest.txt"), `${rel(runDir)}\n`, "utf8");
};

const main = () => {
  const runDir = nextRunDir();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weftend-verify-360-"));
  const outA = path.join(tmpRoot, "run_a");
  const outB = path.join(tmpRoot, "run_b");
  const outCompare = path.join(tmpRoot, "compare");

  const releaseDirEnv = process.env.WEFTEND_RELEASE_DIR || "tests/fixtures/release_demo";
  const releaseDirAbs = path.resolve(root, releaseDirEnv);
  const deterministicInputEnv = process.env.WEFTEND_360_INPUT || "tests/fixtures/intake/tampered_manifest/tampered.zip";
  const deterministicInputAbs = path.resolve(root, deterministicInputEnv);

  const steps = [];
  const addStep = (step) => {
    if (steps.length < MAX_STEPS) steps.push(step);
  };

  const npm = npmExec();
  const npmRun = (name, extraArgs = [], envExtra = {}) =>
    runCommand(name, npm.cmd, [...npm.argsPrefix, "run", name, ...extraArgs], envExtra);

  // Docs/update discipline check (catches "little misses" before commit/release).
  const changed = gitChangedFiles();
  if (!changed) {
    addStep({
      id: "docs_sync",
      status: "PARTIAL",
      reasonCodes: ["VERIFY360_GIT_STATUS_UNAVAILABLE"],
    });
  } else {
    const codeTouched = changed.some(
      (p) =>
        p === "package.json" ||
        p.startsWith("src/") ||
        p.startsWith("scripts/") ||
        p.startsWith("tools/")
    );
    const docsTouched = changed.some(
      (p) =>
        p === "README.md" ||
        p === "docs/RELEASE_NOTES.txt" ||
        p === "docs/QUICKSTART.txt" ||
        p === "docs/RELEASE_CHECKLIST_ALPHA.md"
    );
    if (codeTouched && !docsTouched) {
      addStep({
        id: "docs_sync",
        status: "FAIL",
        reasonCodes: ["VERIFY360_DOC_SYNC_MISSING"],
      });
    } else {
      addStep({
        id: "docs_sync",
        status: "PASS",
        reasonCodes: [],
      });
    }
  }

  // Git/posting etiquette check (avoid odd LLM-style communication artifacts).
  const etiquetteIssues = runPostingEtiquetteCheck();
  if (etiquetteIssues.length > 0) {
    addStep({
      id: "git_etiquette",
      status: "FAIL",
      reasonCodes: stableSortUnique(["VERIFY360_GIT_ETIQUETTE_FAILED", ...etiquetteIssues.map((i) => i.code)]),
      details: {
        issueCount: etiquetteIssues.length,
        issueFiles: stableSortUnique(etiquetteIssues.map((i) => i.relPath)),
      },
    });
  } else {
    addStep({
      id: "git_etiquette",
      status: "PASS",
      reasonCodes: [],
    });
  }

  // Compile
  const compile = npmRun("compile", ["--silent"]);
  addStep({
    id: "compile",
    status: compile.ok ? "PASS" : "FAIL",
    exitCode: compile.exitCode,
    reasonCodes: compile.ok ? [] : ["VERIFY360_COMPILE_FAILED"],
  });

  // Full tests
  const tests = npmRun("test");
  addStep({
    id: "test",
    status: tests.ok ? "PASS" : "FAIL",
    exitCode: tests.exitCode,
    reasonCodes: tests.ok ? [] : ["VERIFY360_TEST_FAILED"],
  });

  // Proofcheck: host precondition missing is evidence SKIP/PARTIAL, not silent hard block.
  let proofEnv = {};
  const proofReasons = [];
  if (fs.existsSync(releaseDirAbs)) {
    proofEnv = { WEFTEND_RELEASE_DIR: releaseDirEnv };
  } else {
    proofEnv = { WEFTEND_ALLOW_SKIP_RELEASE: "1", WEFTEND_RELEASE_DIR: "" };
    proofReasons.push("VERIFY360_RELEASE_FIXTURE_MISSING");
    proofReasons.push("VERIFY360_RELEASE_SMOKE_SKIPPED");
  }
  const proof = npmRun("proofcheck", [], proofEnv);
  addStep({
    id: "proofcheck",
    status: proof.ok ? (proofReasons.length > 0 ? "PARTIAL" : "PASS") : "FAIL",
    exitCode: proof.exitCode,
    reasonCodes: proof.ok ? proofReasons : stableSortUnique(["VERIFY360_PROOFCHECK_FAILED", ...proofReasons]),
  });

  // Determinism replay precondition.
  if (!fs.existsSync(deterministicInputAbs)) {
    addStep({
      id: "determinism_input",
      status: "PARTIAL",
      reasonCodes: ["VERIFY360_INPUT_FIXTURE_MISSING", "VERIFY360_DETERMINISM_SKIPPED"],
    });
    addStep({
      id: "safe_run_pair",
      status: "SKIP",
      reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
    });
    addStep({
      id: "privacy_lint_pair",
      status: "SKIP",
      reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
    });
    addStep({
      id: "compare_smoke",
      status: "SKIP",
      reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
    });
  } else {
    addStep({
      id: "determinism_input",
      status: "PASS",
      reasonCodes: [],
    });

    const safeA = runCommand("safe-run-a", process.execPath, [
      "dist/src/cli/main.js",
      "safe-run",
      deterministicInputAbs,
      "--out",
      outA,
      "--withhold-exec",
    ]);
    const safeB = runCommand("safe-run-b", process.execPath, [
      "dist/src/cli/main.js",
      "safe-run",
      deterministicInputAbs,
      "--out",
      outB,
      "--withhold-exec",
    ]);
    const pairReasons = [];
    let pairOk = safeA.ok && safeB.ok;
    if (!safeA.ok) pairReasons.push("VERIFY360_SAFE_RUN_A_FAILED");
    if (!safeB.ok) pairReasons.push("VERIFY360_SAFE_RUN_B_FAILED");

    if (pairOk) {
      deterministicFileList.forEach((relPath) => {
        const cmpRes = compareFilesEqual(path.join(outA, relPath), path.join(outB, relPath));
        if (!cmpRes.ok) {
          pairOk = false;
          pairReasons.push(cmpRes.reason);
        }
      });
    }
      addStep({
        id: "safe_run_pair",
        status: pairOk ? "PASS" : "FAIL",
        reasonCodes: stableSortUnique(pairReasons),
      });

    if (pairOk) {
      const lintA = runCommand("privacy-lint-a", process.execPath, ["dist/src/runtime/privacy_lint.js", outA]);
      const lintB = runCommand("privacy-lint-b", process.execPath, ["dist/src/runtime/privacy_lint.js", outB]);
      const lintOk = lintA.ok && lintB.ok;
      addStep({
        id: "privacy_lint_pair",
        status: lintOk ? "PASS" : "FAIL",
        reasonCodes: stableSortUnique([
          ...(lintA.ok ? [] : ["VERIFY360_PRIVACY_LINT_A_FAILED"]),
          ...(lintB.ok ? [] : ["VERIFY360_PRIVACY_LINT_B_FAILED"]),
        ]),
      });

      const cmp = runCommand("compare-smoke", process.execPath, [
        "dist/src/cli/main.js",
        "compare",
        outA,
        outB,
        "--out",
        outCompare,
      ]);
      let cmpOk = cmp.ok;
      const cmpReasons = [];
      if (!cmp.ok) cmpReasons.push("VERIFY360_COMPARE_FAILED");
      if (!fs.existsSync(path.join(outCompare, "compare_receipt.json"))) {
        cmpOk = false;
        cmpReasons.push("VERIFY360_COMPARE_RECEIPT_MISSING");
      }
      if (!fs.existsSync(path.join(outCompare, "compare_report.txt"))) {
        cmpOk = false;
        cmpReasons.push("VERIFY360_COMPARE_REPORT_MISSING");
      }
      if (cmpOk) {
        const lintCompare = runCommand("privacy-lint-compare", process.execPath, ["dist/src/runtime/privacy_lint.js", outCompare]);
        if (!lintCompare.ok) {
          cmpOk = false;
          cmpReasons.push("VERIFY360_COMPARE_PRIVACY_LINT_FAILED");
        }
      }
      addStep({
        id: "compare_smoke",
        status: cmpOk ? "PASS" : "FAIL",
        reasonCodes: stableSortUnique(cmpReasons),
      });
    } else {
      addStep({
        id: "privacy_lint_pair",
        status: "SKIP",
        reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
      });
      addStep({
        id: "compare_smoke",
        status: "SKIP",
        reasonCodes: ["VERIFY360_DEPENDENCY_MISSING"],
      });
    }
  }

  const statuses = steps.map((s) => s.status);
  const hasFail = statuses.includes("FAIL");
  const hasPartial = statuses.includes("PARTIAL") || statuses.includes("SKIP");
  const verdict = hasFail ? "FAIL" : hasPartial ? "PARTIAL" : "PASS";
  const reasonCodes = stableSortUnique(
    steps.flatMap((s) => (Array.isArray(s.reasonCodes) ? s.reasonCodes : []))
  );

  const payload = {
    schema: "weftend.verify360/0",
    schemaVersion: 0,
    runId: path.basename(runDir),
    command: "verify:360",
    verdict,
    reasonCodes,
    releaseFixture: fs.existsSync(releaseDirAbs) ? releaseDirEnv : "MISSING",
    deterministicInput: fs.existsSync(deterministicInputAbs) ? deterministicInputEnv : "MISSING",
    steps,
    artifacts: {
      receiptPath: rel(path.join(runDir, "verify_360_receipt.json")),
      reportPath: rel(path.join(runDir, "verify_360_report.txt")),
      runAExists: fs.existsSync(outA) ? 1 : 0,
      runBExists: fs.existsSync(outB) ? 1 : 0,
      compareOutExists: fs.existsSync(outCompare) ? 1 : 0,
    },
  };

  writeOutputs(runDir, payload);
  console.log(`verify:360 ${verdict} receipt=${rel(path.join(runDir, "verify_360_receipt.json"))}`);

  if (verdict === "FAIL") process.exit(1);
  process.exit(0);
};

main();
