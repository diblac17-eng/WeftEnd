// src/engine/portal_model.test.ts
// PortalModel v0 tests (deterministic, proof-only).

import { buildPortalModel } from "./portal_model";
import type { PortalModelInput } from "./portal_model";


type TestFn = () => void;

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    fail(`${msg}
Expected: ${String(expected)}
Actual: ${String(actual)}`);
  }
}

const g: any = globalThis as any;
const hasBDD = typeof g.describe === "function" && typeof g.it === "function";
const localTests: Array<{ name: string; fn: TestFn }> = [];

function register(name: string, fn: TestFn): void {
  if (hasBDD) g.it(name, fn);
  else localTests.push({ name, fn });
}

function suite(name: string, define: () => void): void {
  if (hasBDD) g.describe(name, define);
  else define();
}

suite("engine/portal_model v0", () => {
  register("buildPortalModel sorts blocks, caps, and reasons deterministically", () => {
    const input: PortalModelInput = {
      planDigest: "plan-1",
      blocks: [
        {
          blockHash: "block-b",
          executionMode: "strict",
          requestedCaps: ["storage.read", "net.fetch"],
          eligibleCaps: ["storage.read"],
          deniedCaps: [{ capId: "net.fetch", reasonCodes: ["Z_REASON", "A_REASON"] }],
          evidenceRecords: [
            { kind: "signature.v1", payload: { sig: "s" }, meta: { issuedBy: "issuer-b" } },
            { kind: "hash.v1", payload: { h: "x" }, meta: { issuedBy: "issuer-a" } },
          ],
          verifyResult: { status: "VERIFIED" },
        },
        {
          blockHash: "block-a",
          executionMode: "compatible",
          requestedCaps: ["net.fetch"],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "UNVERIFIED", reasonCodes: ["Z_FAIL", "A_FAIL"] },
        },
      ],
    };

    const model = buildPortalModel(input);
    assertEq(model.blocks[0].blockHash, "block-a", "blocks should be sorted by blockHash");
    assertEq(model.blocks[1].blockHash, "block-b", "blocks should be sorted by blockHash");
    assertEq(model.blocks[1].requestedCaps.join(","), "net.fetch,storage.read", "requestedCaps must be sorted");
    assertEq(model.blocks[1].deniedCaps[0].reasonCodes.join(","), "A_REASON,Z_REASON", "denied reason codes sorted");
    assertEq(model.blocks[0].reasonCodes?.join(","), "A_FAIL,Z_FAIL", "verify reason codes sorted");
    const kinds = model.blocks[1].evidence.map((e: any) => e.evidenceKind).join(",");
    assertEq(kinds, "hash.v1,signature.v1", "evidence summaries sorted by kind");
  });

  register("buildPortalModel never includes raw evidence payloads", () => {
    const secret = "SUPER_SECRET_TOKEN";
    const input: PortalModelInput = {
      planDigest: "plan-2",
      blocks: [
        {
          blockHash: "block-x",
          executionMode: "strict",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [
            { kind: "hash.v1", payload: { secretB64: secret, note: "keep" } },
          ],
          verifyResult: { status: "VERIFIED" },
        },
      ],
    };

    const model = buildPortalModel(input);
    const json = JSON.stringify(model);
    assert(!json.includes(secret), "model must not contain secret payload values");
    assert(!json.includes("secretB64"), "model must not contain secret payload keys");
  });

  register("buildPortalModel renders per-cap evidence status deterministically", () => {
    const input: PortalModelInput = {
      planDigest: "plan-8",
      blocks: [
        {
          blockHash: "block-cap",
          executionMode: "strict",
          requestedCaps: ["id.sign"],
          eligibleCaps: [],
          deniedCaps: [
            { capId: "id.sign", reasonCodes: ["KEY_REVOKED"] },
          ],
          evidenceRecords: [
            { kind: "key.status.v1", payload: { status: "revoked" } },
          ],
          evidenceResults: [
            { evidenceId: "e1", kind: "key.status.v1", status: "UNVERIFIED", reasonCodes: ["KEY_REVOKED"], verifierId: "key.status" },
          ],
          capEvidenceRequirements: [
            {
              capId: "id.sign",
              requires: {
                kind: "allOf",
                items: [
                  { kind: "evidence", evidenceKind: "key.status.v1" },
                  { kind: "evidence", evidenceKind: "user.consent.v1" },
                ],
              },
            },
          ],
          verifyResult: { status: "UNVERIFIED", reasonCodes: ["EVIDENCE_MISSING"] },
        },
      ],
    };

    const model = buildPortalModel(input);
    const capEvidence = model.blocks[0].capEvidence || [];
    assertEq(capEvidence.length, 1, "expected cap evidence summary");
    assertEq(capEvidence[0].capId, "id.sign", "expected id.sign cap");
    const kinds = capEvidence[0].evidence.map((e: any) => e.evidenceKind).join(",");
    assertEq(kinds, "key.status.v1,user.consent.v1", "expected sorted evidence kinds");
    const keyStatus = capEvidence[0].evidence.find((e: any) => e.evidenceKind === "key.status.v1");
    const consent = capEvidence[0].evidence.find((e: any) => e.evidenceKind === "user.consent.v1");
    assertEq(keyStatus?.status, "UNVERIFIED", "expected key.status unverified");
    assertEq(keyStatus?.reasonCodes?.join(","), "KEY_REVOKED", "expected key.status reason");
    assertEq(consent?.status, "MISSING", "expected consent missing");
    assertEq(
      consent?.reasonCodes?.join(","),
      "EVIDENCE_MISSING:user.consent.v1",
      "expected missing consent reason"
    );
  });

  register("buildPortalModel marks missing verification as UNVERIFIED and reports mode warnings", () => {
    const input: PortalModelInput = {
      planDigest: "plan-3",
      blocks: [
        {
          blockHash: "block-z",
          executionMode: "legacy",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
        },
      ],
    };

    const model = buildPortalModel(input);
    assertEq(model.blocks[0].renderState, "UNVERIFIED", "missing verifyResult should be UNVERIFIED");
    assert(model.blocks[0].reasonCodes?.includes("VERIFICATION_MISSING"), "expected VERIFICATION_MISSING");
    assertEq(model.summary.modes.legacy, 1, "legacy count should be 1");
    assert(model.warnings?.includes("UNGOVERNED_LEGACY"), "expected UNGOVERNED_LEGACY warning");
    if (model.warnings) {
      const sorted = [...model.warnings].sort();
      assertEq(JSON.stringify(model.warnings), JSON.stringify(sorted), "warnings must be sorted");
    }
  });

  register("buildPortalModel warns on compatible mode without strict warnings", () => {
    const input: PortalModelInput = {
      planDigest: "plan-compat",
      blocks: [
        {
          blockHash: "block-c",
          executionMode: "compatible",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "VERIFIED" },
        },
      ],
    };

    const model = buildPortalModel(input);
    assertEq(model.summary.modes.compatible, 1, "compatible count should be 1");
    assert(model.warnings?.includes("UNGOVERNED_COMPATIBLE_MODE"), "expected UNGOVERNED_COMPATIBLE_MODE warning");
    if (model.warnings) {
      const sorted = [...model.warnings].sort();
      assertEq(JSON.stringify(model.warnings), JSON.stringify(sorted), "warnings must be sorted");
    }
  });

  register("buildPortalModel defaults stampStatus to UNSTAMPED", () => {
    const input: PortalModelInput = {
      planDigest: "plan-5",
      blocks: [
        {
          blockHash: "block-s",
          executionMode: "strict",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "VERIFIED" },
        },
      ],
    };

    const model = buildPortalModel(input);
    assertEq(model.blocks[0].stampStatus, "UNSTAMPED", "expected UNSTAMPED default");
  });

  register("buildPortalModel defaults stampSigStatus to UNVERIFIED", () => {
    const input: PortalModelInput = {
      planDigest: "plan-6",
      blocks: [
        {
          blockHash: "block-sig",
          executionMode: "strict",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "VERIFIED" },
        },
      ],
    };

    const model = buildPortalModel(input);
    assertEq(model.blocks[0].stampSigStatus, "UNVERIFIED", "expected UNVERIFIED default");
  });

  register("buildPortalModel warns on runtime stamp mismatches and sorts warnings", () => {
    const input: PortalModelInput = {
      planDigest: "plan-7",
      blocks: [
        {
          blockHash: "block-b",
          executionMode: "strict",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "VERIFIED" },
          stampStatus: "STAMP_VERIFIED",
          stampSigStatus: "OK",
          runtimeObservedStamp: {
            status: "STAMP_INVALID",
            sigStatus: "BAD",
            reasonCodes: ["Z_CODE", "A_CODE"],
          },
        },
        {
          blockHash: "block-a",
          executionMode: "strict",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "VERIFIED" },
          stampStatus: "UNSTAMPED",
          stampSigStatus: "UNVERIFIED",
          runtimeObservedStamp: {
            status: "STAMP_VERIFIED",
            sigStatus: "OK",
            reasonCodes: ["B_CODE"],
          },
        },
      ],
    };

    const model = buildPortalModel(input);
    const warnings = model.warnings || [];
    assert(warnings.length >= 5, "expected mismatch warnings");
    assert(warnings.includes("RUNTIME_PROOF_MISMATCH"), "expected RUNTIME_PROOF_MISMATCH warning");
    assert(
      warnings.includes("RUNTIME_PROOF_MISMATCH:STAMP_STATUS:block-a:UNSTAMPED->STAMP_VERIFIED:B_CODE"),
      "expected block-a stamp status mismatch detail"
    );
    assert(
      warnings.includes("RUNTIME_PROOF_MISMATCH:STAMP_SIG_STATUS:block-a:UNVERIFIED->OK:B_CODE"),
      "expected block-a stamp sig mismatch detail"
    );
    assert(
      warnings.includes("RUNTIME_PROOF_MISMATCH:STAMP_STATUS:block-b:STAMP_VERIFIED->STAMP_INVALID:A_CODE|Z_CODE"),
      "expected block-b stamp status mismatch detail"
    );
    assert(
      warnings.includes("RUNTIME_PROOF_MISMATCH:STAMP_SIG_STATUS:block-b:OK->BAD:A_CODE|Z_CODE"),
      "expected block-b stamp sig mismatch detail"
    );
    const sorted = [...warnings].sort();
    assertEq(JSON.stringify(warnings), JSON.stringify(sorted), "warnings must be sorted");
    const blockB = model.blocks.find((b: any) => b.blockHash === "block-b");
    assert(blockB, "expected block-b");
    assertEq(
      blockB?.runtimeObservedStamp?.reasonCodes?.join(","),
      "A_CODE,Z_CODE",
      "expected sorted runtimeObserved reasonCodes"
    );
  });

  register("buildPortalModel preserves and sorts global warnings", () => {
    const input: PortalModelInput = {
      planDigest: "plan-4",
      globalWarnings: [
        "STRICT_MODE_UNAVAILABLE",
        "STRICT_SELFTEST_FAILED:STRICT_COMPARTMENT_UNAVAILABLE",
        "STRICT_MODE_UNAVAILABLE",
      ],
      blocks: [
        {
          blockHash: "block-1",
          executionMode: "compatible",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "UNVERIFIED" },
        },
      ],
    };

    const model = buildPortalModel(input);
    assert(model.warnings?.includes("STRICT_MODE_UNAVAILABLE"), "expected STRICT_MODE_UNAVAILABLE warning");
    assert(
      model.warnings?.includes("STRICT_SELFTEST_FAILED:STRICT_COMPARTMENT_UNAVAILABLE"),
      "expected STRICT_SELFTEST_FAILED warning"
    );
    assert(
      model.warnings?.includes("UNGOVERNED_COMPATIBLE_MODE"),
      "expected UNGOVERNED_COMPATIBLE_MODE warning"
    );
    if (model.warnings) {
      const sorted = [...model.warnings].sort();
      assertEq(JSON.stringify(model.warnings), JSON.stringify(sorted), "warnings must be sorted");
    }
  });

  register("buildPortalModel preserves release status and sorts release reasons", () => {
    const input: PortalModelInput = {
      planDigest: "plan-rel",
      releaseStatus: "UNVERIFIED",
      releaseReasonCodes: ["RELEASE_SIGNATURE_BAD", "RELEASE_MANIFEST_INVALID"],
      releaseId: "fnv1a32:deadbeef",
      blocks: [
        {
          blockHash: "block-r",
          executionMode: "compatible",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "UNVERIFIED" },
        },
      ],
    };

    const model = buildPortalModel(input);
    assertEq(model.releaseStatus, "UNVERIFIED", "expected releaseStatus");
    assertEq(
      model.releaseReasonCodes?.join(","),
      "RELEASE_MANIFEST_INVALID,RELEASE_SIGNATURE_BAD",
      "expected sorted releaseReasonCodes"
    );
    assertEq(model.releaseId, "fnv1a32:deadbeef", "expected releaseId");
    assert(model.warnings?.includes("RELEASE_UNVERIFIED"), "expected RELEASE_UNVERIFIED warning");
  });

  register("buildPortalModel projects Tartarus summary and latest record deterministically", () => {
    const input: PortalModelInput = {
      planDigest: "plan-t",
      blocks: [
        {
          blockHash: "block-b",
          executionMode: "strict",
          requestedCaps: [],
          eligibleCaps: [],
          deniedCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "UNVERIFIED" },
          tartarusRecords: [
            {
              schema: "weftend.tartarus/0",
              recordId: "rec-1",
              planDigest: "plan-t",
              blockHash: "block-b",
              kind: "cap.replay",
              severity: "DENY",
              remedy: "NONE",
              reasonCodes: ["REPLAY_DETECTED"],
              seq: 1,
            },
            {
              schema: "weftend.tartarus/0",
              recordId: "rec-2",
              planDigest: "plan-t",
              blockHash: "block-b",
              kind: "tier.violation",
              severity: "QUARANTINE",
              remedy: "MOVE_TIER_DOWN",
              reasonCodes: ["TIER_VIOLATION"],
              seq: 2,
            },
          ],
        },
      ],
    };

    const model = buildPortalModel(input);
    assert(model.tartarus, "expected tartarus summary");
    assertEq(model.tartarus?.total, 2, "expected total tartarus count");
    assertEq(model.tartarus?.bySeverity?.DENY, 1, "expected DENY count");
    assertEq(model.tartarus?.bySeverity?.QUARANTINE, 1, "expected QUARANTINE count");
    assertEq(model.tartarus?.byKind?.["cap.replay"], 1, "expected cap.replay count");
    assertEq(model.tartarus?.byKind?.["tier.violation"], 1, "expected tier.violation count");

    const latest = model.blocks[0].tartarusLatest;
    assert(latest, "expected tartarusLatest");
    assertEq(latest?.recordId, "rec-2", "expected latest record by seq");
    assertEq(latest?.kind, "tier.violation", "expected latest kind");
  });

  register("buildPortalModel warns when recovery scar is present", () => {
    const input: PortalModelInput = {
      planDigest: "plan-recover",
      blocks: [
        {
          blockHash: "block-r",
          executionMode: "strict",
          requestedCaps: [],
          eligibleCaps: [],
          evidenceRecords: [],
          verifyResult: { status: "UNVERIFIED" },
          tartarusRecords: [
            {
              schema: "weftend.tartarus/0",
              recordId: "rec-recover",
              planDigest: "plan-recover",
              blockHash: "block-r",
              kind: "artifact.mismatch",
              severity: "QUARANTINE",
              remedy: "REBUILD_FROM_TRUSTED",
              reasonCodes: ["ARTIFACT_RECOVERED", "ARTIFACT_DIGEST_MISMATCH"],
              seq: 3,
            },
          ],
        },
      ],
    };

    const model = buildPortalModel(input);
    assert(model.warnings?.includes("ARTIFACT_RECOVERED"), "expected ARTIFACT_RECOVERED warning");
    if (model.warnings) {
      const sorted = [...model.warnings].sort();
      assertEq(JSON.stringify(model.warnings), JSON.stringify(sorted), "warnings must be sorted");
    }
  });
});

if (!hasBDD) {
  for (const t of localTests) {
    try {
      t.fn();
    } catch (e: any) {
      const detail = e?.message ? `
${e.message}` : "";
      throw new Error(`portal_model.test.ts: ${t.name} failed${detail}`);
    }
  }
}
