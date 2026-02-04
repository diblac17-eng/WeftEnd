// test/harness/clinic_v1.ts
// Clinic v1 UI (harness-only, deterministic exam).

import { canonicalJSON } from "./adapter_v0.ts";
import {
  buildAdapterFromWebHtml,
  buildAdapterFromReleaseInspection,
} from "./clinic_v1_core.ts";
import { buildIntegrityScanSrcdoc, buildIntegrityReportV0 } from "../../integrity_scan_v0.ts";

const profileInputs = Array.from(document.querySelectorAll("input[name=\"clinic-profile\"]"));
const webPane = document.getElementById("clinic-web");
const releasePane = document.getElementById("clinic-release");
const htmlInput = document.getElementById("clinic-html");
const htmlFile = document.getElementById("clinic-html-file");
const releaseDir = document.getElementById("clinic-release-dir");
const runBtn = document.getElementById("clinic-run");
const runStatus = document.getElementById("clinic-run-status");
const issuesEl = document.getElementById("clinic-issues");
const statusEl = document.getElementById("clinic-status");
const summaryEl = document.getElementById("clinic-summary");
const reasonsEl = document.getElementById("clinic-reasons");
const digestsEl = document.getElementById("clinic-digests");
const notesEl = document.getElementById("clinic-notes");
const exportBtn = document.getElementById("clinic-export");
const copyBtn = document.getElementById("clinic-copy");
const copyCompactBtn = document.getElementById("clinic-copy-compact");
const copyHumanBtn = document.getElementById("clinic-copy-human");
const copyStatus = document.getElementById("clinic-copy-status");
const openImport = document.getElementById("clinic-open-import");
const openPortal = document.getElementById("clinic-open-portal");

let currentAdapter = null;
let currentSummary = "";

const setProfile = (profile) => {
  const isWeb = profile === "web";
  if (webPane) webPane.classList.toggle("clinic-hidden", !isWeb);
  if (releasePane) releasePane.classList.toggle("clinic-hidden", isWeb);
  if (openImport) openImport.classList.toggle("clinic-hidden", !isWeb);
  if (openPortal) openPortal.classList.toggle("clinic-hidden", isWeb);
};

const readFileText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const setStatusPill = (status) => {
  if (!statusEl) return;
  statusEl.textContent = status;
  statusEl.classList.remove("ok", "warn", "fail");
  if (status === "OK") statusEl.classList.add("ok");
  else if (status === "WARN") statusEl.classList.add("warn");
  else if (status === "DENY" || status === "QUARANTINE") statusEl.classList.add("fail");
};

const renderList = (el, items) => {
  if (!el) return;
  el.innerHTML = "";
  const list = Array.isArray(items) ? items : [];
  list.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
};

const renderIssues = (items) => {
  if (!issuesEl) return;
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    issuesEl.textContent = "";
    return;
  }
  issuesEl.textContent = list
    .map((issue) => {
      if (typeof issue === "string") return issue;
      if (!issue) return "";
      const path = issue.path ? `${issue.path}: ` : "";
      return `${path}${issue.code || "ISSUE"} ${issue.message || ""}`.trim();
    })
    .filter(Boolean)
    .join(" | ");
};

const buildSummary = (adapter) => {
  if (!adapter) return "";
  const reasons = Array.isArray(adapter.reasonCodes) ? adapter.reasonCodes : [];
  const caps = adapter.caps || { denied: 0, attempted: 0 };
  return [
    `Profile: ${adapter.profile}`,
    `Verdict: ${adapter.verdict}`,
    `Denied caps: ${caps.denied || 0} | Attempted: ${caps.attempted || 0}`,
    `Reasons: ${reasons.length ? reasons.join(", ") : "none"}`,
    `Input digest: ${adapter.digests?.inputDigest || "-"}`,
    `Snapshot digest: ${adapter.digests?.snapshotDigest || "-"}`,
    `Report digest: ${adapter.digests?.reportDigest || "-"}`,
  ].join("\n");
};

const renderAdapter = (adapter) => {
  currentAdapter = adapter;
  currentSummary = buildSummary(adapter);
  setStatusPill(adapter ? adapter.verdict : "UNKNOWN");
  if (summaryEl) summaryEl.textContent = currentSummary || "No adapter.";
  renderList(reasonsEl, adapter?.reasonCodes || []);
  if (digestsEl) {
    const input = adapter?.digests?.inputDigest || "-";
    const snap = adapter?.digests?.snapshotDigest || "-";
    const report = adapter?.digests?.reportDigest || "-";
    digestsEl.textContent = `input: ${input}\nsnapshot: ${snap}\nreport: ${report}`;
  }
  if (notesEl) notesEl.textContent = adapter?.notes ? `notes: ${adapter.notes}` : "";
  if (exportBtn) exportBtn.disabled = !adapter;
  if (copyBtn) copyBtn.disabled = !adapter;
  if (copyCompactBtn) copyCompactBtn.disabled = !adapter;
  if (copyHumanBtn) copyHumanBtn.disabled = !adapter;
  if (copyStatus) copyStatus.textContent = "";
};

const copyText = (text) => {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "true");
  el.style.position = "absolute";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
};

