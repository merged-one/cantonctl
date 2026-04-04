# `cantonctl deploy`

Run the advisory DAR deploy wrapper for ledger-capable targets.

This command is intentionally narrower than a validator deployment control plane. It helps with DAR upload workflows around the ledger API. It does not claim to be the canonical way to provision or operate remote validator infrastructure.

## Usage

```bash
cantonctl deploy [network] [flags]
```

## Current Scope

- local sandbox DAR upload
- legacy network-target DAR upload
- dry-run validation for ledger connectivity and auth
- multi-node fan-out only for the local Canton-only topology

## Positioning

- Use DPM and the official stack for canonical build and environment workflows
- Use `deploy` when a project already needs the `cantonctl` wrapper around ledger-capable DAR upload
- Expect later profile-first readiness checks to live in `preflight`, not inside deploy-by-default behavior

## Flags

| Flag | Description |
|---|---|
| `--dar` | DAR path |
| `--dry-run` | Validate without upload |
| `--party` | Override deploying party |
| `--json` | Output structured JSON |

## Related

- [Auth](auth.md)
- [Status](status.md)
- [Preflight](preflight.md)
