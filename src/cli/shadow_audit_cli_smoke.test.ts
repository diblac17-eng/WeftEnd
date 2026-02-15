/* src/cli/shadow_audit_cli_smoke.test.ts */

import { runCliCapture } from "./cli_test_runner";

declare const require: any;
declare const process: any;

const fs = require("fs");
const os = require("os");
const path = require("path");

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
};

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "weftend-shadow-audit-"));

const writeJson = (dir: string, name: string, value: unknown): string => {
  const out = path.join(dir, name);
  fs.writeFileSync(out, JSON.stringify(value, null, 2), "utf8");
  return out;
};

const baseRequest = (events: unknown[], extra?: Record<string, unknown>): Record<string, unknown> => ({
  schema: "weftend.shadowAudit.request/0",
  v: 0,
  rulesetId: "SHADOW_RULESET_V0",
  stream: {
    schema: "weftend.shadowAudit.stream/0",
    v: 0,
    events,
  },
  ...(extra || {}),
});

const run = async (): Promise<void> => {
  {
    const dir = mkTmp();
    const eventsA = [
      { seq: 1, kind: "STATE_CHECK", side: "expected", data: { code: "CHECK_A" } },
      { seq: 1, kind: "STATE_CHECK", side: "observed", data: { code: "CHECK_A" } },
      { seq: 2, kind: "CAP_REQUEST", data: { capId: "cap.read" } },
      { seq: 3, kind: "CAP_ALLOW", data: { capId: "cap.read", evidenceOk: true, reasonCodes: ["RC_OK"] } },
    ];
    const eventsB = [eventsA[3], eventsA[1], eventsA[0], eventsA[2]];
    const reqA = writeJson(dir, "req_a.json", baseRequest(eventsA));
    const reqB = writeJson(dir, "req_b.json", baseRequest(eventsB));
    const resA = await runCliCapture(["shadow-audit", reqA]);
    const resB = await runCliCapture(["shadow-audit", reqB]);
    assertEq(resA.status, 0, `shadow-audit should pass\n${resA.stderr}`);
    assertEq(resB.status, 0, `shadow-audit shuffle should pass\n${resB.stderr}`);
    assertEq(resA.stdout, resB.stdout, "shadow-audit output should be deterministic under shuffle");
    const parsed = JSON.parse(resA.stdout);
    assertEq(parsed.status, "OK", "shadow-audit expected OK status");
    assert(Array.isArray(parsed.reasonFamilies) && parsed.reasonFamilies.length === 0, "reasonFamilies should be empty");
    assert(!("events" in parsed), "proof-only output must not include raw events");
    assert(!("stream" in parsed), "proof-only output must not include raw stream");
    assert(!("request" in parsed), "proof-only output must not include raw request");
  }

  {
    const dir = mkTmp();
    const events = [{ seq: 1, kind: "STATE_CHECK", side: "expected", data: { code: "CHECK_A" } }];
    const reqA = writeJson(dir, "nonce_a.json", baseRequest(events, { stream: { schema: "weftend.shadowAudit.stream/0", v: 0, streamNonce: "nonce_A", events } }));
    const reqB = writeJson(dir, "nonce_b.json", baseRequest(events, { stream: { schema: "weftend.shadowAudit.stream/0", v: 0, streamNonce: "nonce_B", events } }));
    const resA = await runCliCapture(["shadow-audit", reqA]);
    const resB = await runCliCapture(["shadow-audit", reqB]);
    assertEq(resA.status, 0, "shadow-audit nonce A should pass");
    assertEq(resB.status, 0, "shadow-audit nonce B should pass");
    assertEq(resA.stdout, resB.stdout, "streamNonce must not affect deterministic proof output");
  }

  {
    const dir = mkTmp();
    const req = writeJson(
      dir,
      "nonce_invalid.json",
      baseRequest([{ seq: 1, kind: "STATE_CHECK" }], {
        stream: {
          schema: "weftend.shadowAudit.stream/0",
          v: 0,
          streamNonce: "http://bad.example/nonce",
          events: [{ seq: 1, kind: "STATE_CHECK" }],
        },
      })
    );
    const res = await runCliCapture(["shadow-audit", req]);
    assertEq(res.status, 40, "invalid streamNonce should fail closed");
    const parsed = JSON.parse(res.stdout);
    assertEq(parsed.status, "DENY", "invalid streamNonce status should be DENY");
    assert(parsed.reasonFamilies.includes("SHADOW_AUDIT_SCHEMA_INVALID"), "expected SHADOW_AUDIT_SCHEMA_INVALID");
  }

  {
    const dir = mkTmp();
    const badPath = path.join(dir, "bad.json");
    fs.writeFileSync(badPath, "{ this is not json", "utf8");
    const res = await runCliCapture(["shadow-audit", badPath]);
    assertEq(res.status, 40, "invalid JSON should fail closed");
    const parsed = JSON.parse(res.stdout);
    assertEq(parsed.status, "DENY", "invalid JSON status should be DENY");
    assert(parsed.reasonFamilies.includes("SHADOW_AUDIT_SCHEMA_INVALID"), "expected SHADOW_AUDIT_SCHEMA_INVALID");
  }

  {
    const dir = mkTmp();
    const req = writeJson(
      dir,
      "privacy_bad.json",
      baseRequest([{ seq: 1, kind: "STATE_CHECK", side: "expected", data: { userId: "u123" } }])
    );
    const res = await runCliCapture(["shadow-audit", req]);
    assertEq(res.status, 40, "privacy-forbidden request should fail closed");
    const parsed = JSON.parse(res.stdout);
    assertEq(parsed.status, "DENY", "privacy-forbidden status should be DENY");
    assert(parsed.reasonFamilies.includes("SHADOW_AUDIT_PRIVACY_FORBIDDEN"), "expected SHADOW_AUDIT_PRIVACY_FORBIDDEN");
  }

  {
    const dir = mkTmp();
    const req = writeJson(
      dir,
      "threshold_deny.json",
      baseRequest(
        [{ seq: 10, kind: "STATE_CHECK", side: "expected", data: { code: "CHECK_ONLY_EXPECTED" } }],
        { policy: { denyThresholds: { missing: 0 } } }
      )
    );
    const res = await runCliCapture(["shadow-audit", req]);
    assertEq(res.status, 40, "threshold-exceeded request should fail closed");
    const parsed = JSON.parse(res.stdout);
    assertEq(parsed.status, "DENY", "threshold-exceeded status should be DENY");
    assert(parsed.reasonFamilies.includes("SHADOW_AUDIT_MISSING"), "expected SHADOW_AUDIT_MISSING");
  }

  {
    const dir = mkTmp();
    const events = [];
    for (let i = 0; i < 520; i += 1) events.push({ seq: i, kind: "STREAM_EVENT" });
    const req = writeJson(dir, "bounded.json", baseRequest(events));
    const res = await runCliCapture(["shadow-audit", req]);
    assertEq(res.status, 40, "bounds-exceeded request should fail closed");
    const parsed = JSON.parse(res.stdout);
    assertEq(parsed.counts.events, 512, "events should be truncated to max");
    assert(parsed.reasonFamilies.includes("SHADOW_AUDIT_BOUNDS_EXCEEDED"), "expected SHADOW_AUDIT_BOUNDS_EXCEEDED");
  }
};

run()
  .then(() => {
    console.log("shadow_audit_cli_smoke.test: PASS");
  })
  .catch((error) => {
    console.error("shadow_audit_cli_smoke.test: FAIL");
    console.error(error);
    process.exit(1);
  });