const runIntegrityScan = (html, snapshotDigest) =>
  new Promise((resolve) => {
    const srcdoc = buildIntegrityScanSrcdoc(html, []);
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.setAttribute("sandbox", "allow-scripts");
    document.body.appendChild(frame);

    const handler = (evt) => {
      if (!evt || evt.source !== frame.contentWindow) return;
      const data = evt.data || {};
      if (data.kind !== "weftend.integrity.v0") return;
      window.removeEventListener("message", handler);
      frame.remove();
      const payload = buildIntegrityReportV0({
        html,
        snapshotDigest,
        pulses: data.pulses || [],
        issues: data.issues || [],
      });
      resolve(payload);
    };

    window.addEventListener("message", handler);
    frame.srcdoc = srcdoc;
  });

const runWebExam = async () => {
  const html = htmlInput ? htmlInput.value : "";
  if (!html || !html.trim()) {
    renderIssues([{ code: "INPUT_EMPTY", message: "Paste or load HTML first." }]);
    return;
  }
  renderIssues([]);
  const pre = buildAdapterFromWebHtml(html, {});
  if (!pre.ok) {
    renderIssues(pre.issues || []);
    return;
  }
  const snapshotDigest = pre.adapter?.digests?.snapshotDigest || "";
  const scan = await runIntegrityScan(html, snapshotDigest);
  const final = buildAdapterFromWebHtml(html, { integrityReport: scan.report });
  if (!final.ok) {
    renderIssues(final.issues || []);
    return;
  }
  renderAdapter(final.adapter);
};

const runReleaseExam = async () => {
  const dir = releaseDir ? String(releaseDir.value || "").trim() : "";
  if (!dir) {
    renderIssues([{ code: "RELEASE_DIR_MISSING", message: "Enter a release folder path." }]);
    return;
  }
  renderIssues([]);
  const url = `/__harness/release-folder?dir=${encodeURIComponent(dir)}`;
  let payload = null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    payload = await res.json();
  } catch (err) {
    renderIssues([{ code: "RELEASE_FETCH_FAILED", message: "Release folder inspection failed." }]);
    return;
  }
  const result = buildAdapterFromReleaseInspection(payload);
  renderAdapter(result.adapter);
};

const runExam = async () => {
  if (runBtn) runBtn.disabled = true;
  if (runStatus) runStatus.textContent = "Running exam...";
  renderAdapter(null);
  try {
    const profile = profileInputs.find((input) => input.checked)?.value || "web";
    setProfile(profile);
    if (profile === "release") {
      await runReleaseExam();
    } else {
      await runWebExam();
    }
  } finally {
    if (runBtn) runBtn.disabled = false;
    if (runStatus) runStatus.textContent = "Idle.";
  }
};

const exportAdapter = () => {
  if (!currentAdapter) return;
  const payload = canonicalJSON(currentAdapter);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "weftend_adapter_v0.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const copySummary = () => {
  if (!currentSummary) return;
  copyText(currentSummary);
  if (copyStatus) copyStatus.textContent = "Copied.";
};

const copyAdapterCompact = () => {
  if (!currentAdapter) return;
  copyText(canonicalJSON(currentAdapter));
  if (copyStatus) copyStatus.textContent = "Copied.";
};

const copyAdapterHuman = () => {
  if (!currentAdapter) return;
  const reasons = Array.isArray(currentAdapter.reasonCodes) ? currentAdapter.reasonCodes.slice(0, 3) : [];
  const caps = currentAdapter.caps || { denied: 0, attempted: 0 };
  const lines = [
    `verdict: ${currentAdapter.verdict || "-"}`,
    `reasons: ${reasons.length ? reasons.join(", ") : "none"}`,
    `input: ${currentAdapter.digests?.inputDigest || "-"}`,
    `snapshot: ${currentAdapter.digests?.snapshotDigest || "-"}`,
    `report: ${currentAdapter.digests?.reportDigest || "-"}`,
    `caps: denied=${caps.denied || 0} attempted=${caps.attempted || 0}`,
    `scars: ${Array.isArray(currentAdapter.scars) ? currentAdapter.scars.length : 0}`,
  ];
  copyText(lines.join("\n"));
  if (copyStatus) copyStatus.textContent = "Copied.";
};

profileInputs.forEach((input) => {
  input.addEventListener("change", () => setProfile(input.value));
});

if (htmlFile) {
  htmlFile.addEventListener("change", async () => {
    if (!htmlInput || !htmlFile.files || htmlFile.files.length === 0) return;
    const file = htmlFile.files[0];
    const text = await readFileText(file);
    htmlInput.value = text;
  });
}

if (runBtn) runBtn.addEventListener("click", () => runExam());
if (exportBtn) exportBtn.addEventListener("click", exportAdapter);
if (copyBtn) copyBtn.addEventListener("click", copySummary);
if (copyCompactBtn) copyCompactBtn.addEventListener("click", copyAdapterCompact);
if (copyHumanBtn) copyHumanBtn.addEventListener("click", copyAdapterHuman);

setProfile("web");
setStatusPill("UNKNOWN");
renderAdapter(null);
