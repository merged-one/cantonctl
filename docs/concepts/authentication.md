# Authentication

Canton's JSON Ledger API requires a JWT Bearer token for every request — even the local sandbox. cantonctl manages this automatically for local development and provides credential management for remote networks.

## How Canton JWT Works

Canton tokens carry claims that control access:
- **`actAs`** — parties the token holder can submit commands as
- **`readAs`** — parties the token holder can query contracts for
- **`admin`** — whether the token grants admin operations (party allocation, DAR upload)
- **`applicationId`** — identifier for the application

The sandbox decodes but does not validate token signatures. Production participants validate against a configured auth provider.

## Local Development (Automatic)

When targeting sandbox, `canton-multi`, or `splice-localnet` profiles, cantonctl generates or resolves the built-in local fallback token automatically. No manual auth setup is needed for those local workflows.

```bash
cantonctl dev       # Auto-generates JWT for party provisioning
cantonctl deploy    # Auto-generates JWT for DAR upload
cantonctl status    # Auto-generates JWT for health checks
cantonctl readiness # Reuses the local fallback path in the composed gate
```

The sandbox secret is intentionally public: `canton-sandbox-secret-do-not-use-in-production`.

## Remote Networks (Credential Store)

For remote profiles and their mapped networks, you store a JWT token via the credential store:

```bash
cantonctl auth login devnet --token eyJhbGci...
cantonctl readiness --profile splice-devnet
cantonctl deploy --profile splice-devnet
```

### Resolution Order

When cantonctl needs a token for a network, it checks:
1. **Environment variable** — `CANTONCTL_JWT_<NETWORK>` (recommended for CI)
2. **OS keychain** — stored via `cantonctl auth login`
3. **Local fallback** — for sandbox, `canton-multi`, and `splice-localnet`
4. **Prompt / error** — if neither is available for a remote target

### Environment Variables for CI

```bash
export CANTONCTL_JWT_DEVNET=eyJhbGci...
cantonctl deploy --profile splice-devnet   # Uses env var, no keychain needed
```

Network names are uppercased with hyphens converted to underscores:
- `devnet` → `CANTONCTL_JWT_DEVNET`
- `my-network` → `CANTONCTL_JWT_MY_NETWORK`

## OS Keychain Storage

Credentials are stored in the platform's native keychain:
- **macOS** — Keychain Access
- **Linux** — Secret Service (GNOME Keyring, KDE Wallet)
- **Windows** — Credential Manager

If the native keychain is unavailable (CI, containers), cantonctl falls back to in-memory storage with a warning.

## Token Lifecycle

- **Default expiry**: 24 hours (local sandbox tokens)
- **Remote tokens**: expiry depends on the issuing auth provider
- **Refresh**: re-run `cantonctl auth login <network>` when tokens expire
- **Revocation**: `cantonctl auth logout <network>` removes the stored credential

## Related

- [Reference: auth command](../reference/auth.md)
- [Reference: deploy command](../reference/deploy.md)
