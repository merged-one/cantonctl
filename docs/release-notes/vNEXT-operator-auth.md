# vNEXT Operator Auth Scopes

`cantonctl` now separates remote auth handling into app and operator scopes.

## Highlights

- `cantonctl auth login` and `cantonctl auth logout` support `--scope app|operator`
- `cantonctl auth status --json` reports app and operator state separately per network
- `preflight`, `readiness`, and `status` expose operator-auth requirement and credential provenance
- `deploy` now uses the resolved operator credential path for remote mutations
- remote mutating flows no longer inherit the local fallback token path

## New Environment Variables

- app scope: `CANTONCTL_JWT_<NETWORK>`
- operator scope: `CANTONCTL_OPERATOR_TOKEN_<NETWORK>`
