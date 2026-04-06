# vNEXT Operator Auth Migration

Remote profiles now distinguish between app credentials and operator credentials.

## What Changed

- read and user-facing flows continue to use the app credential path
- mutating control-plane flows such as `deploy` use the operator credential path
- remote mutations no longer fall back to sandbox-style generated tokens

## Required Operator Action

For remote environments that support mutating control-plane actions, provide operator credentials with either:

```bash
cantonctl auth login devnet --scope operator --token eyJhbGci...
```

or:

```bash
export CANTONCTL_OPERATOR_TOKEN_DEVNET=eyJhbGci...
```

If your workflows also use read and readiness surfaces, keep the app credential path configured as well:

```bash
cantonctl auth login devnet --scope app --token eyJhbGci...
export CANTONCTL_JWT_DEVNET=eyJhbGci...
```

## Expected Behavior Changes

- `auth status` now reports app and operator scopes separately
- `preflight`, `readiness`, and `status` show whether operator auth is required
- remote `deploy` fails fast when operator credentials are missing
