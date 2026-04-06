# `cantonctl operator`

Run approved operator-mode commands without widening the default stable/public CLI.

This namespace is explicit by design. It is where `cantonctl` places admin or mixed-scope actions that are approved for the companion, while keeping the default command surface stable/public-first.

## Current Command

### `operator validator licenses`

List approved validator licenses through the Scan admin endpoint.

Upstream contract:

- source id: `splice-scan-external-openapi`
- stability: `stable-external`
- service: `scan`

Even though the upstream contract is stable, the command stays under `operator` because the endpoint is admin-facing and requires explicit operator auth.

```bash
cantonctl operator validator licenses --profile splice-devnet
cantonctl operator validator licenses --profile splice-devnet --after 25 --limit 25 --json
```

**Flags**

| Flag | Default | Description |
|---|---|---|
| `--profile <name>` | — | Resolved remote profile that exposes the approved operator Scan surface |
| `--after <n>` | — | Pagination token from a prior validator-license page |
| `--limit <n>` | — | Maximum number of licenses to return |
| `--json` | `false` | Output as JSON |

## Boundary Rules

- operator commands require a remote profile that resolves explicit operator credentials
- command availability is checked against manifest source IDs, manifest stability classes, and control-plane metadata
- unsupported validator-internal, wallet-internal, and scan-proxy admin surfaces stay out of the CLI until explicitly approved
- LocalNet remains an official workspace wrapper; it is not reintroduced as a custom operator runtime

## JSON Output

`--json` includes:

- `surface.commandPath`, `surface.surfaceId`, `surface.upstreamSourceIds`, and `surface.stability`
- control-plane metadata for the approved service entry
- `auth.credentialSource` and the required operator env var name
- normalized validator-license contracts plus `nextPageToken` when more pages exist

## Related

- [API stability](api-stability.md)
- [Upstream source manifest](upstream-sources.md)
- [Auth](auth.md)
- [Status](status.md)
