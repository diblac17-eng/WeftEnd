# Steam Workshop Demo Item — Hello Mod

This folder represents a Workshop item on disk.

Structure:
- `payload/` — the mod content users recognize (includes `hello_mod_block.js`)
- `weftend/manifest.json` — proof-only manifest
- `weftend/evidence.json` — proof-only evidence summary
- `weftend/metadata_pointer.txt` — the compact trust pointer for Workshop metadata

The pointer string is derived from deterministic digests of the manifest and evidence files.
