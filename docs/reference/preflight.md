# `cantonctl preflight`

`preflight` is the current read-only readiness check for remote profiles.

On this branch the command remains advisory. It helps teams validate profile coherence, auth mode, stable/public service reachability, and network-specific reminders before they promote or deploy.

## Intended Usage

```bash
cantonctl preflight --profile splice-devnet
cantonctl preflight --profile splice-devnet --json
```

## Default Scope

- resolved profile validation
- auth-mode validation
- Scan reachability when configured
- stable/public service reachability checks where the profile exposes them
- network reminders for DevNet, TestNet, and MainNet

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
