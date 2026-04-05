# AGENTS.md — Multi-Agent Coordination Guide

This file defines conventions for agents working in this repository.

## Project Overview

`cantonctl` is the Splice-aware orchestration companion for the official Canton stack.

Use these docs as the canonical repo guidance:

- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)
- [docs/BEST_PRACTICES.md](docs/BEST_PRACTICES.md)
- [docs/adr/README.md](docs/adr/README.md)

Do not revive roadmap, phase, funding, or worklog docs. Active work belongs in GitHub issues and PR checklists.

## Current Dev Runtime Model

- `cantonctl dev` for sandbox-first local iteration
- `cantonctl dev --net` for the Canton-only local multi-node Docker runtime
- `cantonctl localnet ...` for the official Splice LocalNet wrapper
- `cantonctl ui` for the localhost profile-centric control center

Named local Canton topologies live in the top-level `topologies:` section of `cantonctl.yaml`.

## Architecture (Non-Negotiable)

1. Zero `vi.mock()` — inject dependencies with factories and stub with `vi.fn()`
2. `CantonctlError` only — never throw bare `Error` for expected failures
3. `--json` on every command except surfaces intentionally kept human-only
4. Thin commands — `src/commands/` parses flags, `src/lib/` owns logic
5. Tests first — add the failing test before or alongside implementation
6. `AbortSignal` for long-running operations

## Module Map

```
src/lib/
  config.ts           ← YAML config, merge, validation, topologies
  config-profile.ts   ← Profile normalization and canonical profile kinds
  topology.ts         ← Local Canton topology resolution, rendering, manifest detection
  dev-server.ts       ← Sandbox lifecycle + hot-reload
  dev-server-full.ts  ← `dev --net` local multi-node Docker runtime
  docker.ts           ← Docker Compose lifecycle management
  ui/*.ts             ← Private read-only UI controller and hardened localhost bridge
  builder.ts          ← Build orchestration + DAR caching + watch
  test-runner.ts      ← Test execution
  deployer.ts         ← Advisory DAR deploy wrapper
  doctor.ts           ← Environment diagnostics

src/commands/
  dev.ts, ui.ts, status.ts, deploy.ts
  topology/show.ts, topology/export.ts
  auth/*, localnet/*, profiles/*, compat/*

docs/
  CURRENT_STATE.md    ← Canonical product snapshot
  BEST_PRACTICES.md   ← Canonical docs-maintenance policy
  reference/          ← User-facing command and workflow docs
  adr/                ← Accepted architecture decisions
  release-notes/      ← User-visible change history
  migration/          ← Upgrade and rename guidance
```

## Parallel-Safe Zones

These areas are usually safe to edit in parallel:

| Zone | Why safe |
|------|----------|
| One `src/lib/<module>.ts` plus its tests | DI keeps write scope tight |
| One `src/commands/<command>.ts` plus its tests | Thin wrappers are isolated |
| One `docs/reference/<topic>.md` | Independent docs files |
| One `docs/concepts/*.md` or `docs/tasks/*.md` | Independent docs files |
| One `test/e2e/<file>.test.ts` | Isolated suite, if ports are unique |

## Conflict Zones

| Zone | Why | Protocol |
|------|-----|----------|
| `src/lib/errors.ts` | Shared error-code enum | Serialize edits |
| `package.json` | Shared scripts and dependencies | Serialize edits |
| `README.md`, `CLAUDE.md`, `AGENTS.md` | Aggregate guidance | Update after implementation/reference docs |
| `docs/CURRENT_STATE.md`, `docs/BEST_PRACTICES.md` | Canonical docs policy/state | One agent at a time |

## E2E Port Allocation

E2E tests that start real runtimes must keep unique ports. Prefer extending the existing conventions in `test/e2e/helpers.ts` instead of hard-coding new tables elsewhere.

## Adding A New Module

1. Create `src/lib/<module>.ts` with DI
2. Add `src/lib/<module>.test.ts`
3. Add `src/commands/<name>.ts` only if a CLI surface is required
4. Add or update `docs/reference/<name>.md`
5. Update [CLAUDE.md](CLAUDE.md) when the module becomes part of the long-lived architecture surface
6. Run build and the relevant test suites

## Adding A New Command

1. Implement the library module first
2. Keep the command wrapper thin
3. Support `--json` unless the surface is intentionally human-only
4. Document the command under `docs/reference/`
5. Add unit coverage and E2E coverage when the runtime surface is CI-covered

## Documentation Policy

Update docs in this order:

1. command help and `docs/reference/*`
2. `docs/CURRENT_STATE.md` if supported behavior changed
3. ADRs if the architecture or product boundary changed
4. release/migration notes if users must change terminology or behavior
5. `README.md`, `CLAUDE.md`, and this file last

Do not add new roadmap, phase, status, funding, or worklog docs.

## Verification Checklist

Before finishing substantial work:

- `npm run build`
- `npm run test:unit`
- `npm run test:coverage:strict` when coverage-sensitive code changed
- `npm run ci` for Docker parity when CI-covered behavior changed
- verify docs point to `scripts/ci/manifest.js` rather than stale hard-coded suite counts
