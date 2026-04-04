# cantonctl auth

Manage auth profiles and bearer credentials for Canton networks. Credentials are stored securely and retrieved automatically by `deploy` and other network-targeted flows when the selected auth mode uses stored tokens.

## Subcommands

### `auth login <network>`

Store a bearer token for a network. `auth login` now resolves an auth profile mode first:

- `env-or-keychain-jwt` for the stable env-var or keychain JWT path
- `bearer-token` for explicit caller-managed tokens
- `oidc-client-credentials` for operator-managed OIDC access tokens
- `localnet-unsafe-hmac` for local-only sandbox or LocalNet auth shortcuts

Experimental modes require explicit confirmation.

```bash
cantonctl auth login devnet
cantonctl auth login devnet --token eyJhbGci...   # Skip the prompt
cantonctl auth login validator --mode oidc-client-credentials --token eyJhbGci... --experimental
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--experimental` | — | Required when the resolved or requested auth mode is experimental/operator-only. |
| `--mode <mode>` | — | Override the inferred auth profile mode. Options: `bearer-token`, `env-or-keychain-jwt`, `oidc-client-credentials`, `localnet-unsafe-hmac`. |
| `--token <jwt>` | `-t` | JWT token (prompted interactively if not provided). |
| `--json` | — | JSON output. |

`localnet-unsafe-hmac` is acknowledged rather than prompted by default. If you do not pass `--token`, cantonctl records the mode and warning but does not persist a credential.

---

### `auth logout <network>`

Remove stored credentials for a network.

```bash
cantonctl auth logout devnet
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | JSON output. |

---

### `auth status`

Show authentication state for all configured networks, including the resolved auth mode and whether the credential source is generated, env-based, keychain-backed, or in-memory.

```bash
cantonctl auth status
```

Output:

```
┌─────────┬──────────────────────┬───────────────┬───────────┐
│ Network │ Mode                 │ Authenticated │ Source    │
├─────────┼──────────────────────┼───────────────┼───────────┤
│ local   │ localnet-unsafe-hmac │ yes           │ generated │
│ devnet  │ env-or-keychain-jwt  │ yes           │ keychain  │
│ testnet │ oidc-client-credentials │ yes        │ env       │
└─────────┴──────────────────────┴───────────────┴───────────┘
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | JSON output. |

## Environment Variable Override

Setting `CANTONCTL_JWT_<NETWORK>` (network name uppercased, hyphens to underscores) takes precedence over any stored credential:

```bash
export CANTONCTL_JWT_DEVNET=eyJhbGci...
cantonctl deploy devnet   # Uses env var, ignores keychain
```

This is the recommended approach for CI pipelines.

## Credential Resolution Order

1. `CANTONCTL_JWT_<NETWORK>` environment variable
2. OS keychain or in-memory fallback (stored via `auth login`)
3. Generated/local-only auth for `localnet-unsafe-hmac`
4. `null` → token-required commands throw E6001

## Human Warnings

When the selected mode is `oidc-client-credentials` or `localnet-unsafe-hmac`, human-readable output emits explicit warnings before the command succeeds. The intent is to make unstable or local-only auth paths impossible to miss.

## Source

- Commands: [`src/commands/auth/`](../../src/commands/auth/)
- Auth profile resolver: [`src/lib/auth-profile.ts`](../../src/lib/auth-profile.ts)
- Logic: [`src/lib/credential-store.ts`](../../src/lib/credential-store.ts)
- ADRs: [ADR-0008](../adr/0008-deploy-pipeline.md)
