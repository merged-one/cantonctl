# `cantonctl preflight`

`preflight` is the current read-only readiness check for remote profiles.

On this branch the command remains advisory. It helps teams validate profile coherence, app and operator auth material, stable/public service reachability, and network-specific reminders before they promote or deploy.

## Intended Usage

```bash
cantonctl preflight --profile splice-devnet
cantonctl preflight --profile splice-devnet --json
```

## Default Scope

- resolved profile validation
- auth-mode validation with separate app and operator credential checks
- Scan reachability when configured
- stable/public service reachability checks where the profile exposes them
- network reminders for DevNet, TestNet, and MainNet

## Auth Contract

`preflight` reports auth in two scopes:

- `app`: the credential path used for read and user-facing checks
- `operator`: the credential path required for mutating control-plane flows

For remote mutating profiles, missing operator material fails the `Operator credential material` check and points to either:

- `CANTONCTL_OPERATOR_TOKEN_<NETWORK>`
- `cantonctl auth login <network> --scope operator`

In JSON mode, the `auth` block includes nested `app` and `operator` entries with credential source, env var name, requirement status, and operator prerequisites.

## Explicit Non-Goals

- no infrastructure mutation
- no validator-internal automation in the default path
- no wallet-internal automation in the default path
- no rollout apply behavior on this branch

## Related

- [Configuration](configuration.md)
- [Auth](auth.md)
- [Status](status.md)
- [Compatibility](compatibility.md)
