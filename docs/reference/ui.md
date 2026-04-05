# `cantonctl ui`

Start the local profile-centric control center.

This is the hardened, read-only localhost UI for:

- profile inspection and selection
- auth status
- readiness, preflight, canary, and doctor drill-down
- LocalNet runtime visibility
- diagnostics posture, discovery inputs, and SDK export targets

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
- requires a per-launch session token on every UI API request
- keeps all auth, import, LocalNet lifecycle, diagnostics bundle, discovery, and SDK export actions in the CLI

## Views

- `Overview`: readiness, service summary, environment path, advisories, and scope
- `Profiles`: profile list, resolved services, imports, validation, auth state
- `Runtime`: sandbox summary, `canton-multi` topology, LocalNet service map, remote service map
- `Checks`: auth, compatibility, preflight, canary, and doctor
- `Support`: diagnostics paths, discovery inputs, and SDK export targets with CLI handoff

## Notes

- `cantonctl ui` is intentionally human-only and does not support `--json`
- the right rail shows view-aware CLI follow-up commands instead of running mutating operations in-browser
- `profiles import-localnet --write` persists the upstream workspace path and source profile inside the `splice-localnet` profile so the UI can render LocalNet status accurately

## Source

- Command: [`src/commands/ui.ts`](../../src/commands/ui.ts)
- Controller: [`src/lib/ui/controller.ts`](../../src/lib/ui/controller.ts)
- Server: [`src/lib/ui/server.ts`](../../src/lib/ui/server.ts)
