# Experimental Operator Surfaces

These commands and auth variants are intentionally outside cantonctl's GA surface. They wrap upstream validator-internal and external-signing-adjacent flows that upstream documentation classifies as internal or operator-only.

## Non-Negotiable Rules

- Every `cantonctl validator experimental ...` command requires `--experimental`.
- Human-readable output prints explicit warnings before the command runs.
- Stable commands do not import these experimental modules.
- Prefer the stable `validator traffic-buy` and `validator traffic-status` commands for validator-user workflows.

## Auth Profile Modes

`cantonctl auth login` and `cantonctl auth status` resolve one of these auth modes per network:

| Mode | Meaning | Stability |
|------|---------|-----------|
| `env-or-keychain-jwt` | Stable JWT resolution via `CANTONCTL_JWT_<NETWORK>` or the OS keychain | Stable |
| `bearer-token` | Caller-managed bearer token, optionally stored for reuse | Stable operator path |
| `oidc-client-credentials` | Externally minted OIDC client-credentials access token | Experimental/operator-only |
| `localnet-unsafe-hmac` | Local-only sandbox or LocalNet HMAC/shared-secret shortcut | Experimental/unsafe |

`oidc-client-credentials` and `localnet-unsafe-hmac` require explicit `--experimental` confirmation in `auth login`.

## Validator Experimental Commands

All commands below take a required `<network>` argument, optional `--validator-url` and `--token` overrides, and mandatory `--experimental`.

### `validator experimental register-user <network>`

Operator-only wrapper for `POST /v0/admin/users`.

```bash
cantonctl validator experimental register-user devnet --name alice --experimental
```

Flags:

| Flag | Description |
|------|-------------|
| `--name <user>` | User name to onboard |
| `--party-id <party>` | Optional existing or desired party id |
| `--create-party-if-missing` | Create the requested party when missing |
| `--token <jwt>` | Operator JWT bearer token |
| `--validator-url <url>` | Explicit validator base URL |
| `--experimental` | Required acknowledgement |
| `--json` | JSON output |

### `validator experimental offboard-user <network>`

Operator-only wrapper for `POST /v0/admin/users/offboard`.

```bash
cantonctl validator experimental offboard-user devnet --username alice --experimental
```

### `validator experimental external-party-generate <network>`

Operator-only wrapper for `POST /v0/admin/external-party/topology/generate`.

```bash
cantonctl validator experimental external-party-generate devnet --party-hint alice --public-key <hex> --experimental
```

### `validator experimental external-party-submit <network>`

Operator-only wrapper for `POST /v0/admin/external-party/topology/submit`.

```bash
cantonctl validator experimental external-party-submit devnet \
  --public-key <hex> \
  --signed-topology-tx <base64-topology-tx>:<hex-signature> \
  --experimental
```

Repeat `--signed-topology-tx` once per signed topology transaction.

### `validator experimental setup-preapproval <network>`

Operator-only wrapper for `POST /v0/admin/external-party/setup-proposal`.

```bash
cantonctl validator experimental setup-preapproval devnet --user-party-id Alice::1220 --experimental
```

This creates the setup proposal contract. Accepting and submitting it remains an explicitly experimental external-signing flow.

## Source

- Commands: [`src/commands/validator/experimental/`](../../src/commands/validator/experimental/)
- Validator-internal adapter: [`src/lib/experimental/validator-internal.ts`](../../src/lib/experimental/validator-internal.ts)
- External-signing adapter: [`src/lib/experimental/external-signing.ts`](../../src/lib/experimental/external-signing.ts)
