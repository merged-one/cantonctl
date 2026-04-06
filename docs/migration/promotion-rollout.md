# Promotion Rollout

If you previously used `cantonctl promote diff` as a read-only comparison helper, the default behavior is still non-mutating.

What changed:

- `promote diff` now accepts `--plan`, `--dry-run`, and `--apply`
- the default mode is `plan`
- JSON consumers should treat `data.rollout` as the canonical promotion contract
- `--dry-run` and `--apply` also return `data.preflight` and `data.readiness` for the target profile

Boundary expectations stay the same:

- official-stack and operator steps remain explicit/manual
- missing target auth or readiness blockers still fail the command
- companion-owned automation does not replace Quickstart, LocalNet, validator, wallet, or cloud tooling
