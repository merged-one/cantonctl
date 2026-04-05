# `cantonctl init`

Scaffold a companion-ready project from a starter template.

If you want the official reference app and LocalNet launchpad, start from CN Quickstart instead. Use `cantonctl init` when you want a project-local companion layer with profiles, diagnostics, and stable/public Splice-oriented starters.

## Usage

```bash
cantonctl init <name> [flags]
```

## Template Order

Stable/public Splice workflows lead the default selection order:

1. `splice-dapp-sdk`
2. `splice-scan-reader`
3. `splice-token-app`

## Quickstart-Aware Guidance

- Choose Quickstart when you want the official reference app path
- Choose `splice-dapp-sdk` when you want a browser-facing starter around the official dApp SDK and Wallet SDK
- Choose `splice-scan-reader` when you want stable/public Scan ingestion
- Choose `splice-token-app` when you want stable/public token-standard examples

## Flags

| Flag | Description |
|---|---|
| `--template`, `-t` | Built-in template |
| `--json` | Output structured JSON |

## Source

- Command: [`src/commands/init.ts`](../../src/commands/init.ts)
- Logic: [`src/lib/scaffold.ts`](../../src/lib/scaffold.ts)
