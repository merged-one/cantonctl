# Upgrade And Reset Rollouts

This release turns `cantonctl upgrade check` and `cantonctl reset checklist` into plan-first day-2 rollout workflows.

Shipped behavior:

- both commands now accept `--plan`, `--dry-run`, and `--apply`
- both commands now emit the shared `rollout` contract with explicit steps, blockers, warnings, and runbook items
- supported apply automation is currently limited to `splice-localnet` profiles through cycling an existing official LocalNet workspace
- remote validator and remote SV targets remain manual-only, with operator and official-stack boundaries left explicit in the output
- reset workflows now support either advisory network-tier planning or profile-aware local/runtime workflows
- apply mode on successful LocalNet runs now includes post-upgrade or post-reset readiness follow-up

This stays inside the project-local companion boundary. It does not add remote destructive automation, upstream runtime ownership, or cloud provisioning.
