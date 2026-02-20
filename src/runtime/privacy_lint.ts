/* src/runtime/privacy_lint.ts */
// Receipt privacy lint (deterministic, fail-closed).

import { canonicalJSON } from "../core/canon";
import type { WeftendBuildV0 } from "../core/types";
import { computeArtifactDigestV0 } from "./store/artifact_store";
import { computeWeftendBuildV0 } from "./weftend_build";
import { cmpStrV0 } from "../core/order";

declare const require: any;
declare const process: any;
declare const module: any;

const fs = require("fs");
const path = require("path");

export type PrivacyLintViolationV0 = {
  code: string;
  relPath: string;
  sampleHash: string;
};

export type PrivacyLintReportV0 = {
  schema: "weftend.privacyLint/0";
  schemaVersion: 0;
  weftendBuild: WeftendBuildV0;
  verdict: "PASS" | "FAIL";
  violations: PrivacyLintViolationV0[];
};

const REPORT_PATH = path.join("weftend", "privacy_lint_v0.json");

const allowedFile = (relPath: string): boolean => {
  const relNorm = relPath.split(path.sep).join("/").toLowerCase();
  const base = path.basename(relPath).toLowerCase();
  if (relNorm.startsWith("analysis/") && (relNorm.endsWith(".json") || relNorm.endsWith(".txt"))) return true;
  if (base.includes("receipt") && base.endsWith(".json")) return true;
  if (base === "weftend_mint_v1.json") return true;
  if (base === "intake_decision.json") return true;
  if (base === "appeal_bundle.json") return true;
  if (base === "disclosure.txt") return true;
  if (base === "compare_report.txt") return true;
  if (base === "readme.txt") return true;
  if (base === "weftend_mint_v1.txt") return true;
  if (base === "ticket_summary.txt") return true;
  if (base === "ticket_pack_manifest.json") return true;
  if (base === "checksums.txt") return true;
  if (base === "watch_trigger.txt") return true;
  if (base === "adapter_manifest.json") return true;
  if (base === "headers.json") return true;
  if (base === "body.txt") return true;
  if (base === "body.html.txt") return true;
  if (base === "adapter_summary_v0.json") return true;
  if (base === "adapter_findings_v0.json") return true;
  if (base === "report_card.txt") return true;
  if (base === "report_card_v0.json") return true;
  if (base === "wrapper_result.txt") return true;
  if (base === "wrapper_stderr.txt") return true;
  if (base === "wrapper_report_card_error.txt") return true;
  if (relPath.endsWith("/attachments/manifest.json")) return true;
  return false;
};

const normalizeRel = (root: string, filePath: string): string => {
  const rel = path.relative(path.resolve(root), path.resolve(filePath));
  return rel.split(path.sep).join("/");
};

const scanPatterns: Array<{ code: string; regex: RegExp }> = [
  { code: "ABS_PATH_WIN", regex: /\b[A-Za-z]:\\/g },
  { code: "ABS_PATH_UNC", regex: /\\\\[A-Za-z0-9._-]+\\/g },
  { code: "ABS_PATH_POSIX", regex: /(^|[^A-Za-z0-9._-])\/(Users|home|var|etc|opt|private|Volumes)\//g },
  { code: "USER_DIR_HINT_WIN", regex: /\\Users\\/g },
  { code: "USER_DIR_HINT_POSIX", regex: /\/Users\//g },
  { code: "USER_DIR_HINT_POSIX", regex: /\/home\//g },
  { code: "ENV_MARKER_CMD", regex: /%[A-Za-z_][A-Za-z0-9_]*%/g },
  { code: "ENV_MARKER_POWERSHELL", regex: /\$env:[A-Za-z_][A-Za-z0-9_]*/g },
  { code: "ENV_MARKER_SHELL", regex: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g },
];

const computeSampleHash = (snippet: string): string => computeArtifactDigestV0(snippet ?? "");

const addViolationsFromText = (text: string, relPath: string, out: PrivacyLintViolationV0[]): void => {
  scanPatterns.forEach(({ code, regex }) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const sampleHash = computeSampleHash(match[0]);
      out.push({ code, relPath, sampleHash });
    }
  });
};

const scanJsonPaths = (value: unknown, relPath: string, out: PrivacyLintViolationV0[]): void => {
  if (typeof value === "string") {
    addViolationsFromText(value, relPath, out);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => scanJsonPaths(entry, relPath, out));
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => cmpStrV0(a, b));
    entries.forEach(([key, entry]) => {
      addViolationsFromText(String(key), relPath, out);
      scanJsonPaths(entry, relPath, out);
    });
  }
};

