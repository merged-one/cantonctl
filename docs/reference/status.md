# cantonctl status

Show node health, active parties, and version for a Canton network.

## Usage

```bash
cantonctl status [flags]
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--network` | `-n` | `local` | Network to query (must be defined in cantonctl.yaml) |
| `--profile` | — | — | Resolve and inspect a runtime profile instead of a legacy network target |
| `--json` | — | `false` | Output as JSON |

## Behavior

1. Loads `cantonctl.yaml`
2. Resolves either a legacy `network` target or a named `profile`
3. Builds a service list for the resolved profile kind
4. Queries the ledger `GET /v2/version` and `GET /v2/parties` when a local or ledger-capable target is available
5. Displays results as table (human) or JSON

Exits with code 1 if the node is not reachable.

## Examples

```bash
cantonctl status                     # Query local network
cantonctl status --network devnet    # Query devnet
cantonctl status --profile sandbox   # Inspect a runtime profile directly
cantonctl status --json              # JSON output for CI
```

## JSON Output

```json
{
  "success": true,
  "data": {
    "healthy": true,
    "version": "3.4.11",
    "network": "local",
    "profile": {
      "name": "local",
      "kind": "sandbox",
      "experimental": false
    },
    "services": [
      {
        "name": "ledger",
        "endpoint": "http://localhost:7575",
        "stability": "stable-external",
        "status": "healthy"
      }
    ],
    "parties": [
      { "displayName": "Alice", "identifier": "Alice::1234..." },
      { "displayName": "Bob", "identifier": "Bob::5678..." }
    ]
  }
}
```

## Error Codes

| Code | Error | Resolution |
|------|-------|------------|
| E1003 | Network not found in config | Add the network to cantonctl.yaml |
| E7001 | Node not reachable | Start the sandbox or check network URL |

## Source

- Command: [`src/commands/status.ts`](../../src/commands/status.ts)
