// src/cli/license_cli_smoke.test.ts
// Basic license issue + verify flow.

import { runCliCapture } from "./cli_test_runner";

declare const process: any;

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

const containsAbsPath = (text: string): boolean =>
  /\b[A-Za-z]:\\/.test(text) || /\/Users\//.test(text) || /\/home\//.test(text);

const testLicenseFlow = async () => {
  const root = path.join(process.cwd(), "out", "license_cli_test");
  const privPath = path.join(root, "license_private.pem");
  const pubPath = path.join(root, "license_public.pem");
  const licPath = path.join(root, "license.json");

  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));
  fs.writeFileSync(licPath, "stale", "utf8");

  const issue = await runCliCapture([
    "license",
    "issue",
    "--key",
    privPath,
    "--out",
    licPath,
    "--customer",
    "acme",
    "--tier",
    "enterprise",
    "--features",
    "watchlist,auto_scan",
    "--issued",
    "2026-02-05",
    "--key-id",
    "weftend-vendor-1",
  ]);
  assert(issue.status === 0, `license issue failed: ${issue.stderr}`);
  assert(fs.existsSync(licPath), "license file missing");
  assert(!fs.existsSync(`${licPath}.stage`), "license stage file must not remain after finalize");
  assert(fs.readFileSync(licPath, "utf8") !== "stale", "license issue must replace stale output");
  assert(!containsAbsPath(issue.stdout + issue.stderr), "license issue output leaks path");

  const verify = await runCliCapture([
    "license",
    "verify",
    "--license",
    licPath,
    "--pub",
    pubPath,
  ]);
  assert(verify.status === 0, `license verify failed: ${verify.stderr}`);
  assert(!containsAbsPath(verify.stdout + verify.stderr), "license verify output leaks path");

  const keyBefore = fs.readFileSync(privPath, "utf8");
  const conflictIssue = await runCliCapture([
    "license",
    "issue",
    "--key",
    privPath,
    "--out",
    privPath,
    "--customer",
    "acme",
    "--tier",
    "enterprise",
    "--features",
    "watchlist,auto_scan",
    "--issued",
    "2026-02-05",
    "--key-id",
    "weftend-vendor-1",
  ]);
  assert(conflictIssue.status === 40, `license issue key/out conflict must fail closed: ${conflictIssue.stderr}`);
  assert(
    conflictIssue.stderr.includes("LICENSE_OUT_CONFLICTS_KEY"),
    "license issue key/out conflict must report explicit code"
  );
  assert(fs.readFileSync(privPath, "utf8") === keyBefore, "license issue key/out conflict must not modify private key file");
};

testLicenseFlow()
  .then(() => {
    console.log("license_cli_smoke.test: PASS");
  })
  .catch((err: unknown) => {
    console.error("license_cli_smoke.test: FAIL");
    console.error(err);
    process.exit(1);
  });
