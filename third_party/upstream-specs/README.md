# Upstream Spec Mirror

This directory stores repo-committed mirrors of official upstream OpenAPI and OpenRPC inputs.

- `npm run codegen:fetch-specs` refreshes the files here from the URLs pinned in [src/lib/upstream/manifest.ts](../../src/lib/upstream/manifest.ts).
- Each synced source lives in `third_party/upstream-specs/<source-id>/`.
- `source.*` is the raw upstream document as fetched.
- `selected.*` is the manifest-filtered document used for downstream generation when a selector applies.
- `metadata.json` records provenance, including source id, upstream ref, fetch date, and SHA-256 hashes.
- `manifest.json` is the aggregate sync index used by the generation step.

This mirror may contain reference-only or internal specs when the upstream manifest says they are useful for compatibility checks. Stable generated artifacts must still be derived only from manifest-approved stable external sources.
