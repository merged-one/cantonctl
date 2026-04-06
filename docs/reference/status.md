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

## JSON Contract

`status --json` includes a schema-versioned `inventory` block that is the authoritative machine-readable runtime inventory for later control-plane work.

- `inventory.schemaVersion`: current inventory contract version
- `inventory.services[]`: service-level endpoint, health, runtime provenance, warnings, and drift hints
- `inventory.capabilities[]`: capability-level ownership, management eligibility, stability, warnings, and drift hints
- `inventory.drift[]`: aggregated profile-versus-runtime mismatches

Runtime provenance distinguishes configured endpoints from discovered runtime data:

- `declared`, `legacy-network`, and `derived-local-default` for config-backed resolution
- `generated-topology` for `dev --net` runtime discovery
- `remote-discovery` for remote network targets

Human output stays concise. The richer inventory details live in JSON.

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
