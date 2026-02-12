/* src/cli/compare_loader.ts */
// Deterministic receipt loader for `weftend compare`.

import type {
  HostRunReceiptV0,
  OperatorReceiptV0,
  RunReceiptV0,
  SafeRunReceiptV0,
  WeftendBuildV0,
} from "../core/types";
import {
  validateHostRunReceiptV0,
  validateOperatorReceiptV0,
  validateRunReceiptV0,
  validateSafeRunReceiptV0,
} from "../core/validate";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

type CompareSideV0 = "left" | "right";
type ReceiptKindV0 = "operator_receipt" | "safe_run_receipt" | "run_receipt" | "host_run_receipt";

type LoadFailureV0 = { code: string; message: string };

export interface CompareLoadedSourceV0 {
  side: CompareSideV0;
  root: string;
  weftendBuild: WeftendBuildV0;
  receiptKinds: ReceiptKindV0[];
  operatorReceipt?: OperatorReceiptV0;
  safeRunReceipt?: SafeRunReceiptV0;
  runReceipt?: RunReceiptV0;
  hostRunReceipt?: HostRunReceiptV0;
  wrapperExitCode?: number;
}

const sortKinds = (kinds: ReceiptKindV0[]): ReceiptKindV0[] =>
  kinds.slice().sort((a, b) => a.localeCompare(b));

const sideCode = (side: CompareSideV0, suffix: string): string =>
  side === "left" ? `COMPARE_LEFT_${suffix}` : `COMPARE_RIGHT_${suffix}`;

const parseJsonFile = (filePath: string): unknown => {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
};

const parseWrapperExitCode = (root: string): number | undefined => {
  const wrapperPath = path.join(root, "wrapper_result.txt");
  if (!fs.existsSync(wrapperPath)) return undefined;
  try {
    const raw = fs.readFileSync(wrapperPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith("exitCode=")) continue;
      const n = Number(line.slice("exitCode=".length).trim());
      if (Number.isFinite(n)) return n;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const hasCurrentReceiptContract = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const asAny = value as Record<string, unknown>;
  return asAny.schemaVersion === 0 && typeof asAny.weftendBuild === "object" && asAny.weftendBuild !== null;
};

const pickBuild = (loaded: {
  operatorReceipt?: OperatorReceiptV0;
  safeRunReceipt?: SafeRunReceiptV0;
  runReceipt?: RunReceiptV0;
  hostRunReceipt?: HostRunReceiptV0;
}): WeftendBuildV0 =>
  loaded.safeRunReceipt?.weftendBuild ??
  loaded.runReceipt?.weftendBuild ??
  loaded.hostRunReceipt?.weftendBuild ??
  loaded.operatorReceipt?.weftendBuild ??
  { algo: "fnv1a32", digest: "fnv1a32:00000000", source: "UNKNOWN", reasonCodes: ["WEFTEND_BUILD_DIGEST_UNAVAILABLE"] };

export const loadCompareSourceV0 = (
  inputRoot: string,
  side: CompareSideV0
): { ok: true; value: CompareLoadedSourceV0 } | { ok: false; error: LoadFailureV0 } => {
  const root = path.resolve(process.cwd(), inputRoot || "");
  const missingCode = sideCode(side, "RECEIPT_MISSING");
  const invalidCode = sideCode(side, "RECEIPT_INVALID");

  if (!inputRoot || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, error: { code: missingCode, message: "receipt root missing or unreadable." } };
  }

  const loaded: {
    operatorReceipt?: OperatorReceiptV0;
    safeRunReceipt?: SafeRunReceiptV0;
    runReceipt?: RunReceiptV0;
    hostRunReceipt?: HostRunReceiptV0;
  } = {};
  const kinds: ReceiptKindV0[] = [];

  const readKnown = (relPath: string, kind: ReceiptKindV0) => {
    const fullPath = path.join(root, relPath);
    if (!fs.existsSync(fullPath)) return;
    let parsed: unknown;
    try {
      parsed = parseJsonFile(fullPath);
    } catch {
      throw { code: invalidCode, message: "receipt json parse failed." };
    }
    if (!hasCurrentReceiptContract(parsed)) {
      throw { code: "RECEIPT_OLD_CONTRACT", message: "receipt missing schemaVersion/weftendBuild." };
    }
    if (kind === "operator_receipt") {
      const issues = validateOperatorReceiptV0(parsed, `${side}.operatorReceipt`);
      if (issues.length > 0) throw { code: invalidCode, message: `operator receipt invalid (${issues[0].code}).` };
      loaded.operatorReceipt = parsed as OperatorReceiptV0;
      kinds.push(kind);
      return;
    }
    if (kind === "safe_run_receipt") {
      const issues = validateSafeRunReceiptV0(parsed, `${side}.safeRunReceipt`);
      if (issues.length > 0) throw { code: invalidCode, message: `safe-run receipt invalid (${issues[0].code}).` };
      loaded.safeRunReceipt = parsed as SafeRunReceiptV0;
      kinds.push(kind);
      return;
    }
    if (kind === "run_receipt") {
      const issues = validateRunReceiptV0(parsed, `${side}.runReceipt`);
      if (issues.length > 0) throw { code: invalidCode, message: `run receipt invalid (${issues[0].code}).` };
      loaded.runReceipt = parsed as RunReceiptV0;
      kinds.push(kind);
      return;
    }
    if (kind === "host_run_receipt") {
      const issues = validateHostRunReceiptV0(parsed, `${side}.hostRunReceipt`);
      if (issues.length > 0) throw { code: invalidCode, message: `host-run receipt invalid (${issues[0].code}).` };
      loaded.hostRunReceipt = parsed as HostRunReceiptV0;
      kinds.push(kind);
    }
  };

  try {
    readKnown("operator_receipt.json", "operator_receipt");
    readKnown("safe_run_receipt.json", "safe_run_receipt");
    readKnown("run_receipt.json", "run_receipt");
    readKnown("host_run_receipt.json", "host_run_receipt");
    if (!loaded.hostRunReceipt) {
      readKnown(path.join("host", "host_run_receipt.json"), "host_run_receipt");
    }
  } catch (e: any) {
    return { ok: false, error: { code: e?.code || invalidCode, message: e?.message || "receipt load failed." } };
  }

  if (kinds.length === 0) {
    return { ok: false, error: { code: missingCode, message: "no recognized receipt files found." } };
  }

  return {
    ok: true,
    value: {
      side,
      root,
      weftendBuild: pickBuild(loaded),
      receiptKinds: sortKinds(Array.from(new Set(kinds))),
      operatorReceipt: loaded.operatorReceipt,
      safeRunReceipt: loaded.safeRunReceipt,
      runReceipt: loaded.runReceipt,
      hostRunReceipt: loaded.hostRunReceipt,
      wrapperExitCode: parseWrapperExitCode(root),
    },
  };
};
