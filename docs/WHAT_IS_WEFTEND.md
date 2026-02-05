# What is WeftEnd (v1)

WeftEnd is a local examiner that grades and mints software artifacts.
It does not host, publish, sell, or run your program for users.
It inspects it, proves what it does (and tries to do), and produces a deterministic receipt your tools can trust.

## The trust delta loop

WeftEnd is not about running software. It is about detecting changes in trust posture over time.

- Baseline: capture a receipt before install or change.
- Re-check: capture a new receipt after download, patch, or config change.
- Compare: deterministic diff (drift or no drift).

## Publisher snapshots (future, important)

Snapshots are publisher-signed digest sets that let operators verify a download
matches the developer’s intended artifact. They are not required for v1, but the
design preserves room for them:

- A snapshot would be a deterministic digest list with a publisher signature.
- Operators could compare their local receipt against a snapshot without executing anything.
- This enables “proof of download integrity” when publishers participate.

WeftEnd will remain useful without snapshots, but snapshot support is a planned
future patch that strengthens trust for modders and tool developers.

## The problem it solves

Developers ship mods, plugins, web stacks, and bundles into hostile territory:

- Users do not know if a download was altered.
- Platforms do not know what a program tries to do until it is already running.
- Devs are asked to prove safety after the fact, with logs, screenshots, or trust.

WeftEnd moves that proof before distribution, locally, without services or accounts.

## What WeftEnd actually does

You run one command:

npm run weftend -- examine <input> --profile web|mod|generic --out out/

WeftEnd then:

- Captures the artifact (folder, zip, or bundle).
- Computes a root digest.
- Classifies files (HTML, JS, CSS, WASM, assets, etc.).
- Observes behavior under denial (strict, deny-all).
- Grades it (OK / WARN / DENY / QUARANTINE with reason codes).
- Mints a receipt (JSON adapter + human report).

No simulation, no guesses - only witnessed attempts.
Browser builds do not execute. Strict execution requires the Node host command (`weftend host run`).
In Windows shell flows, "Run with WeftEnd" means analysis-first: native executables are withheld unless they are verified WeftEnd releases and host prerequisites are satisfied.

## What you get

1) A machine adapter (for tooling)

A stable JSON object your system can consume:

- Input digest
- Observed behavior
- Denied capabilities
- External references
- Final grade
- Mint digest (content-addressed)

2) A human report (for people)

A one-page grader slip:

- What it is
- What it tried to do
- What was denied
- Why it was graded this way
- A fingerprint anyone can verify

## What it is not

- Not a marketplace
- Not a hosting service
- Not an antivirus
- Not a sandbox by default
- Not a tracker
- Not a UI builder

Those can come later. v1 does one job.

## Why this works for modern software

WeftEnd does not need to understand every language or framework.
Browsers, runtimes, and loaders already interpret modern stacks.
WeftEnd simply watches what they attempt under strict limits.

If something matters, it leaves a trace.
If it leaves a trace, WeftEnd records it.

## Who this is for (v1)

- Mod developers who want players to trust downloads
- Platform owners who want deterministic intake checks
- Security-conscious devs who want proof, not promises
- Toolchains that need a clean "is this acceptable?" adapter

## The mental model

WeftEnd is a card grader.

You put the artifact on the table.
It is examined under glass.
You get a grade, a receipt, and a serial number.

What you do with that receipt is up to you.

## The promise

- Local
- Deterministic
- Honest about limits
- Useful even when strict mode is unavailable
- No theater

If WeftEnd says "OK," it can prove why.
If it says "DENY," it can show the exact scar.
