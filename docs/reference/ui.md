# `cantonctl ui`

Start the local profile-centric control center.

This is the read-mostly localhost UI for:

- profile inspection and selection
- auth status and login/logout
- readiness, preflight, canary, and doctor drill-down
- LocalNet runtime visibility and controls
- diagnostics bundles, network discovery, and SDK config export

It is not a restored playground. It does not expose code editing, arbitrary transactions, validator admin, or a generic external client protocol.

## Usage

```bash
cantonctl ui [--profile <name>] [--port <n>] [--open|--no-open]
```

## Behavior

- starts a localhost-only same-origin web app
- uses the canonical profile model from `cantonctl.yaml`
- defaults to the requested profile, then `default-profile`, then the first available profile
- keeps `Runtime` on 10-second polling only for local profiles
- routes mutating actions through explicit confirmation with a command preview

## Views

- `Overview`: readiness, service summary, environment path, advisories, recent outputs
- `Profiles`: profile list, resolved services, imports, validation, auth state
- `Runtime`: sandbox summary, `canton-multi` topology, LocalNet service map, remote service map
- `Checks`: auth, compatibility, preflight, canary, and doctor
- `Support`: diagnostics bundle, discovery, SDK config export, activity log

## Notes

- `cantonctl ui` is intentionally human-only and does not support `--json`
- `profiles import-localnet --write` now persists the upstream workspace path and source profile inside the `splice-localnet` profile so the UI can drive LocalNet actions without re-prompting

## Source

- Command: [`src/commands/ui.ts`](../../src/commands/ui.ts)
- Controller: [`src/lib/ui/controller.ts`](../../src/lib/ui/controller.ts)
- Server: [`src/lib/ui/server.ts`](../../src/lib/ui/server.ts)
