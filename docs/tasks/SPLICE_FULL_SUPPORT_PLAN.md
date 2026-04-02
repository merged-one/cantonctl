# Splice Full Support Working Plan

Working plan for implementing full Canton plus Splice support without changing runtime behavior in this checkpoint.

Architecture source of truth: [ADR-0015](../adr/ADR-0015-splice-full-support-architecture.md)

## Goals

- Preserve the existing stable paths: `dev`, `dev --full`, JSON Ledger API deploy/status/serve/playground.
- Add a profile and capability model that can represent Splice LocalNet cleanly.
- Keep validator, Scan, wallet, OIDC, and Token Standard semantics delegated to upstream contracts and artifacts.
- Stage Splice support behind explicit experimental boundaries until the full stack is proven.

## Non-Goals

- Rewriting Splice services inside cantonctl
- Pretending current `dev --full` is Splice LocalNet
- Expanding `ledger-client.ts` into a catch-all client for every upstream API
- Shipping runtime changes before the profile and boundary model is documented

## Milestones

### M0. Architecture Baseline

Status: complete in this prompt.

Deliverables:

- `docs/adr/ADR-0015-splice-full-support-architecture.md`
- `docs/tasks/SPLICE_FULL_SUPPORT_PLAN.md`

Exit criteria:

- The repo has a documented boundary between `canton-full` and `splice-localnet`.
- No runtime behavior changes land in this milestone.

### M1. Profile and Capability Foundation

Objective:

Add the internal model needed to describe multiple local runtime bundles and multi-endpoint targets.

Expected module work:

- `src/lib/config.ts`
- `src/lib/scaffold.ts`
- new profile-resolution helper under `src/lib/`
- command wrappers that currently hard-code `--full` or a single ledger URL

Planned outcomes:

- Add profile resolution independent of current command behavior.
- Introduce capability discovery for local profiles and remote networks.
- Decide whether this remains `version: 1` config or requires a schema/version migration.

Tests to add:

- config schema and merge tests for profiles/capabilities
- scaffold tests for generated profile defaults
- command-level parsing tests for `--profile`

Exit criteria:

- Commands can resolve a named profile without changing the existing default runtime.
- Existing `sandbox` and `--full` behavior remain backward-compatible.

### M2. Canton Runtime Refactor Around Capabilities

Objective:

Refactor current Canton-only flows so they consume the new capability model before any Splice runtime is introduced.

Expected module work:

- `src/lib/dev-server.ts`
- `src/lib/dev-server-full.ts`
- `src/lib/topology.ts`
- `src/commands/dev.ts`
- `src/commands/status.ts`
- `src/commands/serve.ts`
- `src/commands/playground.ts`
- `src/commands/deploy.ts`

Planned outcomes:

- Keep `sandbox` and `canton-full` stable under the new profile model.
- Replace one-off topology detection assumptions with resolved capabilities.
- Keep JSON Ledger API usage isolated behind ledger-specific adapters.

Tests to add:

- unit tests for capability resolution and topology detection
- regression coverage for current `dev --full`, `status`, `serve`, and `deploy` flows
- no Splice E2E yet

Exit criteria:

- Existing Canton E2E coverage still passes with the new internal model.
- No user-visible regression in current commands.

### M3. Experimental `splice-localnet` Runtime Adapter

Objective:

Add a dedicated experimental adapter for Splice LocalNet that starts and inspects upstream artifacts without reimplementing them.

Expected module work:

- new `src/lib/splice-localnet.ts` or similarly named runtime module
- new capability adapters for validator, Scan, wallet, and OIDC discovery
- `src/commands/dev.ts`
- `src/commands/status.ts`
- `src/lib/docker.ts` or an upstream launcher wrapper if needed

Planned outcomes:

- `cantonctl dev --profile splice-localnet` starts the upstream stack or fails clearly with actionable diagnostics.
- `status` reports all discovered service endpoints and health.
- The feature is explicitly marked experimental in help, docs, and output.

Tests to add:

- unit tests for service discovery and health parsing
- E2E smoke test for experimental LocalNet startup with unique ports and skip guards
- CI job should be informational first, matching current Docker-test policy

Exit criteria:

- LocalNet startup is isolated from `canton-full`.
- Users can tell exactly which services are running and which are missing.

### M4. Network Target and Auth Integration

Objective:

Make network-oriented commands understand multi-service Splice targets without breaking existing ledger deploy flows.

Expected module work:

- `src/lib/deployer.ts`
- `src/lib/ledger-client.ts`
- auth-related commands and supporting libraries
- new validator/Scan/wallet/OIDC client wrappers if required

Planned outcomes:

- `deploy` remains stable for DAR-to-ledger flows.
- Splice-specific deploy/bootstrap work only lands if there is a stable upstream contract to call.
- Auth handling distinguishes sandbox JWT, stored JWT, and wallet/OIDC-backed flows.

Tests to add:

- deployer tests for capability-aware target selection
- auth tests for profile-specific credential resolution
- no fake reimplementation of wallet behavior

Exit criteria:

- Existing `deploy local|devnet|testnet|mainnet` flows still work.
- Splice-specific actions are either supported through a stable adapter or explicitly deferred.

### M5. Scaffold, Serve, and Playground Integration

Objective:

Expose the new profile model to generated projects and IDE-facing workflows.

Expected module work:

- `src/lib/scaffold.ts`
- `src/lib/serve.ts`
- `src/commands/playground.ts`
- `src/commands/serve.ts`
- docs under `docs/reference/` and `docs/tasks/`

Planned outcomes:

- Scaffolded projects can declare local runtime profiles explicitly.
- `serve` and `playground` remain stable for ledger-centric profiles.
- Splice wallet-backed IDE flows only ship behind an experimental boundary and only after validator/wallet routing is proven.

Tests to add:

- scaffold tests for profile-aware config generation
- serve/playground tests for profile-aware capability resolution
- future Splice browser-flow coverage only after upstream contracts are stable

Exit criteria:

- New projects can opt into the right local profile without hand-editing the entire config.
- IDE workflows do not silently assume sandbox JWT in Splice mode.

### M6. Hardening, CI, and Docs Completion

Objective:

Promote only the parts of the Splice path that have earned stability.

Expected work:

- CI shape updates in `.github/workflows/ci.yml`
- command docs and troubleshooting updates
- roadmap and README follow-up after runtime milestones are real

Planned outcomes:

- Separate required vs informational CI for Splice runtime coverage.
- Clear troubleshooting for missing upstream artifacts or auth services.
- Stable features documented as stable; experimental features documented as experimental.

Exit criteria:

- CI coverage matches the stability level of each runtime.
- README and reference docs describe the actual shipped behavior, not the aspirational plan.

## Cross-Cutting Guardrails

- Do not change the default `sandbox` workflow while building Splice support.
- Do not collapse Splice-specific services into `networks.type: docker`.
- Keep all new runtime modules DI-friendly and test-first.
- Preserve `CantonctlError`, `--json`, thin commands, and `AbortSignal` rules.
- Prefer upstream specs and generated clients over handwritten protocol copies.

## Open Questions

- What is the authoritative upstream launcher contract for Splice LocalNet in this repo: Docker Compose, a wrapper script, or another distribution?
- Which upstream specs are canonical for validator, Scan, wallet, and OIDC endpoints?
- Can profiles be added to the current config schema cleanly, or does this require a config version bump?
- Which parts of `serve` and `playground` should stay ledger-only in the first Splice milestone?

## Immediate Next Step

Start with M1. Do not implement Splice runtime behavior until the profile and capability foundation is in place.
