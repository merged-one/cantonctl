# Upstream Source Manifest

The canonical source of truth for upstream Canton and Splice inputs is [src/lib/upstream/manifest.ts](../../src/lib/upstream/manifest.ts).

This milestone is documentation-first on purpose. No runtime behavior changes are introduced here. The goal is to make future code generation, compatibility checks, and scaffold/config follow-up work consume one machine-readable manifest instead of reusing URLs copied from:

- `README.md`
- CI workflow snippets
- scaffold defaults
- ADR prose
- ad hoc scripts or issue comments

## Rules

1. Add or change upstream pins in the manifest first.
2. Generate clients only from manifest entries whose `intendedUse` includes `generate-client`.
3. Generate Daml bindings or data-dependency anchors only from manifest entries whose `intendedUse` includes `generate-bindings`.
4. Treat `experimental-internal` and `operator-only` entries as reference-only unless a later milestone explicitly promotes them.
5. When a source is mixed-scope, respect the manifest selector instead of assuming the whole file is stable.

## What Is Pinned

Each manifest entry records:

- a stable `id`
- a `stability` class
- an `intendedUse` list
- an immutable source pin:
  for GitHub-backed inputs this is a repo + ref + raw URL
  for public SDKs this is an npm package name + version + tarball URL
- an optional `artifactVersion` when the upstream file embeds a separate spec/interface version

The distinction matters. For example, the Canton JSON Ledger API OpenAPI file is pinned to the Canton `v3.4.11` tag even though the file itself advertises a `3.5.0-SNAPSHOT` spec version.

## Expected Consumers

Future scripts should import the manifest directly:

```ts
import {UPSTREAM_MANIFEST, getUpstreamSource} from 'cantonctl/upstream/manifest'
```

Inside the repo, direct source imports are also fine during development:

```ts
import {UPSTREAM_MANIFEST} from '../../src/lib/upstream/manifest.js'
```

The repeatable sync pipeline now lives in:

- `npm run codegen:fetch-specs` to sync official upstream OpenAPI/OpenRPC files into `third_party/upstream-specs/`
- `npm run codegen:generate-types` to generate the stable TypeScript artifacts into `src/generated/`
- `npm run codegen:specs` to run both steps in order

The stable generated tree is intentionally narrower than the synced upstream mirror:

- `third_party/upstream-specs/` may contain reference-only or internal specs when the manifest says they matter for compatibility or manual inspection
- `src/generated/` must only contain stable external artifacts derived from manifest-approved entries
- mixed-scope specs such as Splice Scan must be filtered through their manifest selector before type generation

## Current Coverage

The manifest currently pins:

- Canton JSON Ledger API OpenAPI
- Splice Scan external and scan-proxy APIs
- Splice validator, wallet, and ANS API surfaces
- Wallet Gateway dApp and user OpenRPC contracts
- published `@canton-network/dapp-sdk` and `@canton-network/wallet-sdk` packages
- Splice Token Standard OpenAPI specs
- stable Splice Token Standard Daml interface anchors

If a future prompt needs a new upstream input, add it here first and extend the manifest tests in [src/lib/upstream/manifest.test.ts](../../src/lib/upstream/manifest.test.ts).
