# `cantonctl reset checklist`

Plan or execute a reset workflow for a network tier or resolved profile.

## Usage

```bash
cantonctl reset checklist --network devnet
cantonctl reset checklist --profile splice-localnet --workspace ../quickstart --dry-run
cantonctl reset checklist --profile splice-localnet --workspace ../quickstart --apply
cantonctl reset checklist --network mainnet --json
```

## Modes

- default mode is `plan`
- `--dry-run` runs live validation without mutating steps
- `--apply` executes only supported companion-owned automation

## Inputs

- choose exactly one of `--network <tier>` or `--profile <name>`
- `--workspace <path>` is required for live LocalNet reset automation
- `--json` returns the structured reset report, including `checklist`, `automation`, `network`, `rollout`, and `readiness` when applicable

## Scope

- `--network devnet|testnet|mainnet` stays advisory and boundary-aware
- `--profile <name>` enables profile-aware reset workflows
- supported apply automation is limited to `splice-localnet` profiles through the existing official LocalNet workspace

## Network expectations

- `devnet` and `testnet` emphasize reset-aware runbooks
- `mainnet` emphasizes continuity, backups, and investigation of unexpected discontinuities

## Boundary

- remote reset execution remains operator-owned
- `cantonctl` only cycles the existing official LocalNet workspace after you decide the reset boundary
- destructive upstream/runtime side effects stay explicit in the runbook output
