# `cantonctl status`

Show profile-aware service health and ledger status.

`status` is part of the companion support surface. It summarizes a resolved profile or legacy network target without claiming to be a full observability stack.

## Usage

```bash
cantonctl status [flags]
```

## What It Reports

- resolved profile or network target
- configured service endpoints
- derived control-plane ownership and management metadata in JSON service entries
- ledger health when a ledger-capable target is available
- ledger version and party list when available
- multi-node summaries for the Canton-only topology

## Flags

| Flag | Description |
|---|---|
| `--network`, `-n` | Legacy network target |
| `--profile` | Resolved runtime profile |
| `--json` | Output structured JSON |

## Related

- [Compatibility](compatibility.md)
- [Auth](auth.md)
- [Preflight](preflight.md)
