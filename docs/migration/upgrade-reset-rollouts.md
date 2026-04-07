# Upgrade And Reset Rollouts

If you previously used `cantonctl upgrade check` or `cantonctl reset checklist` as read-only helper surfaces, the default behavior is still non-mutating.

What changed:

- both commands now accept `--plan`, `--dry-run`, and `--apply`
- `upgrade check` now returns the same rollout contract shape used by the other control-plane workflow surfaces
- `reset checklist` now supports either `--network <tier>` or `--profile <name>`
- `--apply` is only supported for `splice-localnet` profiles when you also provide `--workspace`
- JSON consumers should treat `data.rollout` as the canonical upgrade/reset workflow contract

Boundary expectations stay the same:

- remote upgrade and reset execution remain manual/operator-owned
- Quickstart and LocalNet still own upstream version/config changes and reset semantics
- `cantonctl` only automates the supported LocalNet workspace cycle and follow-up validation
