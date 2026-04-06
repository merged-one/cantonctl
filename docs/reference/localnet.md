# LocalNet Commands

`cantonctl localnet` wraps the official Splice LocalNet workspace. It does not replace Quickstart and it does not redefine `dev --net`.

## Purpose

- Use Quickstart for the official reference app and LocalNet launchpad
- Use `cantonctl localnet ...` when you want a project-local wrapper around that official workspace
- Keep `dev --net` for the Canton-only topology generated under `.cantonctl/`

## Commands

```bash
cantonctl localnet up --workspace <path> [--profile <name>]
cantonctl localnet down --workspace <path>
cantonctl localnet status --workspace <path>
cantonctl profiles import-localnet --workspace <path> [--write]
```

## Behavior

- Detects an upstream-style LocalNet workspace
- Delegates to the workspace’s existing `make` targets
- Reports discovered ledger, wallet, validator, and scan URLs
- Keeps validator `readyz` as the default health probe
- Can materialize the detected workspace as a canonical `splice-localnet` profile plus `networks.<name>.profile` wiring

## JSON Support

All LocalNet commands support `--json`.

`localnet up --json` and `localnet status --json` also include the same schema-versioned `inventory` contract used by `cantonctl status --json`, with `localnet-workspace` provenance for workspace-discovered services and capabilities.

They also include:

- `drift[]`: LocalNet workspace drift classification, including service reachability and boundary ownership
- `reconcile.supportedActions[]`: companion-supported LocalNet recovery steps such as `cantonctl localnet up --workspace ...`
- `reconcile.runbook[]`: explicit manual steps when the workspace exposes surfaces outside the current managed boundary

## Source

- Commands: [`src/commands/localnet/`](../../src/commands/localnet)
- Workspace detection: [`src/lib/localnet-workspace.ts`](../../src/lib/localnet-workspace.ts)
- Wrapper logic: [`src/lib/localnet.ts`](../../src/lib/localnet.ts)
