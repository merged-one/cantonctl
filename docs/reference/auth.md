# `cantonctl auth`

Manage profile-aware auth and stored bearer credentials for remote environments.

This is a companion surface. It helps teams wire auth around profiles and stable/public workflows; it is not a replacement for upstream identity or wallet products.

## Subcommands

- `auth login <network>`
- `auth logout <network>`
- `auth status`

## Auth Modes

Resolved auth profile modes include:

- `env-or-keychain-jwt`
- `bearer-token`

`bearer-token` covers two cases:

- explicitly supplied remote bearer tokens
- the built-in local fallback token path for sandbox, `canton-multi`, and `splice-localnet`

## CI Guidance

Prefer environment variables for CI:

```bash
export CANTONCTL_JWT_DEVNET=eyJhbGci...
cantonctl auth status --json
```

## Related

- [Configuration](configuration.md)
- [Status](status.md)
- [Preflight](preflight.md)
