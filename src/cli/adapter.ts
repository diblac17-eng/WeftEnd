/* src/cli/adapter.ts */
// Adapter CLI surface.

import { canonicalJSON } from "../core/canon";
import { listAdaptersV1, runAdapterDoctorV1 } from "../runtime/adapters/artifact_adapter_v1";

declare const process: any;

const printUsage = () => {
  console.log("Usage:");
  console.log("  weftend adapter list");
  console.log("  weftend adapter doctor");
};

export const runAdapterCli = (args: string[]): number => {
  const command = String(args[0] || "").trim().toLowerCase();
  if (command !== "list" && command !== "doctor") {
    printUsage();
    return 1;
  }
  const report = command === "doctor" ? runAdapterDoctorV1() : listAdaptersV1();
  process.stdout.write(`${canonicalJSON(report)}\n`);
  return 0;
};
