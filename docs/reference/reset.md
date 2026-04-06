# `cantonctl reset checklist`

Show the current reset-sensitive checklist items for DevNet, TestNet, or MainNet.

## Usage

```bash
cantonctl reset checklist --network devnet
cantonctl reset checklist --network mainnet --json
```

## Scope

- `devnet` and `testnet` emphasize reset-aware runbooks
- `mainnet` emphasizes continuity, backups, and investigation of unexpected discontinuities

On this branch, `reset checklist` remains a reporting surface rather than an apply flow.
