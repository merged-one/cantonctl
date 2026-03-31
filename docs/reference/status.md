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
| `--json` | — | `false` | Output as JSON |

## Behavior

1. Loads `cantonctl.yaml` and looks up the specified network
2. Generates a JWT for authentication
3. Queries `GET /v2/version` to check health
4. Queries `GET /v2/parties` to list active parties
5. Displays results as table (human) or JSON

Exits with code 1 if the node is not reachable.

## Examples

```bash
cantonctl status                     # Query local network
cantonctl status --network devnet    # Query devnet
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
