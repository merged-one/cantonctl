# AGENTS.md — Multi-Agent Coordination Guide

This file defines conventions for AI agents working on cantonctl, whether as a single agent or multiple coordinated agents working in parallel.

## Project Overview

cantonctl is an institutional CLI toolchain for Canton Network (enterprise blockchain, $6T+ tokenized assets). It provides Hardhat/Foundry-equivalent DX for Daml smart contracts.

**Current state:** Phases 0-7 complete. Test inventory, CI suite membership, and toolchain versions are defined in `scripts/ci/manifest.js` and should not be duplicated here as hard-coded counts.

```bash
npm test          # Unit project
npm run test:e2e  # PR-required E2E suites (SDK + stable/public + sandbox + playground + docker)
npm run build     # TypeScript compilation
npm run ci        # Authoritative Docker-based PR parity run
npm run ci:all    # All CI suites, including experimental
```

## Architecture (Non-Negotiable)

1. **Zero `vi.mock()`** — All deps injected via factory functions. Mock with `vi.fn()` stubs.
2. **CantonctlError only** — Never throw bare `Error`. Use `new CantonctlError(ErrorCode.XXX, {suggestion})`.
3. **`--json` on every command** — `createOutput({json: flags.json})`.
4. **Thin commands** — `src/commands/` parse flags and delegate. Logic in `src/lib/`.
5. **Tests first** — Write the failing test, then implement.
6. **AbortSignal** — All long-running ops accept `AbortSignal`.

## Module Map

```
src/lib/              ← Pure logic (DI, tested, no side effects)
  config.ts           ← YAML config with Zod validation
  errors.ts           ← 21 error codes (E1xxx-E8xxx)
  output.ts           ← Human/JSON/quiet output modes
  process-runner.ts   ← execa subprocess abstraction
  daml.ts             ← SDK wrapper (dpm/daml auto-detect)
  ledger-client.ts    ← Canton JSON Ledger API V2 (6 endpoints)
  jwt.ts              ← HS256 sandbox JWT
  scaffold.ts         ← Project scaffolding (5 templates)
  dev-server.ts       ← Sandbox lifecycle + hot-reload
  dev-server-full.ts  ← Multi-node Docker dev server
  topology.ts         ← Topology config generation (Docker Compose + HOCON)
  docker.ts           ← Docker Compose lifecycle management
  builder.ts          ← Build orchestration + DAR caching + --watch mode (chokidar)
  test-runner.ts      ← Test execution + ANSI stripping
  deployer.ts         ← 6-step deploy pipeline
  credential-store.ts ← Keychain-backed JWT storage
  plugin-hooks.ts     ← Lifecycle hook registry (7 hooks)
  cleaner.ts          ← Build artifact cleanup
  keytar-backend.ts   ← OS keychain with in-memory fallback
  repl/parser.ts      ← REPL command grammar
  repl/executor.ts    ← Command dispatch to LedgerClient
  repl/completer.ts   ← Tab completion

src/commands/         ← Thin oclif wrappers
  init.ts, dev.ts, build.ts, test.ts, deploy.ts,
  console.ts, status.ts, clean.ts
  auth/login.ts, auth/logout.ts, auth/status.ts

test/e2e/             ← E2E tests against real Daml SDK
docs/                 ← Reference, tasks, concepts, ADRs, troubleshooting
```

## Parallel-Safe Zones

These areas can be worked on simultaneously without conflicts:

| Zone | Why safe |
|------|----------|
| Any single `src/lib/<module>.ts` + `.test.ts` | Isolated by DI |
| Any single `docs/reference/<cmd>.md` | Independent files |
| Any single `docs/tasks/*.md` or `docs/concepts/*.md` | Independent files |
| Any single `test/e2e/<cmd>.e2e.test.ts` | Isolated (but use unique ports) |

## Conflict Zones (Serialize)

