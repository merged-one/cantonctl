# `cantonctl auth`

Manage profile-aware app and operator credentials for local and remote environments.

This is a companion surface. It helps teams wire auth around profiles and stable/public workflows; it does not replace upstream identity, OIDC, wallet, or validator auth flows.

## Subcommands

- `auth login <network> [--scope app|operator]`
- `auth logout <network> [--scope app|operator]`
- `auth status`

## Credential Scopes

`cantonctl` tracks two credential scopes per resolved network:

- `app`: read and user-facing flows such as readiness, preflight, and stable/public surfaces
- `operator`: mutating control-plane flows such as `deploy` and any explicit operator-only companion surfaces

Local profiles (`sandbox`, `canton-multi`, `splice-localnet`) can use the built-in fallback token for both scopes. Remote mutating flows never inherit that fallback path.

## Auth Modes

Resolved auth profile modes include:

- `env-or-keychain-jwt`
- `bearer-token`

`bearer-token` covers two cases:

- explicitly supplied remote bearer tokens
- the built-in local fallback token path for sandbox, `canton-multi`, and `splice-localnet`

## Environment Variables

- app scope: `CANTONCTL_JWT_<NETWORK>`
- operator scope: `CANTONCTL_OPERATOR_TOKEN_<NETWORK>`

Both names uppercase the network and replace hyphens with underscores.

## Usage

```bash
cantonctl auth login devnet --scope app --token eyJhbGci...
cantonctl auth login devnet --scope operator --token eyJhbGci...
cantonctl auth status --json
cantonctl auth logout devnet --scope operator
```

`auth status --json` reports both scopes separately, including whether operator credentials are required for the resolved profile.

## CI Guidance

Prefer environment variables for CI and non-interactive rollout jobs:

```bash
export CANTONCTL_JWT_DEVNET=eyJhbGci...
export CANTONCTL_OPERATOR_TOKEN_DEVNET=eyJhbGci...
cantonctl auth status --json
cantonctl deploy --profile splice-devnet
```

## Related

- [Configuration](configuration.md)
- [Status](status.md)
- [Preflight](preflight.md)
