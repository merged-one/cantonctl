# `cantonctl readiness`

Run the composed readiness gate for a resolved profile.

This is the JSON-first control-plane check that combines:

- app and operator auth resolution
- compatibility checks
- preflight reachability
- stable/public canaries for the services exposed by the selected profile

## Usage

```bash
cantonctl readiness [--profile <name>] [--json]
```

## Behavior

- resolves the selected profile using the same profile model as the rest of the CLI
- reuses `preflight` for profile, split auth, compatibility, and network checks
- passes through the same drift and reconcile contract exposed by `preflight`
- runs only the stable/public canary suites that match the configured services
- exits non-zero only when blocking failures are present

For remote profiles with mutating surfaces, readiness reports whether explicit operator credentials are present alongside the app credential path used for read checks. In JSON mode it also includes the preflight-derived `drift[]` and `reconcile` output so later control-plane workflows can reuse the same classification.

## Related

- [Configuration](configuration.md)
- [LocalNet](localnet.md)
- [Preflight](preflight.md)
- [Canary](canary.md)
