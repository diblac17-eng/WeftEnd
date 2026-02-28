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

const validatePolicyOutputPath = (outPath: string): { ok: true } | { ok: false; code: string; message: string } => {
  const resolved = path.resolve(process.cwd(), String(outPath || ""));
  try {
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return {
          ok: false,
          code: "ADAPTER_POLICY_OUT_PATH_IS_DIRECTORY",
          message: "--write-policy must be a file path or a missing path.",
        };
      }
    }
  } catch {
    return { ok: false, code: "ADAPTER_POLICY_OUT_PATH_STAT_FAILED", message: "unable to inspect --write-policy path." };
  }
  const parentDir = path.dirname(resolved);
  if (parentDir && fs.existsSync(parentDir)) {
    try {
      const parentStat = fs.statSync(parentDir);
      if (!parentStat.isDirectory()) {
        return {
          ok: false,
          code: "ADAPTER_POLICY_OUT_PATH_PARENT_NOT_DIRECTORY",
          message: "parent of --write-policy path must be a directory.",
        };
      }
    } catch {
      return {
        ok: false,
        code: "ADAPTER_POLICY_OUT_PATH_PARENT_STAT_FAILED",
        message: "unable to inspect parent of --write-policy path.",
      };
    }
  }
  return { ok: true };
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

const toLightToken = (state: "PASS" | "WARN" | "FAIL" | "OFF"): "GREEN" | "YELLOW" | "RED" | "GRAY" => {
  if (state === "PASS") return "GREEN";
  if (state === "WARN") return "YELLOW";
  if (state === "FAIL") return "RED";
  return "GRAY";
};

const deriveDoctorCode = (params: {
  strictMode: boolean;
  strictReasons: string[];
  invalidReason: string;
  unknownTokens: string[];
  missingPluginAdapters: string[];
}): string => {
  const strictReasons = Array.isArray(params.strictReasons) ? params.strictReasons : [];
  if (params.strictMode && strictReasons.length > 0) return strictReasons[0];
  if (params.invalidReason) return params.invalidReason;
  if (Array.isArray(params.unknownTokens) && params.unknownTokens.length > 0) return "ADAPTER_DOCTOR_POLICY_UNKNOWN_TOKEN";
  if (Array.isArray(params.missingPluginAdapters) && params.missingPluginAdapters.length > 0) return "ADAPTER_DOCTOR_MISSING_PLUGIN";
  return "ADAPTER_DOCTOR_OK";
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
  const strictReasons = command === "doctor" && strictMode ? collectStrictReasonCodes(report) : [];
  const reportOut =
    command === "doctor" && strictMode
      ? {
          ...(report as any),
          strict: {
            status: strictReasons.length > 0 ? "FAIL" : "PASS",
            reasonCodes: strictReasons,
          },
        }
      : report;
  if (command === "doctor" && writePolicyPath.length > 0) {
    const outPathCheck = validatePolicyOutputPath(writePolicyPath);
    if (!outPathCheck.ok) {
      process.stderr.write(`[${outPathCheck.code}] ${outPathCheck.message}\n`);
      return 40;
    }
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
    const missingPluginAdapters = collectMissingPluginAdapters(report);
    const strictState: "PASS" | "FAIL" | "OFF" = strictMode ? (strictReasons.length > 0 ? "FAIL" : "PASS") : "OFF";
    const policyState: "PASS" | "FAIL" = invalidReason || unknownTokens.length > 0 ? "FAIL" : "PASS";
    const pluginState: "PASS" | "WARN" = missingPluginAdapters.length > 0 ? "WARN" : "PASS";
    const overallState: "PASS" | "WARN" | "FAIL" =
      policyState === "FAIL" || strictState === "FAIL" ? "FAIL" : pluginState === "WARN" ? "WARN" : "PASS";
    const doctorCode = deriveDoctorCode({
      strictMode,
      strictReasons,
      invalidReason,
      unknownTokens,
      missingPluginAdapters,
    });
    lines.push("WEFTEND ADAPTER DOCTOR");
    lines.push(`AdapterDoctorStatus: ${overallState}`);
    lines.push(`AdapterDoctorCode: ${doctorCode}`);
    lines.push(`AdapterDoctorLight: ${toLightToken(overallState)}`);
    lines.push("summary:");
    lines.push(`  overall=${overallState}`);
    lines.push(`  policy=${policyState}`);
    lines.push(`  plugins=${pluginState}`);
    lines.push(`  strict=${strictState}`);
    lines.push("doctor.lights:");
    lines.push(`  overall=${toLightToken(overallState)}`);
    lines.push(`  policy=${toLightToken(policyState)}`);
    lines.push(`  plugins=${toLightToken(pluginState)}`);
    lines.push(`  strict=${toLightToken(strictState)}`);
    lines.push("status.lines:");
    lines.push(
      `  [${policyState}] policy source=${String((report as any).policy?.source || "none")} disabled=${disabled.length > 0 ? disabled.join(",") : "-"} unknown=${unknownTokens.length > 0 ? unknownTokens.join(",") : "-"} invalid=${invalidReason || "-"}`
    );
    lines.push(`  [${pluginState}] missing.plugins=${missingPluginAdapters.length > 0 ? missingPluginAdapters.join(",") : "-"}`);
    lines.push(`  [${strictState}] strict.reasons=${strictReasons.length > 0 ? strictReasons.join(",") : "-"}`);
    lines.push(`policy.source=${String((report as any).policy?.source || "none")}`);
    lines.push(`policy.disabled=${disabled.length > 0 ? disabled.join(",") : "-"}`);
    lines.push(`policy.unknown=${unknownTokens.length > 0 ? unknownTokens.join(",") : "-"}`);
    lines.push(`policy.invalid=${invalidReason || "-"}`);
    lines.push(`strict.status=${strictState}`);
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
  process.stdout.write(`${canonicalJSON(reportOut)}\n`);
  if (command === "doctor" && strictMode) {
    if (strictReasons.length > 0) {
      process.stderr.write(`[${strictReasons.join(",")}] strict adapter doctor checks failed.\n`);
      return 40;
    }
  }
  return 0;
};
