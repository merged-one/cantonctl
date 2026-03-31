# cantonctl dev

Start a local Canton development environment with sandbox, party provisioning, and hot-reload.

## Usage

```bash
cantonctl dev [flags]
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port` | `-p` | `5001` | Canton participant node port |
| `--json-api-port` | — | `7575` | JSON Ledger API port |
| `--full` | — | `false` | Start full multi-node topology (requires Docker). Deferred beyond the v1 core flow. |
| `--json` | — | `false` | Output result as JSON |

## Startup Sequence

1. **SDK detection** — Finds `dpm` (preferred) or `daml` on PATH
2. **Port check** — Verifies both ports are free before starting
3. **Sandbox start** — Spawns `dpm sandbox --port <port> --json-api-port <jsonApiPort>`
4. **Health polling** — Retries `GET /v2/version` every 1s for up to 60s
5. **JWT generation** — Creates HS256 token with all configured parties
6. **Party provisioning** — Allocates parties from `cantonctl.yaml` (idempotent: skips existing parties)
7. **File watcher** — Watches `daml/` for `.daml` file changes with 300ms debounce

## Hot-Reload

When a `.daml` file changes in the `daml/` directory:

1. Build is triggered via `dpm build` (or `daml build`)
2. The `.dar` file is located in `.daml/dist/`
3. The DAR is uploaded to the running sandbox via `POST /v2/dars`

Features:
- **Debounce:** 300ms delay prevents rapid-fire rebuilds during multi-file saves
- **Queue:** If a build is in progress, the next change is queued (not dropped or duplicated)
- **Non-crashing:** Build errors are reported via the output writer but don't stop the dev server
- **Filtered:** Only `.daml` file changes trigger rebuilds

## Shutdown

- **Ctrl+C** or **SIGINT/SIGTERM** — Graceful shutdown (stops watcher, kills sandbox)
- **`q` key** — Same as Ctrl+C (TTY mode only)

Shutdown cleans up all resources: file watcher closed, debounce timer cleared, sandbox process killed, stdin restored.

## Examples

```bash
# Start with defaults (port 5001, JSON API 7575)
cantonctl dev

# Custom ports
cantonctl dev --port 6001 --json-api-port 8575

# JSON output for CI (emits structured result, then waits for shutdown)
cantonctl dev --json
```

## JSON Output

```json
{
  "success": true,
  "data": {
    "port": 5001,
    "jsonApiPort": 7575,
    "parties": ["Alice", "Bob"],
    "status": "running"
  }
}
```

## Error Codes

| Code | Error | Resolution |
|------|-------|------------|
| E2001 | SDK not installed | Install dpm or daml: https://docs.daml.com/getting-started/installation.html |
| E3001 | Sandbox start failed | Check SDK installation and port availability |
| E3002 | Port in use | Stop the existing process or use `--port` / `--json-api-port` |
| E3003 | Health timeout | Sandbox didn't become healthy within 60s. Check logs. |
| E4001 | Build error (hot-reload) | Fix Daml compilation errors. Dev server continues running. |

## Prerequisites

- `dpm` or `daml` CLI on PATH
- A `cantonctl.yaml` in the current directory (or any parent)

## Source

- Command: [`src/commands/dev.ts`](../../src/commands/dev.ts)
- Logic: [`src/lib/dev-server.ts`](../../src/lib/dev-server.ts)
- Dependencies: [`src/lib/daml.ts`](../../src/lib/daml.ts), [`src/lib/ledger-client.ts`](../../src/lib/ledger-client.ts), [`src/lib/jwt.ts`](../../src/lib/jwt.ts)
