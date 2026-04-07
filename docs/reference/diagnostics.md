# `cantonctl diagnostics bundle`

Export a read-only, JSON-first diagnostics bundle for a resolved profile.

## Usage

```bash
cantonctl diagnostics bundle --profile splice-devnet
cantonctl diagnostics bundle --profile splice-devnet --output .cantonctl/diagnostics/devnet --json
```

## Flags

| Flag | Description |
|---|---|
| `--profile <name>` | Resolve diagnostics against the selected profile instead of `default-profile` |
| `--output <dir>` | Write the bundle to a specific directory |
| `--json` | Wrap the written bundle summary and collected snapshot in `cantonctl` JSON output |

When `--output` is omitted, bundles are written to `.cantonctl/diagnostics/<profile-name>`.

## Bundle contents

The bundle now writes these support artifacts:

- `profile.json`: resolved profile snapshot, including definition source and declared services
- `auth.json`: app and operator auth summary without secret material
- `compatibility.json`: pinned-line pass/warn/fail counts
- `services.json`: compatibility service inventory
- `inventory.json`: authoritative runtime inventory and provenance snapshot
- `drift.json`: control-plane drift classification and reconcile summary
- `health.json`: `readyz` and `livez` probe results
- `metrics.json`: metrics endpoint reachability summary
- `validator-liveness.json`: stable/public validator-license hints when Scan is available
- `last-operation.json`: the last stored deploy, promotion, upgrade, or reset summary when available

## Last-Operation Artifact

Control-plane workflows persist the latest support-oriented operation summary at:

```text
.cantonctl/control-plane/last-operation.json
```

This is best-effort project-local state. It is intended to help support and operator triage, not to act as a historical event log or monitoring pipeline.

## Redaction Boundary

Bundle output redacts obvious secret-bearing fields such as token, password, authorization, cookie, and bearer-token values before writing JSON to disk.

Diagnostics bundles remain support artifacts. They do not replace upstream logs, metrics systems, dashboards, or operator-owned observability stacks.
