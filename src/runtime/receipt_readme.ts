/* src/runtime/receipt_readme.ts */
// Deterministic README for output roots (no paths, no env, no time).

import type { WeftendBuildV0 } from "../core/types";
import { stableSortUniqueReasonsV0 } from "../core/trust_algebra_v0";

declare const require: any;

const fs = require("fs");
const path = require("path");

const README_NAME = "README.txt";

export const buildReceiptReadmeV0 = (build: WeftendBuildV0, schemaVersion: number = 0): string => {
  const reasons = stableSortUniqueReasonsV0(build?.reasonCodes ?? []);
  const unavailable = reasons.includes("WEFTEND_BUILD_DIGEST_UNAVAILABLE");
  const digestValue = unavailable ? "UNAVAILABLE" : build?.digest ?? "UNAVAILABLE";
  const reasonLine = reasons.length > 0 ? reasons.join(",") : "";
  return [
    `schemaVersion=${schemaVersion}`,
    `weftendBuild.digest=${digestValue}`,
    `weftendBuild.reasonCodes=${reasonLine}`,
    "warning=Receipts missing schemaVersion/weftendBuild are old-contract.",
    "",
  ].join("\n");
};

export const writeReceiptReadmeV0 = (outRoot: string, build: WeftendBuildV0, schemaVersion: number = 0): string => {
  const dir = path.join(outRoot, "weftend");
  fs.mkdirSync(dir, { recursive: true });
  const contents = buildReceiptReadmeV0(build, schemaVersion);
  const target = path.join(dir, README_NAME);
  fs.writeFileSync(target, contents, "utf8");
  return target;
};

