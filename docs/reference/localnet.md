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
```

## Behavior

- Detects an upstream-style LocalNet workspace
- Delegates to the workspace’s existing `make` targets
- Reports discovered ledger, wallet, validator, and scan URLs
- Keeps validator `readyz` as the default health probe

## JSON Support

All LocalNet commands support `--json`.

## Source

- Commands: [`src/commands/localnet/`](../../src/commands/localnet)
- Workspace detection: [`src/lib/localnet-workspace.ts`](../../src/lib/localnet-workspace.ts)
- Wrapper logic: [`src/lib/localnet.ts`](../../src/lib/localnet.ts)
