# LocalNet Commands

`cantonctl localnet` wraps an official Splice LocalNet workspace. It is intentionally separate from `cantonctl dev --full`.

- `cantonctl dev` remains the single-node sandbox workflow.
- `cantonctl dev --full` remains the generated Canton multi-node workflow under `.cantonctl/`.
- `cantonctl localnet ...` delegates to an upstream LocalNet workspace with its own `Makefile`, compose files, env files, and config.

## Commands

```bash
cantonctl localnet up --workspace <path> [--profile <name>]
cantonctl localnet down --workspace <path>
cantonctl localnet status --workspace <path>
```

All LocalNet commands support `--json`.

## Workspace Detection

The wrapper expects an upstream-style LocalNet layout:

- `Makefile`
- root compose file: `compose.yaml`, `compose.yml`, `docker-compose.yaml`, or `docker-compose.yml`
- `.env`
- `config/` directory
- LocalNet module files under `docker/modules/localnet/` or `cluster/compose/localnet/`

The LocalNet module must expose at least:

- `compose.yaml`
- `compose.env`
- `env/common.env`

The command layer does not generate a new topology format. It only recognizes the upstream workspace and delegates to its existing targets.

## Lifecycle

`localnet up`:

- detects the official workspace
- runs the upstream `make start` target
- passes `PROFILE=<name>` through when `--profile` is provided
- checks validator `readyz`
- reports discovered ledger, wallet, validator, and scan URLs

`localnet down`:

- detects the official workspace
- runs the upstream `make stop` target

`localnet status`:

- detects the official workspace
- runs the upstream `make status` target
- parses container status output
- checks validator `readyz`
- reports discovered service URLs

## Health And URL Discovery

The wrapper currently guarantees:

- validator health via `readyz`
- discovery of ledger, wallet, validator, and scan URLs from the workspace env/compose layout

The default health profile is `sv`. When `localnet up --profile <name>` is used with `app-user`, `app-provider`, or `sv`, the validator health probe follows that profile.

## Examples

```bash
cantonctl localnet up --workspace ../quickstart
cantonctl localnet up --workspace ../quickstart --profile sv
cantonctl localnet status --workspace ../quickstart --json
cantonctl localnet down --workspace ../quickstart
```

## Source

- Command wrappers: [`src/commands/localnet/up.ts`](../../src/commands/localnet/up.ts), [`src/commands/localnet/down.ts`](../../src/commands/localnet/down.ts), [`src/commands/localnet/status.ts`](../../src/commands/localnet/status.ts)
- Workspace detection: [`src/lib/localnet-workspace.ts`](../../src/lib/localnet-workspace.ts)
- Runtime wrapper: [`src/lib/localnet.ts`](../../src/lib/localnet.ts)
