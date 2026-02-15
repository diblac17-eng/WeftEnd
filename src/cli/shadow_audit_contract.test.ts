/* src/cli/shadow_audit_contract.test.ts */

import { canonicalJSON } from "../core/canon";
import { runCliCapture } from "./cli_test_runner";

declare const require: any;
declare const process: any;

const fs = require("fs");
const path = require("path");

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
};

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "shadow_audit");

const loadJson = (name: string): any => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));

const assertCanonicalEq = (actual: unknown, expected: unknown, msg: string): void => {
  const a = canonicalJSON(actual);
  const e = canonicalJSON(expected);
  if (a !== e) {
    throw new Error(`${msg}\n--- actual ---\n${a}\n--- expected ---\n${e}`);
  }
};

const assertSortedUnique = (arr: string[], msg: string): void => {
  const sorted = [...arr].sort();
  assertEq(canonicalJSON(arr), canonicalJSON(sorted), `${msg}: expected sorted`);
  assertEq(new Set(arr).size, arr.length, `${msg}: expected unique`);
};

const run = async (): Promise<void> => {
  const cases: Array<{ req: string; expected: string; status: number; name: string }> = [
    { name: "ok", req: "ok_request_a.json", expected: "ok_expected.json", status: 0 },
    { name: "warn", req: "warn_request.json", expected: "warn_expected.json", status: 0 },
    { name: "deny_threshold", req: "deny_threshold_request.json", expected: "deny_threshold_expected.json", status: 40 },
    { name: "deny_privacy", req: "deny_privacy_request.json", expected: "deny_privacy_expected.json", status: 40 },
    {
      name: "schema_invalid_stream_nonce",
      req: "schema_invalid_stream_nonce_request.json",
      expected: "schema_invalid_stream_nonce_expected.json",
      status: 40,
    },
    {
      name: "schema_invalid_threshold_key",
      req: "schema_invalid_threshold_key_request.json",
      expected: "schema_invalid_threshold_key_expected.json",
      status: 40,
    },
    {
      name: "schema_invalid_request_unknown_key",
      req: "schema_invalid_request_unknown_key_request.json",
      expected: "schema_invalid_request_unknown_key_expected.json",
      status: 40,
    },
    {
      name: "schema_invalid_stream_unknown_key",
      req: "schema_invalid_stream_unknown_key_request.json",
      expected: "schema_invalid_stream_unknown_key_expected.json",
      status: 40,
    },
    {
      name: "schema_invalid_policy_type",
      req: "schema_invalid_policy_type_request.json",
      expected: "schema_invalid_policy_type_expected.json",
      status: 40,
    },
    {
      name: "schema_invalid_event_unknown_key",
      req: "schema_invalid_event_unknown_key_request.json",
      expected: "schema_invalid_event_unknown_key_expected.json",
      status: 40,
    },
    {
      name: "privacy_key_alias",
      req: "privacy_key_alias_request.json",
      expected: "privacy_key_alias_expected.json",
      status: 40,
    },
    {
      name: "privacy_hostname_value",
      req: "privacy_hostname_value_request.json",
      expected: "privacy_hostname_value_expected.json",
      status: 40,
    },
    {
      name: "privacy_time_alias_key",
      req: "privacy_time_alias_key_request.json",
      expected: "privacy_time_alias_key_expected.json",
      status: 40,
    },
    { name: "bounds_events", req: "bounds_events_request.json", expected: "bounds_events_expected.json", status: 40 },
    {
      name: "bounds_event_keys",
      req: "bounds_event_keys_request.json",
      expected: "bounds_event_keys_expected.json",
      status: 40,
    },
    {
      name: "tartarus_bounds",
      req: "tartarus_bounds_request.json",
      expected: "tartarus_bounds_expected.json",
      status: 40,
    },
    { name: "cap_warn", req: "cap_warn_request.json", expected: "cap_warn_expected.json", status: 0 },
    { name: "sequence_warn", req: "sequence_warn_request.json", expected: "sequence_warn_expected.json", status: 0 },
    {
      name: "sequence_deny_threshold",
      req: "sequence_deny_threshold_request.json",
      expected: "sequence_deny_threshold_expected.json",
      status: 40,
    },
    {
      name: "cap_deny_threshold",
      req: "cap_deny_threshold_request.json",
      expected: "cap_deny_threshold_expected.json",
      status: 40,
    },
  ];

  for (const tc of cases) {
    const reqPath = path.join(fixtureRoot, tc.req);
    const expected = loadJson(tc.expected);
    const res = await runCliCapture(["shadow-audit", reqPath]);
    assertEq(res.status, tc.status, `shadow-audit ${tc.name} status mismatch`);
    const parsed = JSON.parse(res.stdout);
    assertCanonicalEq(parsed, expected, `shadow-audit ${tc.name} payload mismatch`);
    assert(Array.isArray(parsed.reasonFamilies), `${tc.name}: reasonFamilies missing`);
    assertSortedUnique(parsed.reasonFamilies, `${tc.name}: reasonFamilies order`);
    assert(!("events" in parsed), `${tc.name}: proof-only output must not include raw events`);
    assert(!("stream" in parsed), `${tc.name}: proof-only output must not include raw stream`);
    assert(!("request" in parsed), `${tc.name}: proof-only output must not include raw request`);
  }

  const reqA = path.join(fixtureRoot, "ok_request_a.json");
  const reqB = path.join(fixtureRoot, "ok_request_b.json");
  const resA = await runCliCapture(["shadow-audit", reqA]);
  const resB = await runCliCapture(["shadow-audit", reqB]);
  assertEq(resA.status, 0, "ok_request_a should pass");
  assertEq(resB.status, 0, "ok_request_b should pass");
  assertEq(resA.stdout, resB.stdout, "ok request A/B outputs should be byte-identical under shuffle/nonce variance");
};

run()
  .then(() => {
    console.log("shadow_audit_contract.test: PASS");
  })
  .catch((error) => {
    console.error("shadow_audit_contract.test: FAIL");
    console.error(error);
    process.exit(1);
  });
