# Current State

This document is the canonical high-level snapshot of the repository's supported feature set.

Do not use it for aspirational planning. Use it to describe what exists on the current branch and what users should rely on today.

On `main`, this snapshot matches the current package release: `cantonctl@0.3.5`.

## Product Position

`cantonctl` is the Splice-aware orchestration companion and current project-local control-plane layer for the official Canton stack.

It complements:

- DPM for build, test, codegen, sandbox, and Studio launch
- Daml Studio for the canonical IDE workflow
- Quickstart and the official Splice LocalNet workspace for the reference-app and LocalNet path
- the official dApp SDK, dApp API, Wallet Gateway, and Wallet SDK for wallet-connected integrations

It wraps, not replaces, those tools.

The accepted product boundary is the project-local control plane over official runtimes. In `0.3.5`, the implemented surface now includes the first day-2 rollout workflows, but it still does not attempt full ownership of upstream runtime internals or infrastructure provisioning.

## Supported Local Runtime Modes

- `cantonctl dev`: sandbox-first local development
- `cantonctl dev --net`: Canton-only local multi-node Docker runtime
- `cantonctl localnet ...`: wrapper over the official Splice LocalNet workspace
- `cantonctl profiles import-localnet`: LocalNet-to-profile bootstrap
- `cantonctl readiness`: composed readiness gate over auth, compatibility, preflight, and canaries

Named local Canton topologies are defined under `topologies:` in `cantonctl.yaml`.

## Supported Environment Model

The repo supports these profile kinds:

- `sandbox`
- `canton-multi`
- `splice-localnet`
- `remote-validator`
- `remote-sv-network`

Profiles remain the canonical way to describe environments and remote services.

Resolved profile inspection now includes manifest-backed control-plane metadata per service and capability:

- lifecycle owner
- management class
- mutation scope
- operator-surface flag
- endpoint provenance
- official SDK-backed out-of-scope capability markers where applicable

`cantonctl status --json` now emits the authoritative schema-versioned runtime inventory for sandbox, generated `dev --net` topologies, and remote profile/network targets, including:

- service and capability health
- runtime provenance
- operator/internal warnings
- management eligibility
- drift hints between resolved profile intent and discovered runtime state

On top of the raw inventory, `status`, `preflight`, `readiness`, and LocalNet JSON now expose a shared control-plane drift and reconcile contract that:

- classifies auth, reachability, endpoint, profile-kind, operator-surface, and upstream-line drift
- marks whether a drift item falls inside a companion-supported action or an upstream/manual boundary
- emits supported local/runtime actions only for existing companion surfaces such as `auth login`, `dev`, `dev --net`, and `localnet up`
- emits explicit operator or official-stack runbook items for unresolved boundary drift

`cantonctl localnet up|status --json` emits the same inventory contract for official LocalNet workspace discovery.

`preflight` and `readiness` now also emit shared rollout contracts, and `cantonctl promote diff` reuses those contracts for `plan`, `dry-run`, and `apply` promotion workflows.

`cantonctl deploy` is now profile-first and supports plan, dry-run, and apply modes with structured artifact, fan-out, target, and step reporting. It can fan out across generated `canton-multi` participants, target LocalNet's exposed ledger endpoint, or apply against remote ledger-capable profiles.

`cantonctl upgrade check` and `cantonctl reset checklist` now use the same plan/dry-run/apply rollout contract. Supported apply automation is currently limited to cycling an existing official LocalNet workspace for `splice-localnet` profiles; remote upgrade/reset mutation stays manual-only.

Remote auth handling is now explicitly split between app and operator scopes:

- app credentials support read and user-facing flows
- operator credentials gate remote mutating control-plane actions
- remote mutations do not inherit the local fallback token path

Local topology design for `dev --net` is separate and lives under the top-level `topologies:` config section.

## Current Control-Plane Coverage

The current release implements these control-plane surfaces:

- profile resolution, validation, and auth handling
- separate app vs operator credential resolution and reporting for remote control-plane actions
- explicit `operator` namespace coverage for approved admin/runtime actions
- `dev`, `dev --net`, topology preview/export, and LocalNet wrapping
- status, compatibility, preflight, readiness, canaries, and diagnostics
- drift classification and reconcile planning over those read/check surfaces
- discovery, profile import, and SDK config export
- profile-first deploy rollout, promotion rollout planning/live gates, and upgrade/reset rollout workflows
- diagnostics bundles include runtime inventory, drift summaries, and the last stored control-plane operation artifact with aggressive redaction

These boundaries still hold today:

- DPM remains the canonical build, test, codegen, sandbox, and Studio launcher
- `deploy` consumes built DARs but does not own compilation or codegen
- Daml Studio remains the canonical IDE
- Quickstart remains the official reference app and LocalNet launch path
- the official dApp SDK, Wallet Gateway, and Wallet SDK remain the canonical wallet-connected integration stack
- validator, Scan, wallet, and OIDC implementations remain owned by upstream artifacts
- cloud/Kubernetes/Terraform/Helm provisioning remains out of scope

## Stable/Public Vs Experimental

Stable/public companion surfaces include:

- profile-based config and validation
- auth, compatibility, readiness, preflight, and status checks
- LocalNet wrapping
- LocalNet profile import
- preflight, promotion rollout, upgrade/reset rollout, and diagnostics helpers
- stable/public Scan, token-standard, ANS, and validator-user flows
- stable/public discovery, canaries, and SDK config export

Explicit operator surfaces currently include:

- `operator validator licenses` over the Scan admin license endpoint
- required operator auth and profile gating through manifest-backed source IDs and control-plane metadata

Non-GA surfaces remain explicit and narrow. The source of truth is:

- [reference/api-stability.md](reference/api-stability.md)
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
- "Splice-aware orchestration companion"
- "wrap, do not replace"

These older phrases are retired from active product/help copy:

- `dev --full`
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
