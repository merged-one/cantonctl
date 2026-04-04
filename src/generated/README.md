# Generated Spec Artifacts

This directory contains committed TypeScript artifacts derived from the synced upstream specs in [third_party/upstream-specs](../../third_party/upstream-specs).

- `npm run codegen:generate-types` regenerates this tree from the synced `selected.*` spec files.
- `src/generated/ledger-json-api/` contains generated Canton JSON Ledger API OpenAPI types.
- `src/generated/splice/` contains generated stable Splice OpenAPI types.
- `src/generated/openrpc/` contains synced stable OpenRPC documents wrapped in thin TypeScript modules.

This tree is intentionally stable-only. Experimental, operator-only, or otherwise internal specs may be mirrored in `third_party/upstream-specs/` but must not leak into `src/generated/`.
