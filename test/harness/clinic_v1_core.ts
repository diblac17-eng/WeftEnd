// test/harness/clinic_v1_core.ts
// Clinic v1 core logic (harness-only, deterministic, no DOM).

import {
  canonicalizeAdapterV0,
  canonicalJSON,
  digestString,
  normalizeHtml,
} from "./adapter_v0.ts";
import {
  canonicalizeImportSnapshotV0,
  computeBlockDigestV0,
  digestImportSnapshotV0,
  validateImportSnapshotV0,
} from "../../import_snapshot_v0.ts";
import { runImportBlockifyV1 } from "../../import_blockify_v1.ts";
import { buildIntegrityReportV0 } from "../../integrity_scan_v0.ts";

const DEFAULT_PAGE_ID = "page:/clinic";

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);

const buildSnapshotFromPlan = (html, planBlocks, pageId) => {
  const blocks = Array.isArray(planBlocks)
    ? planBlocks.map((block) => ({
        blockId: block.blockId,
        blockDigest: computeBlockDigestV0({
          blockId: block.blockId,
          nodePath: block.nodePath,
          rootTag: block.rootTag,
          name: block.name,
          status: block.status,
          contentRef: { kind: "nodePath", value: block.nodePath },
        }),
        nodePath: block.nodePath,
        rootTag: block.rootTag,
        name: block.name,
        status: block.status,
        contentRef: { kind: "nodePath", value: block.nodePath },
      }))
    : [];

  return canonicalizeImportSnapshotV0({
    inputHtml: html,
    design: { pageId },
    blocks,
  });
};

const summarizeReleaseChecks = (checks) => {
  const list = Array.isArray(checks) ? checks : [];
  return list.map((check) => ({
    id: typeof check.id === "string" ? check.id : "",
    ok: Boolean(check.ok),
    optional: Boolean(check.optional),
    detail: typeof check.detail === "string" ? check.detail : "",
    reasonCodes: Array.isArray(check.reasonCodes)
      ? check.reasonCodes.filter((code) => typeof code === "string")
      : [],
  }));
};

const buildAdapterFromWebHtml = (html, options = {}) => {
  const pageId = typeof options.pageId === "string" && options.pageId ? options.pageId : DEFAULT_PAGE_ID;
  const inputHtml = typeof html === "string" ? html : "";
  const blockify = runImportBlockifyV1(inputHtml, pageId);
  if (!blockify.ok) {
    return { ok: false, issues: blockify.errors || [] };
  }

  const snapshot = buildSnapshotFromPlan(inputHtml, blockify.plan.blocks || [], pageId);
  const validation = validateImportSnapshotV0(snapshot);
  if (!validation.ok) {
    return { ok: false, issues: validation.issues || [] };
  }

  const snapshotDigest = digestImportSnapshotV0(snapshot);
  let report = options.integrityReport;
  let dropped = options.integrityDropped;

  if (!report || !isRecord(report)) {
    const scan = buildIntegrityReportV0({
      html: inputHtml,
      snapshotDigest,
      blockId: typeof options.blockId === "string" ? options.blockId : "",
      blockDigest: typeof options.blockDigest === "string" ? options.blockDigest : "",
      interactionDigest: typeof options.interactionDigest === "string" ? options.interactionDigest : "",
      pulses: Array.isArray(options.pulses) ? options.pulses : [],
      issues: Array.isArray(options.scanIssues) ? options.scanIssues : [],
    });
    report = scan.report;
    dropped = scan.dropped;
  }

  const capCounts = report && report.capCounts ? report.capCounts : {};
  const verdict = report && typeof report.status === "string" ? report.status : "WARN";
  const reasonCodes = report && Array.isArray(report.reasonCodes) ? report.reasonCodes : ["INTEGRITY_REPORT_MISSING"];
  const scars = verdict === "DENY" ? ["INTEGRITY_DENY"] : verdict === "WARN" ? ["INTEGRITY_WARN"] : [];
  const pointers = [snapshotDigest, report && report.digest].filter(Boolean).map((d) => `digest:${d}`);

  const adapter = canonicalizeAdapterV0({
    schema: "weftend.adapter/0",
    profile: "web",
    verdict,
    reasonCodes,
    digests: {
      inputDigest: digestString(normalizeHtml(inputHtml)),
      snapshotDigest,
      reportDigest: report && report.digest ? report.digest : "",
    },
    caps: {
      denied: typeof capCounts.capDeny === "number" ? capCounts.capDeny : 0,
      attempted: typeof capCounts.capRequest === "number" ? capCounts.capRequest : 0,
    },
    scars,
    proofPointers: pointers,
  });

  return {
    ok: true,
    adapter,
    snapshot,
    report,
    dropped,
  };
};

const buildAdapterFromReleaseInspection = (inspection) => {
  if (!inspection || inspection.ok !== true) {
    const code = inspection && inspection.code ? String(inspection.code) : "RELEASE_INSPECTION_FAILED";
    const adapter = canonicalizeAdapterV0({
      schema: "weftend.adapter/0",
      profile: "release",
      verdict: "DENY",
      reasonCodes: [code],
      digests: { inputDigest: digestString(code) },
      caps: { denied: 0, attempted: 0 },
      scars: [],
      proofPointers: [],
    });
    return { ok: false, adapter, issues: inspection && inspection.message ? [inspection.message] : [] };
  }

  const summary = summarizeReleaseChecks(inspection.checks);
  let deny = false;
  let warn = false;
  const reasonCodes = [];
  const scars = [];
  const pointers = [];

  summary.forEach((check) => {
    if (!check.ok) {
      if (check.optional) warn = true;
      else deny = true;
      if (check.id) pointers.push(check.id);
    }
    if (Array.isArray(check.reasonCodes)) {
      check.reasonCodes.forEach((code) => {
        if (typeof code === "string") reasonCodes.push(code);
        if (typeof code === "string" && code.includes("RECOVERED")) scars.push(code);
      });
    }
  });

  const verdict = deny ? "DENY" : warn ? "WARN" : "OK";
  const digestBasis = canonicalJSON({ checks: summary });
  const inputDigest = digestString(digestBasis);

  const adapter = canonicalizeAdapterV0({
    schema: "weftend.adapter/0",
    profile: "release",
    verdict,
    reasonCodes: reasonCodes.length ? reasonCodes : verdict === "OK" ? [] : ["RELEASE_CHECK_FAILED"],
    digests: { inputDigest, reportDigest: inputDigest },
    caps: { denied: 0, attempted: 0 },
    scars,
    proofPointers: pointers,
  });

  return { ok: verdict === "OK", adapter, inspection };
};

const buildAdapterFromReleaseDir = async (releaseDir, options = {}) => {
  if (!options.fetchRelease) {
    return {
      ok: false,
      adapter: canonicalizeAdapterV0({
        schema: "weftend.adapter/0",
        profile: "release",
        verdict: "DENY",
        reasonCodes: ["RELEASE_FETCH_UNAVAILABLE"],
        digests: { inputDigest: digestString("RELEASE_FETCH_UNAVAILABLE") },
        caps: { denied: 0, attempted: 0 },
        scars: [],
        proofPointers: [],
      }),
    };
  }
  const inspection = await options.fetchRelease(releaseDir);
  return buildAdapterFromReleaseInspection(inspection);
};

export {
  buildAdapterFromWebHtml,
  buildAdapterFromReleaseInspection,
  buildAdapterFromReleaseDir,
};