const findWeftendTokens = (value: unknown, relPath: string, out: PrivacyLintViolationV0[], parentKey?: string) => {
  if (typeof value === "string") {
    if (value.includes("WEFTEND_") && parentKey !== "reasonCodes" && parentKey !== "warnings") {
      const sampleHash = computeSampleHash("WEFTEND_");
      out.push({ code: "WEFTEND_TOKEN", relPath, sampleHash });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => findWeftendTokens(entry, relPath, out, parentKey));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      findWeftendTokens(entry, relPath, out, key);
    });
  }
};

const sortViolations = (items: PrivacyLintViolationV0[]): PrivacyLintViolationV0[] =>
  items
    .slice()
    .sort((a, b) => {
      const c0 = cmpStrV0(a.code, b.code);
      if (c0 !== 0) return c0;
      const c1 = cmpStrV0(a.relPath, b.relPath);
      if (c1 !== 0) return c1;
      return cmpStrV0(a.sampleHash, b.sampleHash);
    });

const buildReport = (weftendBuild: WeftendBuildV0, violations: PrivacyLintViolationV0[]): PrivacyLintReportV0 => ({
  schema: "weftend.privacyLint/0",
  schemaVersion: 0,
  weftendBuild,
  verdict: violations.length > 0 ? "FAIL" : "PASS",
  violations: sortViolations(violations),
});

export const formatPrivacyLintSummary = (report: PrivacyLintReportV0): string => {
  if (report.verdict === "PASS") return "privacy_lint: PASS";
  const codes = Array.from(new Set(report.violations.map((v) => v.code))).sort();
  return `privacy_lint: FAIL codes=${codes.join(",")}`;
};

export const runPrivacyLintV0 = (options: {
  root: string;
  weftendBuild?: WeftendBuildV0;
  writeReport?: boolean;
}): { report: PrivacyLintReportV0; exitCode: number; summary: string; reportPath: string } => {
  const root = path.resolve(options.root || ".");
  const build =
    options.weftendBuild ??
    computeWeftendBuildV0({
      filePath: process?.argv?.[1],
      source: "NODE_MAIN_JS",
    }).build;

  const violations: PrivacyLintViolationV0[] = [];

  const walk = (dir: string) => {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }
    entries.sort((a: any, b: any) => cmpStrV0(String(a.name), String(b.name)));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory && entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = normalizeRel(root, full);
      if (!allowedFile(rel)) continue;
      let text = "";
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      addViolationsFromText(text, rel, violations);
      const base = path.basename(full).toLowerCase();
      const isReadme = base === "readme.txt";
      if (base.endsWith(".json")) {
        try {
          const parsed = JSON.parse(text);
          scanJsonPaths(parsed, rel, violations);
          findWeftendTokens(parsed, rel, violations);
        } catch {
          // If JSON is invalid, treat WEFTEND_ in raw text as a violation.
          if (text.includes("WEFTEND_")) {
            violations.push({ code: "WEFTEND_TOKEN", relPath: rel, sampleHash: computeSampleHash("WEFTEND_") });
          }
        }
      } else {
        if (text.includes("WEFTEND_")) {
          const scrubbed = isReadme
            ? text
                .split("\n")
                .filter((line) => !line.startsWith("weftendBuild.reasonCodes="))
                .join("\n")
            : text;
          if (scrubbed.includes("WEFTEND_")) {
            violations.push({ code: "WEFTEND_TOKEN", relPath: rel, sampleHash: computeSampleHash("WEFTEND_") });
          }
        }
      }
    }
  };

  walk(root);

  const report = buildReport(build, violations);
  const reportPath = path.join(root, REPORT_PATH);
  if (options.writeReport !== false) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${canonicalJSON(report)}\n`, "utf8");
  }
  const summary = formatPrivacyLintSummary(report);
  const exitCode = report.verdict === "PASS" ? 0 : 40;
  return { report, exitCode, summary, reportPath };
};

if (require.main === module) {
  const root = process.argv[2] || "out";
  const result = runPrivacyLintV0({ root });
  console.log(result.summary);
  process.exit(result.exitCode);
}
