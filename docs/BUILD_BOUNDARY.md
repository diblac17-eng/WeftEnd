# Build Boundary

Only `src/**` is compiled by `tsc`.

Anything outside `src/` (top-level `.ts`, drafts, or legacy files) is non-authoritative
until moved under `src/` and added to the build/test loop.

This is enforced by:

- `tsconfig.json` include/exclude rules
- `src/core/build_boundary.test.ts`
