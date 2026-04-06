# `cantonctl deploy`

Run the current DAR deploy flow for ledger-capable targets.

This command is the current ledger rollout step inside `cantonctl`'s broader project-local control-plane boundary. On this branch it focuses on DAR upload workflows around the ledger API. It does not provision infrastructure or replace official validator runbooks.

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
- Use `deploy` when a project already needs the current `cantonctl` wrapper around ledger-capable DAR upload
- Broader profile-first rollout behavior is follow-on work, not a product non-goal

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
