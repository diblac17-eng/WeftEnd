/* src/cli/summarize.ts */
// Integration-facing summary/export helpers (path-safe output).

import { canonicalJSON } from "../core/canon";
import { stableSortUniqueStringsV0 } from "../core/trust_algebra_v0";
import { formatBuildDigestSummaryV0 } from "../runtime/weftend_build";
import { loadCompareSourceV0 } from "./compare_loader";
import { normalizeCompareSourceV0 } from "./compare_normalize";
import {
  buildNormalizedSummaryV0,
  validateNormalizedSummaryV0,
  type NormalizedSummaryV0,
} from "../integrations/contracts/normalized_summary_v0";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

type Flags = Record<string, string | boolean>;

const parseArgs = (argv: string[]): { rest: string[]; flags: Flags } => {
  const args = [...argv];
  const flags: Flags = {};
  const rest: string[] = [];
  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    if (token === "--help" || token === "-h") {
      flags["help"] = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = args.shift();
      flags[key] = value ?? "";
      continue;
    }
    rest.push(token);
  }
  return { rest, flags };
};

const writeText = (filePath: string, text: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
};

const summarizeReasonPreview = (reasons: string[]): string => {
  if (reasons.length === 0) return "-";
  const preview = reasons.slice(0, 6);
  if (reasons.length > 6) preview.push(`ZZZ_TRUNCATED(+${reasons.length - 6})`);
  return preview.join(",");
};

const loadNormalized = (outRoot: string): { ok: true; value: NormalizedSummaryV0 } | { ok: false; code: string; message: string } => {
  const loaded = loadCompareSourceV0(outRoot, "left");
  if (!loaded.ok) return { ok: false, code: loaded.error.code, message: loaded.error.message };
  const normalized = normalizeCompareSourceV0(loaded.value);
  const value = buildNormalizedSummaryV0({
    weftendBuild: loaded.value.weftendBuild,
    receiptKinds: loaded.value.receiptKinds,
    summary: normalized.summary,
    summaryDigest: normalized.summaryDigest,
  });
  const issues = validateNormalizedSummaryV0(value);
  if (issues.length > 0) {
    return { ok: false, code: issues[0], message: "normalized summary validation failed." };
  }
  return { ok: true, value };
};

const printSummarizeUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend summarize <outRoot>");
};

const printExportUsage = (): void => {
  console.log("Usage:");
  console.log("  weftend export-json <outRoot> --format normalized_v0 [--out <file>]");
};

export const runSummarizeCli = (argv: string[]): number => {
  const { rest, flags } = parseArgs(argv);
  if (flags["help"] || rest.length < 1) {
    printSummarizeUsage();
    return 1;
  }
  const outRoot = rest[0];
  const loaded = loadNormalized(outRoot);
  if (!loaded.ok) {
    console.error(`[${loaded.code}] ${loaded.message}`);
    return 40;
  }
  const summary = loaded.value.summary;
  const reasons = stableSortUniqueStringsV0(summary.reasonCodes ?? []);
  const lines = [
    "WEFTEND SUMMARY",
    `result=${summary.result}`,
    `artifactDigest=${summary.artifactDigest ?? "UNKNOWN"}`,
    `policyDigest=${summary.policyDigest ?? "POLICY_UNKNOWN"}`,
    `kind=${summary.targetKind ?? "UNKNOWN"}:${summary.artifactKind ?? "unknown"}`,
    `externalRefs=${summary.externalRefCount ?? 0}`,
    `domains=${summary.uniqueDomainCount ?? 0}`,
    `reasonCodes=${summarizeReasonPreview(reasons)}`,
    formatBuildDigestSummaryV0(loaded.value.weftendBuild),
  ];
  console.log(lines.join("\n"));
  return 0;
};

export const runExportJsonCli = (argv: string[]): number => {
  const { rest, flags } = parseArgs(argv);
  if (flags["help"] || rest.length < 1) {
    printExportUsage();
    return 1;
  }
  const outRoot = rest[0];
  const format = String(flags["format"] || "");
  if (format !== "normalized_v0") {
    console.error("[FORMAT_UNSUPPORTED] export-json supports --format normalized_v0.");
    return 40;
  }
  const loaded = loadNormalized(outRoot);
  if (!loaded.ok) {
    console.error(`[${loaded.code}] ${loaded.message}`);
    return 40;
  }
  const outputPath =
    String(flags["out"] || "").trim().length > 0
      ? path.resolve(process.cwd(), String(flags["out"]))
      : path.resolve(process.cwd(), outRoot, "normalized_summary_v0.json");
  writeText(outputPath, `${canonicalJSON(loaded.value)}\n`);
  console.log(`EXPORT_JSON OK format=normalized_v0 ${formatBuildDigestSummaryV0(loaded.value.weftendBuild)}`);
  return 0;
};

