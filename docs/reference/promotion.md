# `cantonctl promote diff`

Compare two profiles before promotion.

`promote diff` is advisory only. It does not roll out changes or mutate remote infrastructure.

## Usage

```bash
cantonctl promote diff --from splice-devnet --to splice-testnet
cantonctl promote diff --from splice-testnet --to splice-mainnet --json
```

## What it checks

- service endpoint differences
- target auth-material readiness
- stable/public scan presence
- reset-sensitive network changes
- migration-policy reminders
- LocalNet version-line changes when relevant

