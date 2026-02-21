// src/cli/examine.ts
// CLI handler for `weftend examine`.

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

import { canonicalJSON } from "../core/canon";
import { validateMintPackageV1 } from "../core/validate";
import type { MintProfileV1 } from "../core/types";
import { examineArtifactV1 } from "../runtime/examiner/examine";

export interface ExamineCliOptions {
  profile: MintProfileV1;
  outDir: string;
  scriptPath?: string;
  emitCapture?: boolean;
}

const readTextFile = (filePath: string): string => fs.readFileSync(filePath, "utf8");

const writeFile = (filePath: string, contents: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
};

const prepareStagedOutRoot = (outDir: string): { ok: true; stageOutDir: string } | { ok: false } => {
  const stageOutDir = `${outDir}.stage`;
  try {
    fs.rmSync(stageOutDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(stageOutDir), { recursive: true });
    fs.mkdirSync(stageOutDir, { recursive: true });
    return { ok: true, stageOutDir };
  } catch {
    return { ok: false };
  }
};

const finalizeStagedOutRoot = (stageOutDir: string, outDir: string): boolean => {
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(stageOutDir, outDir);
    return true;
  } catch {
    return false;
  }
};

const copyCapture = (capture: ReturnType<typeof examineArtifactV1>["capture"], outDir: string) => {
  const captureDir = path.join(outDir, "capture");
  fs.mkdirSync(captureDir, { recursive: true });
  if (capture.kind === "dir") {
    for (const entry of capture.entries) {
      const src = path.join(capture.basePath, entry.path);
      const dest = path.join(captureDir, entry.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return;
  }
  if (capture.kind === "zip") {
    const dest = path.join(captureDir, path.basename(capture.basePath));
    fs.copyFileSync(capture.basePath, dest);
    return;
  }
  const single = capture.entries[0];
  if (single) {
    const dest = path.join(captureDir, single.path);
    fs.copyFileSync(capture.basePath, dest);
  }
};

export const runExamine = (inputPath: string, options: ExamineCliOptions): number => {
  const scriptText = options.scriptPath ? readTextFile(options.scriptPath) : undefined;
  const result = examineArtifactV1(inputPath, {
    profile: options.profile,
    scriptText,
  });

  const issues = validateMintPackageV1(result.mint, "mint");
  if (issues.length > 0) {
    console.error("[MINT_INVALID]");
    issues.forEach((iss) => {
      const loc = iss.path ? ` (${iss.path})` : "";
      console.error(`${iss.code}: ${iss.message}${loc}`);
    });
    return 2;
  }

  const finalOutDir = options.outDir;
  const stage = prepareStagedOutRoot(finalOutDir);
  if (!stage.ok) {
    console.error("[EXAMINE_STAGE_INIT_FAILED] unable to initialize staged output path.");
    return 1;
  }
  const outDir = stage.stageOutDir;
  fs.mkdirSync(outDir, { recursive: true });
  writeFile(path.join(outDir, "weftend_mint_v1.json"), canonicalJSON(result.mint));
  writeFile(path.join(outDir, "weftend_mint_v1.txt"), result.report);

  if (options.emitCapture) {
    try {
      copyCapture(result.capture, outDir);
    } catch (err: any) {
      console.error("[CAPTURE_EMIT_FAILED]", err?.message ?? String(err));
    }
  }

  if (!finalizeStagedOutRoot(outDir, finalOutDir)) {
    console.error("[EXAMINE_FINALIZE_FAILED] unable to finalize staged output.");
    return 1;
  }

  return result.mint.grade.status === "DENY" || result.mint.grade.status === "QUARANTINE" ? 2 : 0;
};

