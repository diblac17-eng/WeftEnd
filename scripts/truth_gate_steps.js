// scripts/truth_gate_steps.js
// Shared command list for commit/guard truth gates.

function buildTruthGateSteps() {
  return [
    {
      label: "compile",
      args: ["run", "compile", "--silent"],
      env: {},
    },
    {
      label: "test",
      args: ["test"],
      env: {},
    },
    {
      label: "proofcheck_release",
      args: ["run", "proofcheck:release"],
      env: {
        WEFTEND_RELEASE_DIR: "tests/fixtures/release_demo",
        WEFTEND_ALLOW_SKIP_RELEASE: "",
      },
    },
    {
      label: "verify360_release_managed",
      args: ["run", "verify:360:release:managed"],
      env: {
        WEFTEND_RELEASE_DIR: "tests/fixtures/release_demo",
        WEFTEND_ALLOW_SKIP_RELEASE: "",
      },
    },
  ];
}

module.exports = {
  buildTruthGateSteps,
};
