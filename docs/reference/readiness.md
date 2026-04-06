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
- runs only the stable/public canary suites that match the configured services
- exits non-zero only when blocking failures are present

For remote profiles with mutating surfaces, readiness reports whether explicit operator credentials are present alongside the app credential path used for read checks.

## Related

- [Configuration](configuration.md)
- [LocalNet](localnet.md)
- [Preflight](preflight.md)
- [Canary](canary.md)
