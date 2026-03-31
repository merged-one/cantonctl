# CLAUDE.md — cantonctl Project Guide

## What is this project?

cantonctl is an institutional-grade CLI toolchain for Canton Network — the enterprise blockchain powering $6T+ in tokenized assets. It provides a Hardhat/Foundry-equivalent developer experience for Daml smart contract development.

## Quick reference

```bash
npm install                         # Install dependencies
npm test                            # Run 277 unit tests
npm run test:e2e                    # Run 66 E2E tests (requires Daml SDK + Java 21)
npm run test:all                    # Run all 343 tests
npm run test:coverage               # Coverage report (99.9% statements)
npm run build                       # Compile TypeScript to dist/
./scripts/install-prerequisites.sh  # Install Daml SDK + Java 21
```

## Architecture rules (non-negotiable)

1. **Test-first TDD**: Write tests that define the contract, then implement to pass. Never ship untested code.
2. **Dependency injection**: Every I/O module accepts injected dependencies (ProcessRunner, fetch, fs, chokidar). Zero `vi.mock()` anywhere. Use factory functions for mocks.
3. **AbortSignal everywhere**: All long-running operations accept AbortSignal for graceful shutdown.
4. **CantonctlError for all errors**: Every error is a `CantonctlError` with code (E1xxx-E8xxx), suggestion, and docs URL. Never throw bare `Error` or use `this.error()` in commands.
5. **Dual output**: Every command supports `--json` flag via `OutputWriter`. Use `createOutput({json: flags.json})`.
6. **Thin command wrappers**: Commands in `src/commands/` are thin oclif wrappers. All logic lives in `src/lib/` modules.

## Module layout

- `src/lib/` — Foundation libraries (fully tested, DI-based)
- `src/commands/` — oclif Command subclasses (thin wrappers over lib/)
- `src/hooks/` — oclif lifecycle hooks (init, prerun)
- `docs/` — Design decisions and research documents
- `assets/` — Logo SVGs

## Key modules and what they do

| Module | Factory | Purpose |
|--------|---------|---------|
| `config.ts` | `loadConfig()`, `resolveConfig()` | YAML config with hierarchical merge (project > user > env > flags) |
| `errors.ts` | `new CantonctlError(ErrorCode.XXX, opts)` | 21 error codes organized E1xxx-E8xxx |
| `output.ts` | `createOutput({json, quiet, noColor})` | Human/JSON/quiet output modes |
| `process-runner.ts` | `createProcessRunner()` | execa wrapper. Mock with `vi.fn()` stubs. |
| `daml.ts` | `createDamlSdk({runner})` | SDK abstraction: detect, build, test, codegen, startSandbox |
| `ledger-client.ts` | `createLedgerClient({baseUrl, token, fetch?})` | Canton JSON Ledger API V2 (6 endpoints) |
| `jwt.ts` | `createSandboxToken(opts)` | HS256 JWT for sandbox auth (well-known secret) |
| `scaffold.ts` | `scaffoldProject(opts)` | Project scaffolding with 5 templates |
| `dev-server.ts` | `createDevServer(deps)` | Dev server: sandbox + health + parties + hot-reload |
| `builder.ts` | `createBuilder(deps)` | Build orchestration: DAR caching, codegen, AbortSignal |
| `test-runner.ts` | `createTestRunner(deps)` | Test execution: structured output, ANSI stripping |
| `deployer.ts` | `createDeployer(deps)` | 6-step deploy pipeline: validate → build → auth → preflight → upload → verify |
| `credential-store.ts` | `createCredentialStore(deps)` | Keychain-backed JWT storage. Env var override: `CANTONCTL_JWT_<NETWORK>` |
| `plugin-hooks.ts` | `createPluginHookManager()` | Lifecycle hook registry: beforeBuild, afterBuild, beforeDeploy, afterDeploy, beforeTest, afterTest, onError |
| `repl/parser.ts` | `parseCommand(input)` | REPL command grammar shared with future `exec` command |
| `repl/executor.ts` | `createExecutor(deps)` | Dispatches parsed REPL commands to LedgerClient |
| `repl/completer.ts` | `createCompleter(deps)` | Tab completion for REPL (commands, parties, flags) |

