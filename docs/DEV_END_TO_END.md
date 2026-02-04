# DEV_END_TO_END.md
How a developer uses WeftEnd v1 end-to-end.

The mental checksum
Power requires proof; repairs leave scars.

1) Examine an artifact (the product entrypoint)
Run a single command:

```
node dist/src/cli/main.js examine <input> --profile web|mod|generic --out out/exam
```

Input can be a folder, file, or zip.

2) Read the outputs
WeftEnd produces two deterministic outputs:
- `weftend_mint_v1.json` (machine adapter)
- `weftend_mint_v1.txt` (human report)

Both are time-free, bounded, and reproducible.

3) Optional: scripted interactions
If behavior only appears on interaction:

```
node dist/src/cli/main.js examine <input> --profile web --out out/exam --script path/to/script.txt
```

The script is deterministic and capped (no timers, no randomness).

4) Integrate
Downstream tools consume the mint adapter:
- input digest (what it is)
- observed attempts (what it tried to do)
- grade + reason codes (why)
- mint digest (proof identifier)

What you get
- A grade that is reproducible across machines.
- Evidence of attempted behavior under denial.
- A single adapter JSON for tooling pipelines.
