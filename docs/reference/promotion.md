# `cantonctl promote diff`

Plan or execute a profile-to-profile promotion rollout.

`promote diff` now uses the shared control-plane operation engine. The default mode is a non-mutating plan. Live modes run target gates over the resolved profile and keep official-stack and operator-owned work as explicit runbooks.

## Usage

```bash
cantonctl promote diff --from splice-devnet --to splice-testnet
cantonctl promote diff --from splice-devnet --to splice-testnet --dry-run
cantonctl promote diff --from splice-testnet --to splice-mainnet --apply --json
```

## Modes

- `plan` (default): compare source and target profiles and emit a rollout plan without live target inspection
- `dry-run`: run live target `preflight` and `readiness` gates without executing mutating steps
- `apply`: execute the same rollout operation in apply mode; companion-owned steps can complete where supported, while official-stack and operator work remains explicit/manual

## What it returns

In JSON mode, `promote diff` always returns:

- `from`, `to`, `services`, and `advisories` for the source-to-target comparison
- `rollout` as the canonical step, blocker, warning, and runbook contract

In `dry-run` and `apply` modes it also returns:

- `preflight`: the live target preflight gate
- `readiness`: the live target readiness gate

The command exits non-zero when the rollout contains blocking issues.

## What it checks

- service endpoint and surface differences between source and target profiles
- target auth-material readiness and compatibility state
- target runtime inventory, drift classification, and reconcile actions
- stable/public canary coverage for services exposed by the target profile
- reset-sensitive, migration, sponsor-input, and experimental-target advisories
- official-stack/manual runbooks that must be handled outside the default companion mutation boundary

## Explicit Boundaries

- no cloud or infrastructure provisioning
- no validator-internal or wallet-internal automation
- no automatic execution of official-stack or operator-only runbooks
- no replacement for Quickstart, LocalNet, validator, wallet, or upstream runtime implementations

`apply` means the operation runs in apply mode. It does not mean every step becomes automated; boundary-owned work still stays explicit in the runbook.
