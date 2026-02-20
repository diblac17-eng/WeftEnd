/* src/cli/adapter.ts */
// Adapter CLI surface.

import { canonicalJSON } from "../core/canon";
import { cmpStrV0 } from "../core/order";
import { listAdaptersV1, runAdapterDoctorV1 } from "../runtime/adapters/artifact_adapter_v1";

declare const process: any;
declare const require: any;

const fs = require("fs");
const path = require("path");

const printUsage = () => {
  console.log("Usage:");
  console.log("  weftend adapter list");
  console.log("  weftend adapter doctor [--text] [--strict] [--write-policy <path>] [--include-missing-plugins]");
};

const writeCanonicalPolicyAtomic = (outPath: string, payload: unknown): void => {
  const resolved = path.resolve(process.cwd(), outPath);
  const dir = path.dirname(resolved);
  const stagePath = `${resolved}.stage`;
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(stagePath, `${canonicalJSON(payload)}\n`, "utf8");
    fs.renameSync(stagePath, resolved);
  } catch (err) {
    try {
      if (fs.existsSync(stagePath)) fs.unlinkSync(stagePath);
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
};

const stableSortUniqueStrings = (items: string[]): string[] =>
  Array.from(new Set((items || []).map((value) => String(value || "").trim()).filter((value) => value.length > 0))).sort((a, b) => cmpStrV0(a, b));

const collectMissingPluginAdapters = (report: any): string[] =>
  stableSortUniqueStrings(
    ((report as any).adapters || [])
      .filter(
        (item: any) =>
          Array.isArray(item?.plugins) &&
          item.plugins.some((plugin: any) => !plugin?.available) &&
          String(item?.maintenance || "") !== "disabled"
      )
      .map((item: any) => String(item?.adapter || ""))
  );

const collectStrictReasonCodes = (report: any): string[] => {
  const reasons: string[] = [];
  const invalidReason = String((report as any).policy?.invalidReasonCode || "");
  const unknownTokens = Array.isArray((report as any).policy?.unknownTokens) ? (report as any).policy.unknownTokens : [];
  const missingPluginAdapters = collectMissingPluginAdapters(report);
  if (invalidReason) reasons.push("ADAPTER_DOCTOR_STRICT_POLICY_INVALID");
  if (unknownTokens.length > 0) reasons.push("ADAPTER_DOCTOR_STRICT_POLICY_UNKNOWN_TOKEN");
  if (missingPluginAdapters.length > 0) reasons.push("ADAPTER_DOCTOR_STRICT_MISSING_PLUGIN");
  return stableSortUniqueStrings(reasons);
};

export const runAdapterCli = (args: string[]): number => {
  const command = String(args[0] || "").trim().toLowerCase();
  let textMode = false;
  let strictMode = false;
  let writePolicyPath = "";
  let includeMissingPlugins = false;
  for (let i = 1; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    const normalized = token.toLowerCase();
    if (!normalized) continue;
    if (normalized === "--text") {
      textMode = true;
      continue;
    }
    if (normalized === "--strict") {
      strictMode = true;
      continue;
    }
    if (normalized === "--include-missing-plugins") {
      includeMissingPlugins = true;
      continue;
    }
    if (normalized === "--write-policy") {
      const next = String(args[i + 1] || "").trim();
      if (!next) {
        printUsage();
        return 1;
      }
      writePolicyPath = next;
      i += 1;
      continue;
    }
    printUsage();
    return 1;
  }
  if (command !== "list" && command !== "doctor") {
    printUsage();
    return 1;
  }
  if (command === "list" && (textMode || strictMode || writePolicyPath.length > 0 || includeMissingPlugins)) {
    printUsage();
    return 1;
  }
  if (command === "doctor" && includeMissingPlugins && writePolicyPath.length === 0) {
    printUsage();
    return 1;
  }
  const report = command === "doctor" ? runAdapterDoctorV1() : listAdaptersV1();
  if (command === "doctor" && writePolicyPath.length > 0) {
    const disabled = new Set<string>();
    const knownDisabled = Array.isArray((report as any).policy?.disabledAdapters) ? (report as any).policy.disabledAdapters : [];
    knownDisabled.forEach((name: any) => {
      const normalized = String(name || "").trim().toLowerCase();
      if (normalized.length > 0) disabled.add(normalized);
    });
    if (includeMissingPlugins) {
      ((report as any).adapters || []).forEach((item: any) => {
        const adapter = String(item?.adapter || "").trim().toLowerCase();
        if (!adapter) return;
        const hasMissingPlugin = Array.isArray(item?.plugins) && item.plugins.some((plugin: any) => !plugin?.available);
        if (hasMissingPlugin) disabled.add(adapter);
      });
    }
    const policy = {
      schema: "weftend.adapterMaintenance/0",
      disabledAdapters: Array.from(disabled.values()).sort((a, b) => cmpStrV0(a, b)),
    };
    try {
      writeCanonicalPolicyAtomic(writePolicyPath, policy);
    } catch {
      process.stderr.write("[ADAPTER_POLICY_WRITE_FAILED] unable to write policy output file.\n");
      return 1;
    }
  }
  if (command === "doctor" && textMode) {
    const lines: string[] = [];
    const unknownTokens = Array.isArray((report as any).policy?.unknownTokens) ? (report as any).policy.unknownTokens : [];
    const disabled = Array.isArray((report as any).policy?.disabledAdapters) ? (report as any).policy.disabledAdapters : [];
    const invalidReason = String((report as any).policy?.invalidReasonCode || "");
    const strictReasons = strictMode ? collectStrictReasonCodes(report) : [];
    lines.push("WEFTEND ADAPTER DOCTOR");
    lines.push(`policy.source=${String((report as any).policy?.source || "none")}`);
    lines.push(`policy.disabled=${disabled.length > 0 ? disabled.join(",") : "-"}`);
    lines.push(`policy.unknown=${unknownTokens.length > 0 ? unknownTokens.join(",") : "-"}`);
    lines.push(`policy.invalid=${invalidReason || "-"}`);
    lines.push(`strict.status=${strictMode ? (strictReasons.length > 0 ? "FAIL" : "PASS") : "OFF"}`);
    lines.push(`strict.reasons=${strictReasons.length > 0 ? strictReasons.join(",") : "-"}`);
    lines.push("adapters:");
    ((report as any).adapters || []).forEach((item: any) => {
      const plugins = Array.isArray(item?.plugins)
        ? item.plugins
            .map((plugin: any) => `${String(plugin?.name || "")}:${plugin?.available ? "ok" : "missing"}`)
            .join(",")
        : "-";
      lines.push(
        `  ${String(item?.adapter || "-")} status=${String(item?.maintenance || "-")} mode=${String(item?.mode || "-")} plugins=${plugins || "-"}`
      );
    });
    const actions: string[] = [];
    if (invalidReason) actions.push("Fix adapter policy file content or unset WEFTEND_ADAPTER_DISABLE_FILE.");
    if (unknownTokens.length > 0) actions.push("Remove unknown adapter disable tokens.");
    const missingPluginAdapters = collectMissingPluginAdapters(report);
    if (missingPluginAdapters.length > 0) {
      actions.push(`Install missing plugins or disable affected adapters: ${missingPluginAdapters.join(",")}.`);
    }
    if (writePolicyPath.length > 0) {
      const resolved = path.resolve(process.cwd(), writePolicyPath);
      actions.push(`Wrote maintenance policy file: ${resolved}`);
    }
    lines.push("actions:");
    if (actions.length === 0) lines.push("  none");
    else actions.forEach((action) => lines.push(`  - ${action}`));
    process.stdout.write(`${lines.join("\n")}\n`);
    if (strictMode && strictReasons.length > 0) {
      process.stderr.write(`[${strictReasons.join(",")}] strict adapter doctor checks failed.\n`);
      return 40;
    }
    return 0;
  }
  process.stdout.write(`${canonicalJSON(report)}\n`);
  if (command === "doctor" && strictMode) {
    const strictReasons = collectStrictReasonCodes(report);
    if (strictReasons.length > 0) {
      process.stderr.write(`[${strictReasons.join(",")}] strict adapter doctor checks failed.\n`);
      return 40;
    }
  }
  return 0;
};
