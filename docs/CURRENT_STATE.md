# Current State

This document is the canonical high-level snapshot of the repository's supported feature set.

Do not use it for aspirational planning. Use it to describe what exists on the current branch and what users should rely on today.

## Product Position

`cantonctl` is the Splice-aware orchestration companion for the official Canton stack.

It complements:

- DPM for build, test, codegen, sandbox, and Studio launch
- Daml Studio for the canonical IDE workflow
- Quickstart and the official Splice LocalNet workspace for the reference-app and LocalNet path
- the official dApp SDK, dApp API, Wallet Gateway, and Wallet SDK for wallet-connected integrations

It wraps, not replaces, those tools.

## Supported Local Runtime Modes

- `cantonctl dev`: sandbox-first local development
- `cantonctl dev --net`: Canton-only local multi-node Docker runtime
- `cantonctl localnet ...`: wrapper over the official Splice LocalNet workspace
- `cantonctl serve`: profile-aware IDE/workbench backend
- `cantonctl playground`: adjunct browser workbench on top of `serve`

Named local Canton topologies are defined under `topologies:` in `cantonctl.yaml`.

## Supported Environment Model

The repo supports these profile kinds:

- `sandbox`
- `canton-multi`
- `splice-localnet`
- `remote-validator`
- `remote-sv-network`

Profiles remain the canonical way to describe environments and remote services.

Local topology design for `dev --net` is separate and lives under the top-level `topologies:` config section.

## Stable/Public Vs Experimental

Stable/public companion surfaces include:

- profile-based config and validation
- auth, compatibility, and status checks
- LocalNet wrapping
- preflight, lifecycle, and diagnostics helpers
- stable/public Scan, token-standard, ANS, and validator-user flows
- stable/public discovery, canaries, and SDK config export

Experimental surfaces remain explicit opt-in. The source of truth is:

- [reference/api-stability.md](reference/api-stability.md)
- [reference/experimental.md](reference/experimental.md)
- [`scripts/ci/manifest.js`](../scripts/ci/manifest.js)

## Canonical CI And Toolchain Sources

Do not duplicate suite membership, matrix counts, or toolchain versions in active docs.

Use these sources instead:

- CI suites and scope: [`scripts/ci/manifest.js`](../scripts/ci/manifest.js)
- workflow orchestration: [../.github/workflows/ci.yml](../.github/workflows/ci.yml)
- native and Docker parity runners: [../scripts/ci/run.js](../scripts/ci/run.js)

## Current User-Facing Naming

These names are current and must be used consistently:

- `CIP-0103`
- `dev --net`
- `playground --net`
- "Splice-aware orchestration companion"
- "wrap, do not replace"

These older phrases are retired from active product/help copy:

- `dev --full`
- `playground --full`
- "Hardhat for Canton"
- "complete developer toolchain for Canton"
- "Remix-like browser IDE"

Historical references may still appear only in accepted ADRs, release notes, or migration notes when clearly marked as legacy context.

## Canonical Docs To Read Next

- [README.md](../README.md)
- [README.md](README.md)
- [BEST_PRACTICES.md](BEST_PRACTICES.md)
- [adr/README.md](adr/README.md)
- [reference/](reference/)
- [release-notes/](release-notes/)
- [migration/](migration/)
