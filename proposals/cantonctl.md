## Development Fund Proposal

This file is archival proposal context. It is not canonical product or architecture guidance for the current repo surface; use `README.md`, `docs/CURRENT_STATE.md`, `docs/BEST_PRACTICES.md`, and `docs/adr/` for live guidance.

**Author:** Merged One  
**Status:** Submitted  
**Created:** 2026-03-31  
**Updated:** 2026-04-06

**Repositories:**

- [merged-one/cantonctl](https://github.com/merged-one/cantonctl) — Splice-aware orchestration companion
- [merged-one/cantonjs](https://github.com/merged-one/cantonjs) — TypeScript SDK for Canton and Splice-facing integrations

**npm packages:**

- [`cantonctl@0.3.6`](https://www.npmjs.com/package/cantonctl)
- [`cantonjs@0.2.0`](https://www.npmjs.com/package/cantonjs)

---

## Abstract

`cantonctl` is no longer proposed as the whole Canton developer platform. The current product wedge is narrower and stronger:

- profile-based environment control
- official Splice LocalNet wrapping
- auth, status, and compatibility surfaces
- stable/public Scan, token-standard, ANS, and validator-user flows
- explicit separation between stable/public and experimental surfaces

The proposal is to fund `cantonctl` as a community-maintained orchestration companion on top of the official Canton stack. It should help teams move from sandbox to LocalNet to remote validator-backed environments without replacing DPM, Daml Studio, Quickstart, Wallet Gateway, the dApp SDK, or the Wallet SDK.

## Objective

The problem is no longer “there is no Canton platform.” The problem is the gap between:

- official build and IDE tooling,
- official reference-app and LocalNet workflows,
- official wallet and dApp integration tooling,
- and the operational reality of profile-driven remote environments.

`cantonctl` fills that gap with machine-readable wrappers, compatibility checks, diagnostics, discovery, runtime inventory, deploy rollout, and current lifecycle helpers across sandbox, LocalNet, and remote validator-backed environments.

## Official Boundaries

### What the official stack owns

- **DPM**: build, test, codegen, sandbox, Studio launch
- **Daml Studio**: canonical Daml IDE
- **CN Quickstart**: official reference app and LocalNet launchpad
- **dApp SDK / dApp API / Wallet Gateway**: canonical wallet-connected dApp flow, including CIP-0103 integration
- **Wallet SDK**: canonical wallet-provider, exchange, and custody toolkit
- **Stable/public Splice APIs and Daml interfaces**: supported remote automation surfaces

### What `cantonctl` owns

- profile-aware config resolution
- auth, compatibility, status, readiness, and runtime-inventory helpers
- the wrapper around the official Splice LocalNet workspace
- stable/public CLI flows over Scan, token-standard, ANS, and validator-user surfaces
- profile-first deploy rollout plus read-only preflight, promotion, reset, and upgrade helpers
- discovery, canaries, diagnostics, and SDK config export

The rule is simple: wrap, do not replace.

## Current Strengths To Preserve

- profile kinds: `sandbox`, `canton-multi`, `splice-localnet`, `remote-validator`, `remote-sv-network`
- LocalNet wrapping over the official workspace
- manifest-backed control-plane metadata and authoritative runtime inventory
- separate app and operator credential handling for remote mutations
- stable/public Splice command surfaces
- upstream manifest discipline for stability classes and generated clients
- explicit experimental boundaries
- Splice-aware examples, templates, and CI coverage

## Non-Goals

- Not the canonical build/test/codegen/sandbox/studio tool
- Not the canonical IDE
- Not a Quickstart replacement
- Not the primary wallet-provider or exchange toolkit
- Not the default UX for unstable internal APIs

## Positioning Statement

`cantonctl` should be the Splice-aware orchestration companion over the official Canton stack, not the stack itself.

## Audience

Primary users:

1. App and platform engineers moving Daml artifacts and app code into validator-backed environments
2. Solution engineers, DevRel, and onboarding leads who need repeatable demos and profile bundles
3. CI, release, and operations engineers who need JSON-first gates, diagnostics, and canaries

Non-primary users:

- pure smart-contract authors already well served by DPM and Daml Studio
- teams whose primary need is an IDE
- wallet providers and exchanges looking for a lead integration toolkit

## Product Direction

### Docs and positioning delivered

- rewrite README, package metadata, command help, and proposal language
- add ecosystem-fit guidance and explicit non-goals
- make the docs DPM-first, Quickstart-aware, and profile-first
- reframe `serve` and `playground` as adjunct workbench surfaces

### Runtime additions already delivered

- `preflight --profile --json`
- promotion, reset, and upgrade helper surfaces
- lightweight diagnostics bundle export
- Scan-based discovery and profile synthesis
- stable/public canaries for CI gates
- SDK config export for official SDK consumers
- profile-first deploy rollout with plan and dry-run modes
- separate app and operator auth handling for remote mutations
- authoritative runtime inventory via `status --json`

### Remaining control-plane expansion

Further plan/apply work is tracked in GitHub issues and PRs, not in this proposal document.

## Language To Retire

Retire whole-platform, Hardhat-style, and IDE-first umbrella language from primary product surfaces. Keep the primary story focused on companion workflows, official-tool boundaries, and stable/public default paths.

## Consequences

### Positive

- Aligns `cantonctl` with current official-tool boundaries
- Preserves the repo’s strongest merged Splice-aware work
- Keeps the narrative defensible for community-tools discoverability
- Creates a clearer path for machine-readable operational helpers

### Negative

- Reduces the breadth of the old marketing story
- Forces more explicit acknowledgement of where official tools should win
- Requires documentation, help text, and tests to guard against drift

## Implementation Notes

- All follow-on implementation branches must start from updated `main`, never `dev`.
- Stable/public remains the default command path.
- Operator-only and internal surfaces remain explicit experimental opt-ins.