| Zone | Why | Protocol |
|------|-----|----------|
| `src/lib/errors.ts` | Shared ErrorCode enum | Claim your range first |
| `package.json` | Dependencies, scripts | One agent at a time |
| `CLAUDE.md`, `README.md` | Aggregate metrics | Update last, after code |
| `docs/V1_PLAN.md` | Roadmap state | One agent updates |

## E2E Port Allocation

E2E tests start real Canton sandboxes. Each test file MUST use unique ports:

| Test file | Canton port | JSON API port |
|-----------|------------|---------------|
| `dev.e2e.test.ts` | 5001 | 7575 |
| `deploy.e2e.test.ts` | 5031 | 7601 |
| `status.e2e.test.ts` | 5041 | 7611 |

Next available: Canton 5051, JSON API 7621.

## DI Factory Pattern

Every module follows:

```typescript
export interface FooDeps {
  bar: Bar
  hooks?: PluginHookManager  // optional
}
export interface Foo { doThing(opts: Opts): Promise<Result> }
export function createFoo(deps: FooDeps): Foo { ... }
```

Tests mock deps directly:

```typescript
const foo = createFoo({
  bar: { method: vi.fn().mockResolvedValue('val') },
})
```

## Error Code Ranges

| Range | Subsystem | Owner |
|-------|-----------|-------|
| E1xxx | Configuration | config.ts |
| E2xxx | SDK/Tools | daml.ts, process-runner.ts |
| E3xxx | Sandbox/Node/Docker | dev-server.ts, dev-server-full.ts, docker.ts |
| E4xxx | Build | builder.ts |
| E5xxx | Test | test-runner.ts |
| E6xxx | Deploy | deployer.ts |
| E7xxx | Ledger API | ledger-client.ts |
| E8xxx | Console/REPL | repl/*.ts |

## Adding a New Module

1. `src/lib/<module>.ts` — factory function with DI
2. `src/lib/<module>.test.ts` — `createDefaultDeps()` + mock factories
3. `src/commands/<name>.ts` — thin wrapper (if command)
4. `docs/reference/<name>.md` — following existing pattern
5. Update `CLAUDE.md` key modules table
6. `npm test && npm run build`

## Adding a New Command

1. Create lib module first (above)
2. `src/commands/<name>.ts` — parse flags → create deps → call lib → `out.result()`
3. `--json` flag + `CantonctlError` catch pattern (see `build.ts` for template)
4. `docs/reference/<name>.md`
5. `test/e2e/<name>.e2e.test.ts` (if needs SDK)
6. Update `README.md` commands table

## Documentation Hierarchy

Authoritative docs flow top-down. Update in this order:

```
CLAUDE.md              ← Source of truth (module list, phase status, CI/test workflow)
  → README.md          ← Mirrors CLAUDE.md metrics for humans
  → docs/V1_PLAN.md    ← Roadmap and acceptance criteria
  → AGENTS.md          ← This file (multi-agent conventions)
```

ADRs (`docs/adr/`) are immutable once accepted. Reference docs (`docs/reference/`) must match the actual command flags and behavior.

## Canton-Specific Context

- **SDK**: `dpm` (Canton 3.4+) or `daml` (legacy), auto-detected
- **Sandbox**: in-memory, single participant, no Docker needed
- **JSON Ledger API V2**: `http://localhost:7575` — version, DAR upload, commands, contracts, parties
- **JWT**: sandbox decodes but doesn't validate signatures
- **DAR**: compiled Daml archive, uploaded via `POST /v2/dars` with raw bytes

## Verification Checklist

Before every commit:

- [ ] `npm test` — unit project passes
- [ ] `npm run ci` — Docker parity suite passes when the change affects CI-covered behavior
- [ ] `npm run build` — TypeScript compiles clean
- [ ] No machine-specific paths (use `os.homedir()`, `path.delimiter`)
- [ ] Doc references point to `scripts/ci/manifest.js` instead of stale hard-coded test counts
- [ ] New modules added to CLAUDE.md key modules table
