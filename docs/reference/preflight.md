# `cantonctl preflight`

`preflight` is the read-only rollout gate for a resolved profile.

In `0.3.6`, the command still does not mutate anything. It validates profile coherence, app and operator auth material, stable/public service reachability, and network-specific reminders before deploy or promotion, and it emits the same step/blocker model used by the control-plane rollout surfaces.

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
- drift classification over auth, service reachability, and pinned upstream-line expectations
- reconcile planning that emits companion-supported actions only when a supported control surface exists
- a read-only `rollout` contract with step, blocker, warning, and runbook metadata

## Auth Contract

`preflight` reports auth in two scopes:

- `app`: the credential path used for read and user-facing checks
- `operator`: the credential path required for mutating control-plane flows

For remote mutating profiles, missing operator material fails the `Operator credential material` check and points to either:

- `CANTONCTL_OPERATOR_TOKEN_<NETWORK>`
- `cantonctl auth login <network> --scope operator`

In JSON mode, the `auth` block includes nested `app` and `operator` entries with credential source, env var name, requirement status, and operator prerequisites.

`preflight --json` also includes:

- `inventory`: the schema-versioned runtime inventory for the resolved profile
- `drift[]`: classified control-plane drift with severity, boundary owner, and supported-vs-manual resolution
- `reconcile.supportedActions[]`: companion-supported next steps such as `cantonctl auth login`
- `reconcile.runbook[]`: explicit upstream or operator runbooks when the current surface is read-only, operator-only, or otherwise outside the companion mutation boundary
- `rollout`: a static read-only control-plane operation result in `dry-run` mode so later workflows can reuse the same structure

## Explicit Non-Goals

- no infrastructure mutation
- no validator-internal automation in the default path
- no wallet-internal automation in the default path
- no remote apply behavior from `preflight` itself

`preflight` may recommend a supported companion action, but it does not execute it. `promote diff --dry-run` and `promote diff --apply` reuse this gate; the `preflight` command remains read-only.

## Related

- [Configuration](configuration.md)
- [Auth](auth.md)
- [Status](status.md)
- [Compatibility](compatibility.md)
