# ADR-0016: Position `cantonctl` as a Splice-Aware Orchestration Companion

**Status:** Accepted
**Date:** 2026-04-04
**Authors:** Charles Dusek

## Context

The merged Splice-aware state on `main` already contains a narrow but real wedge:

- profile-based environment control
- wrapping for the official Splice LocalNet workspace
- auth, compatibility, and status surfaces
- stable/public Scan, token-standard, ANS, and validator-user flows
- explicit experimental boundaries for operator-only and internal surfaces

The product story has not caught up with that code. Top-level docs and help text still present `cantonctl` as though it should become the full Canton platform, a canonical IDE, or a Hardhat/Remix analogue. That conflicts with current ecosystem boundaries:

- DPM is the official CLI for build, test, codegen, sandbox, and Studio launch.
- Daml Studio is the canonical IDE.
- CN Quickstart is the official reference app and LocalNet launchpad.
- The dApp SDK, dApp API, Wallet Gateway, and Wallet SDK own wallet-connected paths, including CIP-0103 integration.

## Decision

`cantonctl` will be positioned as the Splice-aware orchestration companion over the official Canton stack.

### Official-tool boundaries

- `cantonctl` complements DPM, Daml Studio, Quickstart, Wallet Gateway, the dApp SDK, and the Wallet SDK.
- `cantonctl` does not replace those tools.
- Default-path automation must stay on stable/public surfaces and profile-local config.

### Preserved strengths

- Keep the profile model and profile kinds already on `main`.
- Keep `localnet up/down/status` as a wrapper around the official LocalNet workspace.
- Keep stable/public Scan, token-standard, ANS, and validator-user commands.
- Keep explicit separation between stable/public and experimental surfaces.

### Target users

1. App and platform engineers moving from sandbox or LocalNet into validator-backed environments
2. Solution engineers, DevRel, and onboarding leads building repeatable demos and setup flows
3. CI, release, and operations engineers who need machine-readable readiness, compatibility, and diagnostics gates

### Non-goals

- Not the canonical build/test/codegen/sandbox/studio tool
- Not the canonical IDE
- Not a Quickstart replacement
- Not the primary wallet-provider or exchange toolkit
- Not the default UX for unstable internal APIs

### Language rules

Retire these phrases from primary product surfaces:

- “Hardhat for Canton”
- “complete developer toolchain for Canton”
- “Institutional-grade CLI toolchain for building on Canton Network”
- “Remix-like browser IDE” as flagship identity

Adopt these phrases instead:

- “Splice-aware orchestration companion”
- “wrap, do not replace”
- “stable/public”
- “experimental”

### Branching rule

All follow-on implementation work must start from updated `main`, never `dev`.

## Consequences

### Positive

- Aligns the product story with the repo’s strongest merged capabilities
- Clarifies where official tools should win
- Creates a defensible lane for profile-oriented operational helpers
- Makes stable/public boundaries explicit for future commands and CI gates

### Negative

- The top-level story becomes narrower than the original umbrella pitch
- Help text, docs, and tests need drift guardrails
- Some older research and historical docs will now read as legacy framing

## References

- [README.md](../../README.md)
- [docs/concepts/ecosystem-fit.md](../concepts/ecosystem-fit.md)
- [docs/concepts/non-goals.md](../concepts/non-goals.md)
- [docs/reference/api-stability.md](../reference/api-stability.md)
- [docs/reference/localnet.md](../reference/localnet.md)
- [ADR-0015](ADR-0015-splice-full-support-architecture.md)
