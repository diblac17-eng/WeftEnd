/* src/runtime/container/docker_probe_v0.test.ts */

import {
  buildContainerAdapterEvidenceV0,
  probeDockerImageLocalV0,
  type DockerCommandRunnerV0,
  type DockerProbeSuccessV0,
} from "./docker_probe_v0";

declare const process: any;

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg);
};

const assertEq = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) {
    throw new Error(`${msg} (actual=${String(actual)} expected=${String(expected)})`);
  }
};

const makeRunner = (inspectPayload: string): DockerCommandRunnerV0 => {
  return (args: string[]) => {
    const key = args.join(" ");
    if (key.startsWith("version ")) return { status: 0, stdout: "{\"Version\":\"27.0.0\"}", stderr: "" };
    if (key.startsWith("image inspect ")) return { status: 0, stdout: inspectPayload, stderr: "" };
    return { status: 1, stdout: "", stderr: "unexpected args" };
  };
};

const run = (): void => {
  {
    const res = probeDockerImageLocalV0("bad ref with space");
    assert(!res.ok, "invalid ref should fail");
    if (!res.ok) assertEq(res.code, "DOCKER_IMAGE_REF_INVALID", "invalid ref code mismatch");
  }

  {
    const res = probeDockerImageLocalV0("ubuntu:latest", { env: { dockerHost: "tcp://example.invalid:2375" } });
    assert(!res.ok, "remote context must fail closed");
    if (!res.ok) assertEq(res.code, "DOCKER_REMOTE_CONTEXT_UNSUPPORTED", "remote context code mismatch");
  }

  {
    const inspectMismatch = JSON.stringify([
      {
        Id: "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        RepoDigests: ["ghcr.io/acme/app@sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"],
        RepoTags: ["ghcr.io/acme/app:1.0.0"],
        Size: 12345,
        RootFS: { Layers: ["sha256:l1"] },
        Config: { Env: [], ExposedPorts: {}, Entrypoint: [], Cmd: [] },
      },
    ]);
    const res = probeDockerImageLocalV0(`ghcr.io/acme/app@sha256:${"c".repeat(64)}`, {
      runDocker: makeRunner(inspectMismatch),
      env: { dockerHost: "", dockerContext: "default" },
    });
    assert(!res.ok, "digest mismatch should fail closed");
    if (!res.ok) assertEq(res.code, "DOCKER_IMAGE_DIGEST_MISMATCH", "digest mismatch code mismatch");
  }

  const inspect = JSON.stringify([
    {
      Id: "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      RepoDigests: ["ghcr.io/acme/app@sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"],
      RepoTags: ["ghcr.io/acme/app:1.0.0", "ghcr.io/acme/app:latest"],
      Size: 12345,
      RootFS: { Layers: ["sha256:l1", "sha256:l2"] },
      Config: {
        Env: ["A=1", "B=2"],
        ExposedPorts: { "80/tcp": {}, "443/tcp": {} },
        Entrypoint: ["/entry.sh"],
        Cmd: ["run"],
      },
      Created: "2026-02-15T00:00:00Z",
    },
  ]);

  const res = probeDockerImageLocalV0("ghcr.io/acme/app:1.0.0", {
    runDocker: makeRunner(inspect),
    env: { dockerHost: "", dockerContext: "default" },
  });
  assert(res.ok, "probe should succeed with stubbed docker");
  if (!res.ok) return;

  assertEq(
    res.resolvedDigest,
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "resolved digest should use repo digest"
  );
  assertEq(res.registryDomain, "ghcr.io", "registry domain mismatch");
  assertEq(res.layerCount, 2, "layer count mismatch");
  assertEq(res.envVarCount, 2, "env count mismatch");
  assertEq(res.exposedPortCount, 2, "port count mismatch");
  assert(res.reasonCodes.join(",") === "CONTAINER_SCAN_ADAPTER_V0,DOCKER_IMAGE_LOCAL_INSPECTED,EXECUTION_WITHHELD_CONTAINER", "reason code ordering mismatch");

  const evidenceA = buildContainerAdapterEvidenceV0(res as DockerProbeSuccessV0);
  const evidenceB = buildContainerAdapterEvidenceV0(res as DockerProbeSuccessV0);
  assertEq(JSON.stringify(evidenceA), JSON.stringify(evidenceB), "adapter evidence should be deterministic");
  assertEq(evidenceA.summary.schema, "weftend.adapterSummary/0", "summary schema mismatch");
  assertEq(evidenceA.findings.schema, "weftend.adapterFindings/0", "findings schema mismatch");
  assert(!JSON.stringify(evidenceA).includes("Created"), "adapter evidence should not include time fields");
};

try {
  run();
  console.log("docker_probe_v0.test: PASS");
} catch (error) {
  console.error("docker_probe_v0.test: FAIL");
  console.error(error);
  process.exit(1);
}
