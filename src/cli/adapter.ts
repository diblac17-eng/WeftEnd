/* src/cli/adapter.ts */
// Adapter CLI surface.

import { canonicalJSON } from "../core/canon";
import { listAdaptersV1, runAdapterDoctorV1 } from "../runtime/adapters/artifact_adapter_v1";

declare const process: any;

const printUsage = () => {
  console.log("Usage:");
  console.log("  weftend adapter list");
  console.log("  weftend adapter doctor [--text]");
};

export const runAdapterCli = (args: string[]): number => {
  const command = String(args[0] || "").trim().toLowerCase();
  const flags = args.slice(1).map((value) => String(value || "").trim().toLowerCase());
  const textMode = flags.includes("--text");
  if (command !== "list" && command !== "doctor") {
    printUsage();
    return 1;
  }
  if (command === "list" && textMode) {
    printUsage();
    return 1;
  }
  const report = command === "doctor" ? runAdapterDoctorV1() : listAdaptersV1();
  if (command === "doctor" && textMode) {
    const lines: string[] = [];
    const unknownTokens = Array.isArray((report as any).policy?.unknownTokens) ? (report as any).policy.unknownTokens : [];
    const disabled = Array.isArray((report as any).policy?.disabledAdapters) ? (report as any).policy.disabledAdapters : [];
    const invalidReason = String((report as any).policy?.invalidReasonCode || "");
    lines.push("WEFTEND ADAPTER DOCTOR");
    lines.push(`policy.source=${String((report as any).policy?.source || "none")}`);
    lines.push(`policy.disabled=${disabled.length > 0 ? disabled.join(",") : "-"}`);
    lines.push(`policy.unknown=${unknownTokens.length > 0 ? unknownTokens.join(",") : "-"}`);
    lines.push(`policy.invalid=${invalidReason || "-"}`);
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
    const missingPluginAdapters = ((report as any).adapters || [])
      .filter(
        (item: any) =>
          Array.isArray(item?.plugins) &&
          item.plugins.some((plugin: any) => !plugin?.available) &&
          String(item?.maintenance || "") !== "disabled"
      )
      .map((item: any) => String(item?.adapter || ""))
      .filter((value: string) => value.length > 0);
    if (missingPluginAdapters.length > 0) {
      actions.push(`Install missing plugins or disable affected adapters: ${missingPluginAdapters.join(",")}.`);
    }
    lines.push("actions:");
    if (actions.length === 0) lines.push("  none");
    else actions.forEach((action) => lines.push(`  - ${action}`));
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }
  process.stdout.write(`${canonicalJSON(report)}\n`);
  return 0;
};
