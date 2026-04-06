# ADR-0018: Own the Project-Local Control Plane over the Official Runtime Stack

**Status:** Accepted
**Date:** 2026-04-05
**Authors:** Charles Dusek

## Context

[ADR-0016](0016-splice-aware-companion-positioning.md) corrected the repo's top-level positioning:

- `cantonctl` is a Splice-aware orchestration companion
- official tools remain authoritative in their own lanes
- stable/public surfaces remain the default path

That clarification fixed the repo's broad "be the whole platform" drift, but some docs and help text over-corrected in the other direction. Several current command and reference surfaces describe the product boundary as though `cantonctl` should remain only a read-only or advisory helper around the official runtime stack.

That is too narrow.

The accepted product boundary is not "replace the official stack", but it is also not "stay a support-only wrapper forever." The repo needs one explicit statement of ownership for:

- sandbox, `dev --net`, and official LocalNet workflows
- remote validator-backed and SV/Scan-backed profiles
- project-local rollout, readiness, diagnostics, and day-2 operations

The repo also needs a rule for how current read-only command behavior is documented while that broader control-plane boundary is still being implemented.

## Decision

`cantonctl` owns the **project-local control plane** and **day-2 operations layer** over the official Canton and Splice runtime stack.

### Ownership boundary

`cantonctl` owns:

- profile-first environment resolution
- capability inventory and runtime discovery
- auth orchestration and credential handling for control-plane actions
- status, readiness, diagnostics, and drift reporting
- plan/apply/reconcile workflows over supported official runtime artifacts and approved upstream contracts
- explicit operator-mode or experimental wrappers for approved operator/internal surfaces

### Official-stack boundary

`cantonctl` does not replace:

- DPM as the canonical build, test, codegen, sandbox, and Studio launcher
- Daml Studio as the canonical IDE
- CN Quickstart as the official reference app and LocalNet launch path
- the dApp SDK, Wallet Gateway, dApp API, and Wallet SDK as the canonical wallet-connected integration stack
- validator, Scan, wallet, or OIDC implementations owned by official upstream artifacts
- cloud/Kubernetes/Terraform/Helm provisioning owned by external deployment tooling

The product rule from ADR-0016 still applies: wrap, do not replace.

### Default-path policy

- Stable/public surfaces remain the default path.
- Operator-only and internal surfaces are not part of the default story.
- When `cantonctl` supports operator/internal flows, they must stay behind explicit operator-mode or experimental surfaces.

### Documentation policy for partial implementations

Current command behavior must be documented as the **current branch scope**, not as a permanent product non-goal, unless an accepted ADR explicitly says the capability is out of scope.

That means:

- current read-only or advisory behavior may be described as current behavior
- docs must not imply that broader project-local control-plane ownership is forbidden
- reference docs remain the source of truth for what the current branch actually does today

### Documentation update rule

Whenever functionality is added or trimmed:

1. update implementation and tests
2. update command help and `docs/reference/*.md`
3. update `docs/CURRENT_STATE.md` if the supported surface changed
4. add or update an ADR if the ownership boundary or architecture changed
5. add release or migration notes when user behavior or terminology changed
6. update aggregate guidance docs last

## Consequences

### Positive

- Preserves the companion positioning without collapsing into a support-only story
- Makes the intended control-plane ownership explicit for follow-on implementation work
- Keeps official-stack boundaries clear for LocalNet, wallet, and runtime ownership
- Gives docs and help surfaces a rule for describing current read-only behavior without turning it into policy

### Negative

- Some existing docs and help text must be rewritten to distinguish current branch scope from permanent product scope
- Current-state docs must be careful to describe implemented behavior without drifting back into roadmap language
- Future operator-mode work must stay disciplined about default-path stability boundaries

## References

- [ADR-0016](0016-splice-aware-companion-positioning.md)
- [ADR-0017](0017-local-topology-builder-and-net-mode.md)
- [README.md](../../README.md)
- [docs/CURRENT_STATE.md](../CURRENT_STATE.md)
- [docs/BEST_PRACTICES.md](../BEST_PRACTICES.md)
- [docs/concepts/ecosystem-fit.md](../concepts/ecosystem-fit.md)
- [docs/concepts/non-goals.md](../concepts/non-goals.md)
