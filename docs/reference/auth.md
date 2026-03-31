# cantonctl auth

Manage JWT credentials for Canton networks. Credentials are stored securely and retrieved automatically by `deploy` and `console`.

## Subcommands

### `auth login <network>`

Store a JWT token for a network. Validates connectivity before persisting.

```bash
cantonctl auth login devnet
cantonctl auth login devnet --token eyJhbGci...   # Skip the prompt
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--token <jwt>` | `-t` | JWT token (prompted interactively if not provided). |
| `--json` | — | JSON output. |

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

Show authentication state for all configured networks.

```bash
cantonctl auth status
```

Output:

```
┌─────────┬───────────────┬──────────┐
│ Network │ Authenticated │ Source   │
├─────────┼───────────────┼──────────┤
│ local   │ no            │ -        │
│ devnet  │ yes           │ keychain │
│ testnet │ yes           │ env      │
└─────────┴───────────────┴──────────┘
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
2. OS keychain (stored via `auth login`)
3. `null` → `deploy` throws E6001; `console` prompts

## Source

- Commands: [`src/commands/auth/`](../../src/commands/auth/)
- Logic: [`src/lib/credential-store.ts`](../../src/lib/credential-store.ts)
- ADRs: [ADR-0008](../adr/0008-deploy-pipeline.md)
