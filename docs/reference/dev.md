# `cantonctl dev`

Start the local sandbox wrapper with hot reload.

This command complements DPM rather than replacing it. The default path is sandbox-first. `dev --full` remains the Canton-only multi-node topology. Splice LocalNet stays separate under `cantonctl localnet ...`.

## Usage

```bash
cantonctl dev [flags]
```

## Runtime Model

- `cantonctl dev` wraps the local sandbox workflow
- `cantonctl dev --full` starts the Canton-only multi-node Docker topology
- `cantonctl localnet ...` wraps the official Splice LocalNet workspace

## DPM-First Notes

- Sandbox startup uses `dpm sandbox` on current toolchains
- Build and hot reload delegate to `dpm build`, with legacy `daml` fallback only when needed
- Daml Studio remains the canonical IDE; `dev` is the runtime wrapper behind local iteration

## Flags

| Flag | Description |
|---|---|
| `--port`, `-p` | Canton participant port |
| `--json-api-port` | JSON Ledger API port |
| `--full` | Start the Canton-only multi-node topology |
| `--json` | Output structured JSON |

## Source

- Command: [`src/commands/dev.ts`](../../src/commands/dev.ts)
- Logic: [`src/lib/dev-server.ts`](../../src/lib/dev-server.ts)
- Multi-node runtime: [`src/lib/dev-server-full.ts`](../../src/lib/dev-server-full.ts)
