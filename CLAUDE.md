# CLAUDE.md — cantonctl Project Guide

## Project Position

`cantonctl` is the Splice-aware orchestration companion for the official Canton stack.

It complements DPM, Daml Studio, Quickstart, the official Splice LocalNet workspace, and the official wallet and dApp SDKs. It wraps, not replaces, those tools.

The canonical repo guidance is:

- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)
- [docs/BEST_PRACTICES.md](docs/BEST_PRACTICES.md)
- [docs/adr/README.md](docs/adr/README.md)

## Quick Reference

```bash
npm install
npm run build
npm run test:unit
npm run test:e2e
npm run ci
npm run ci:all
```

Use [`scripts/ci/manifest.js`](scripts/ci/manifest.js) as the source of truth for suite membership, Node policy, and CI scope.

## Architecture Rules

1. Test-first when practical
2. DI everywhere, zero `vi.mock()`
3. `AbortSignal` for long-running operations
4. `CantonctlError` for expected failures
5. Thin commands, logic in `src/lib/`
6. Keep stable/public and experimental boundaries explicit

## Current Runtime Model

- `cantonctl dev`: sandbox-first local iteration
- `cantonctl dev --net`: local Canton-only multi-node Docker runtime
- `cantonctl localnet ...`: wrapper over the official Splice LocalNet workspace
- `cantonctl serve`: profile-aware backend for local workbenches and editor integrations
- `cantonctl playground`: browser workbench on top of `serve`

Named local Canton topologies are defined under `topologies:` in `cantonctl.yaml`.

## Key Modules

| Module | Purpose |
|--------|---------|
| `src/lib/config.ts` | YAML config loading, merge, validation, topologies |
| `src/lib/config-profile.ts` | Profile normalization and compatibility-ready service model |
| `src/lib/topology.ts` | Local Canton topology resolution, rendering, and manifest detection |
| `src/lib/dev-server.ts` | Sandbox lifecycle and hot reload |
| `src/lib/dev-server-full.ts` | `dev --net` Docker runtime orchestration |
| `src/lib/docker.ts` | Docker Compose lifecycle |
| `src/lib/serve.ts` | REST + WebSocket workbench backend |
| `src/lib/splice-public.ts` | Stable/public Splice surface orchestration |
| `src/lib/preflight/checks.ts` | Profile-first remote readiness checks |
| `src/lib/control-plane-operation.ts` | Reusable plan/apply/dry-run execution engine for control-plane workflows |
| `src/lib/lifecycle/*.ts` | Advisory promotion, reset, and upgrade helpers |
| `src/lib/diagnostics/*.ts` | Status and diagnostics bundle collection |
| `src/lib/discovery/*.ts` | Stable/public Scan discovery and profile synthesis |
| `src/lib/canary/*.ts` | Stable/public CI and canary execution |
| `src/lib/export/*.ts` | Official SDK config export |

## CI And Verification

- `npm run ci` is the authoritative Docker parity path
- `npm run ci:native` is a convenience path only
- use `n` when you need to match the supported Node versions locally
- use `scripts/ci/run.js` and `scripts/ci/manifest.js` as the canonical CI implementation, not stale prose snapshots

## Docs Policy

- Keep `docs/reference/*.md` aligned with command help
- Use ADRs for accepted architecture decisions
- Use release and migration notes for change history
- Do not add roadmap, phase, funding, or worklog docs

When in doubt, delete stale guidance and replace it with a smaller canonical source instead of layering caveats on top of obsolete docs.
