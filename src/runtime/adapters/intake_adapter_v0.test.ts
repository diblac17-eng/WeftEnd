/* src/runtime/adapters/intake_adapter_v0.test.ts */
// Adapter contract validation sanity.

import { validateNormalizedArtifactV0 } from "./intake_adapter_v0";

declare const process: any;

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const run = (): void => {
  const valid = {
    schema: "weftend.normalizedArtifact/0" as const,
    schemaVersion: 0 as const,
    adapterId: "email_v0",
    kind: "email" as const,
    sourceFormat: "eml",
    rootDir: "email_export",
    requiredFiles: [
      "adapter_manifest.json",
      "headers.json",
      "body.txt",
      "body.html.txt",
      "links.txt",
      "attachments/manifest.json",
    ],
    markers: ["EMAIL_MSG_EXPERIMENTAL_PARSE"],
  };
  const issues = validateNormalizedArtifactV0(valid, "artifact");
  assert(issues.length === 0, "expected no issues for valid normalized artifact");

  const invalid = {
    ...valid,
    requiredFiles: ["C:\\Users\\bad\\file.txt"],
  };
  const invalidIssues = validateNormalizedArtifactV0(invalid as any, "artifact");
  assert(invalidIssues.length > 0, "expected invalid path issue");
};

try {
  run();
  console.log("intake_adapter_v0.test: PASS");
} catch (error) {
  console.error("intake_adapter_v0.test: FAIL");
  console.error(error);
  process.exit(1);
}