## Test patterns

**Config tests** — Mock filesystem:
```ts
const fs = createMockFs({'/project/cantonctl.yaml': yamlString})
const config = await loadConfig({dir: '/project', fs})
```

**DamlSdk/ProcessRunner tests** — Mock runner:
```ts
const runner = {run: vi.fn(), spawn: vi.fn(), which: vi.fn()}
runner.which.mockImplementation(async (cmd) => cmd === 'dpm' ? '/bin/dpm' : null)
```

**LedgerClient tests** — Mock fetch:
```ts
const fetch = vi.fn()
fetch.mockResolvedValue(new Response(JSON.stringify(body), {status: 200}))
const client = createLedgerClient({baseUrl, token, fetch})
```

**Output tests** — Spy on process.stdout/stderr:
```ts
vi.spyOn(process.stdout, 'write').mockReturnValue(true)
```

## Error code ranges

- E1xxx: Configuration (E1001 not found, E1002 invalid YAML, E1003 schema violation, E1004 directory exists)
- E2xxx: SDK/Tools (E2001 not installed, E2002 version mismatch, E2003 command failed)
- E3xxx: Sandbox (E3001 start failed, E3002 port in use, E3003 health timeout)
- E4xxx: Build (E4001 Daml error, E4002 DAR not found)
- E5xxx: Test (E5001 execution failed)
- E6xxx: Deploy (E6001 auth failed, E6002 unreachable, E6003 upload failed, E6004 exists)
- E7xxx: Ledger API (E7001 connection failed, E7002 command rejected, E7003 auth expired)
- E8xxx: Console (E8001 parse error, E8002 unknown command)

## Canton-specific context

- **SDK tools**: `dpm` (preferred, Canton 3.4+) or `daml` (legacy). cantonctl auto-detects.
- **Sandbox**: `dpm sandbox --port 5001 --json-api-port 7575` — single participant, in-memory
- **JSON Ledger API V2**: Port 7575 by default. Endpoints: `GET /v2/version`, `POST /v2/dars`, `POST /v2/commands/submit-and-wait`, `POST /v2/state/active-contracts`, `POST /v2/parties`, `GET /v2/parties`
- **JWT auth**: Canton sandbox decodes but doesn't validate JWTs. We use a well-known HS256 secret for local dev.
- **DAR upload**: `POST /v2/dars` with raw bytes + Bearer token. Hot-reload works by uploading new DARs without restart.

## Implementation status

| Phase | Status |
|-------|--------|
| Phase 0: Project setup | Complete |
| Phase 1: Foundation libraries | Complete (config, errors, output, process-runner, daml, ledger-client, jwt) |
| Phase 2: SDK & Ledger | Complete (scaffold, dev-server) |
| Phase 3: Simple commands (build, test, status) | Complete (builder, test-runner, status with real DamlSdk/LedgerClient) |
| Phase 4: Deploy, console, auth/hooks groundwork | Complete (deployer, credential-store, auth commands, repl/parser, repl/executor, repl/completer, plugin-hooks) |
| Phase 5: Polish (E2E for Phase 4 commands, --json conformance, help snapshots, OS keychain wiring) | Not started |

`dev --full` remains deferred until after the v1 core flow.

## Config schema (cantonctl.yaml)

```yaml
version: 1
project:
  name: my-app
  sdk-version: "3.4.9"
  template: basic
parties:
  - name: Alice
    role: operator
  - name: Bob
    role: participant
networks:
  local:
    type: sandbox           # sandbox | remote | docker
    port: 5001
    json-api-port: 7575
plugins: []
```

## Dependencies

- **oclif** — CLI framework with plugin system
- **zod** — Config schema validation
- **jose** — JWT signing
- **execa** — Subprocess execution
- **chokidar** — File watching (hot-reload)
- **vitest** — Test framework
