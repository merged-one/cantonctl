# ADR-0017: Local topology builder with `dev --net` and manifest-first workbench integration

**Status:** Accepted
**Date:** 2026-04-04

## Context

`cantonctl` already had a Canton-only multi-node Docker runtime behind `dev --full`, but that surface had three problems:

1. the public flag name did not reflect the repo's current product boundary
2. the topology was fixed rather than user-selectable
3. `serve` and `playground` inferred topology state indirectly from generated Docker Compose output

At the same time, the repo's in-doc planning and roadmap files had drifted away from the real feature set, which made agent and maintainer guidance unreliable.

## Decision

We accept the following decisions:

1. `cantonctl` owns a **local Canton topology builder**, not a Splice LocalNet replacement.
2. `dev --net` is the canonical multi-node local runtime flag. `--full` is removed immediately.
3. `playground --net` mirrors `dev --net`.
4. Named local topologies live under the top-level `topologies:` section in `cantonctl.yaml`, not under `profiles:`.
5. v1 topology-builder scope is intentionally narrow:
   - Canton-only local Docker runtime
   - one synchronizer
   - deterministic port plan from participant order
   - explicit participant list and party assignment
   - in-memory storage by default
   - no remote orchestration
   - no visual editor
6. `.cantonctl/topology.json` is the canonical generated runtime manifest for `serve` and `playground`.
7. Legacy Docker Compose parsing remains as a fallback only for previously-generated worktrees.
8. Repo guidance moves to a small canonical docs system:
   - `docs/CURRENT_STATE.md`
   - `docs/BEST_PRACTICES.md`
   - ADRs
   - reference docs
   - release and migration notes
   Active work tracking stays in GitHub, not in new in-repo roadmap files.

## Consequences

### Positive

- Local Canton topology design is now explicit, previewable, and versioned in repo config.
- `serve` and `playground` can support arbitrary participant counts without re-parsing Compose as the primary source of truth.
- The public runtime naming is aligned with the current companion positioning.
- Agents and maintainers have a smaller, more reliable set of canonical docs.

### Negative

- `--full` is a hard break. Existing scripts and docs must move to `--net`.
- There is now a separate local-topology concept alongside profiles, which requires explicit documentation.
- The repo still carries some historical ADRs and release notes that mention `--full`; those remain as legacy context, not current guidance.

## References

- [0014-dev-full-multi-node-topology.md](0014-dev-full-multi-node-topology.md)
- [0016-splice-aware-companion-positioning.md](0016-splice-aware-companion-positioning.md)
- [../CURRENT_STATE.md](../CURRENT_STATE.md)
- [../BEST_PRACTICES.md](../BEST_PRACTICES.md)
