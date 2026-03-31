# cantonctl deploy

Deploy a compiled DAR package to a Canton network via the 6-step pipeline.

## Usage

```bash
cantonctl deploy [network] [flags]
```

`network` defaults to `local`. Valid values: `local`, `devnet`, `testnet`, `mainnet` (must also be configured in `cantonctl.yaml`).

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--dar <path>` | — | auto-detect | Path to .dar file. Skips the build step when provided. |
| `--dry-run` | — | `false` | Execute steps 1-4 only. Validates and checks connectivity; does not upload. |
| `--party <name>` | — | from config | Override the deploying party. |
| `--json` | — | `false` | Output result as JSON. |

## Pipeline Steps

| Step | What happens |
|------|-------------|
| 1. Validate | Loads `cantonctl.yaml`, verifies the named network exists, resolves connection details. |
| 2. Build | Runs `cantonctl build` to produce a `.dar`, or resolves `--dar` if provided. |
| 3. Auth | Generates a sandbox JWT for `local` networks. For remote networks, retrieves the stored credential (see `cantonctl auth login`). |
| 4. Pre-flight | Calls `GET /v2/version` to confirm the node is reachable. `--dry-run` stops here. |
| 5. Upload | Posts the DAR bytes to `POST /v2/dars`. |
| 6. Verify | Confirms the returned `mainPackageId` and logs it. |

## Examples

```bash
cantonctl deploy                         # Deploy to local sandbox (default)
cantonctl deploy devnet                  # Deploy to devnet (must have stored credentials)
cantonctl deploy --dar ./my-app.dar      # Skip build, upload a specific DAR
cantonctl deploy --dry-run               # Validate + check connectivity, no upload
cantonctl deploy --json                  # JSON output for CI pipelines
```

## JSON Output

```json
{
  "success": true,
  "data": {
    "network": "local",
    "darPath": ".daml/dist/my-app-1.0.0.dar",
    "mainPackageId": "abc123def456...",
    "dryRun": false
  },
  "timing": { "durationMs": 834 }
}
```

## Error Codes

| Code | Error | Resolution |
|------|-------|------------|
| E1003 | Network not found in config | Add the network to `cantonctl.yaml` under `networks:` |
| E4002 | DAR not found | Run `cantonctl build` first, or pass `--dar <path>` |
| E6001 | Auth failed | Run `cantonctl auth login <network>` or set `CANTONCTL_JWT_<NETWORK>` |
| E6002 | Network unreachable | Ensure the Canton node is running. For local: try `cantonctl dev`. |
| E6003 | Upload failed | Check node logs. The DAR may be malformed. |
| E6004 | Package already exists | Increment the version in `daml.yaml` and rebuild. |

## Remote Networks

For non-local networks, `deploy` requires a stored JWT credential:

```bash
cantonctl auth login devnet              # Store credential
cantonctl deploy devnet                  # Uses stored credential
```

The env var `CANTONCTL_JWT_DEVNET` takes precedence over any stored credential.

## Source

- Command: [`src/commands/deploy.ts`](../../src/commands/deploy.ts)
- Logic: [`src/lib/deployer.ts`](../../src/lib/deployer.ts)
- ADRs: [ADR-0008](../adr/0008-deploy-pipeline.md)
