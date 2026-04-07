# `cantonctl upgrade check`

Plan or execute an upgrade workflow for a resolved profile.

`upgrade check` is the upgrade control-plane surface for `cantonctl`'s project-local day-2 boundary.

The command is plan-first:

- default mode is `plan`
- `--dry-run` runs live validation without mutating steps
- `--apply` executes only supported companion-owned automation

Today, supported apply automation is limited to `splice-localnet` profiles through the existing official LocalNet workspace. Remote validators, remote SV targets, and other runtimes stay manual-only, with the operator and official-stack boundaries made explicit in the emitted runbooks.

## Usage

```bash
cantonctl upgrade check --profile splice-devnet
cantonctl upgrade check --profile splice-localnet --workspace ../quickstart --dry-run
cantonctl upgrade check --profile splice-localnet --workspace ../quickstart --apply
cantonctl upgrade check --profile splice-mainnet --json
```

## Modes

- `plan`: inspect compatibility, auth material, scan-backed migration hints, and network reminders without live mutation
- `dry-run`: run live validation and return the same rollout contract that apply mode uses
- `apply`: perform the supported LocalNet workspace cycle for `splice-localnet` profiles, then run post-upgrade readiness

## Inputs

- `--profile <name>` resolves the target profile
- `--workspace <path>` is required for live LocalNet upgrade automation
- `--json` returns the structured upgrade report, including `advisories`, `automation`, `network`, `rollout`, and `readiness` when applicable

## What it validates

- compatibility baseline failures and warnings
- credential availability
- stable/public scan-backed migration hints when available
- reset-sensitive DevNet/TestNet reminders
- MainNet continuity reminders

## Boundary

- `cantonctl` does not choose or edit the upstream LocalNet/Quickstart version/config for you
- `cantonctl` can only cycle and validate an already-prepared LocalNet workspace
- remote upgrade execution remains operator-owned
- validator, wallet, Scan, and other upstream runtime internals remain outside the companion mutation surface
