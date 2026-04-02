# CLAUDE.md — cantonctl Project Guide

## What is this project?

cantonctl is an institutional-grade CLI toolchain for Canton Network — the enterprise blockchain powering $6T+ in tokenized assets. It provides a Hardhat/Foundry-equivalent developer experience for Daml smart contract development.

## Quick reference

```bash
npm install                         # Install dependencies
npm test                            # Run 399 unit tests (project: unit)
npm run test:e2e:sdk                # Run 66 SDK E2E tests (project: e2e-sdk)
npm run test:e2e:sandbox            # Run 9 sandbox E2E tests (project: e2e-sandbox)
npm run test:e2e:docker             # Run 2 Docker E2E tests (project: e2e-docker)
npm run test:e2e:playground         # Run 14 playground E2E tests (project: e2e-playground)
npm run test:e2e                    # Run SDK + sandbox E2E tests (75 tests)
npm run test:all                    # Run all 490 tests
npm run test:coverage               # Coverage report
npm run build                       # Compile TypeScript to dist/
npm run ci                          # Local CI check (native)
./scripts/ci-local.sh --docker      # Local CI check (Docker — exact GitHub Actions parity)
./scripts/install-prerequisites.sh  # Install Daml SDK + Java 21
```

## Architecture rules (non-negotiable)

1. **Test-first TDD**: Write tests that define the contract, then implement to pass. Never ship untested code.
2. **Dependency injection**: Every I/O module accepts injected dependencies (ProcessRunner, fetch, fs, chokidar). Zero `vi.mock()` anywhere. Use factory functions for mocks.
3. **AbortSignal everywhere**: All long-running operations accept AbortSignal for graceful shutdown.
4. **CantonctlError for all errors**: Every error is a `CantonctlError` with code (E1xxx-E8xxx), suggestion, and docs URL. Never throw bare `Error` or use `this.error()` in commands.
5. **Dual output**: Every command supports `--json` flag via `OutputWriter`. Use `createOutput({json: flags.json})`.
6. **Thin command wrappers**: Commands in `src/commands/` are thin oclif wrappers. All logic lives in `src/lib/` modules.
7. **CI parity**: Code must pass in Docker (`./scripts/ci-local.sh --docker`) before pushing. See CI rules below.

## CI parity rules (non-negotiable)

Local and GitHub Actions must run identical steps. Passing locally must guarantee passing on CI.

### Verify before pushing

Run `./scripts/ci-local.sh --docker` (or `npm run ci` for native). The `--docker` flag runs inside an ubuntu container with the exact same Node, Java, and Daml SDK versions as GitHub Actions. This is the gold standard.

### Cross-platform code — no hardcoded paths

- **Never hardcode OS-specific paths** in source or test files. No `/opt/homebrew/...`, no `/usr/local/...`.
- Java resolution: Use `JAVA_HOME/bin` (set by `actions/setup-java` on CI, sdkman/asdf/Homebrew locally). The `process-runner.ts` and `test/e2e/helpers.ts` handle this — use them.
- Daml resolution: Use `~/.daml/bin` or expect it on `PATH`.
- New E2E tests must import `{hasDaml, SDK_VERSION, ENV_PATH}` from `test/e2e/helpers.ts` — never define their own path constants.

### Test project structure

Tests are organized into five vitest projects in `vitest.config.ts`:

| Project | Files | Isolation | Purpose |
|---------|-------|-----------|---------|
| `unit` | `src/**/*.test.ts` | Default (threads) | Fast, no external deps |
| `e2e-sdk` | `test/e2e/{init,build,test-cmd}.e2e.test.ts` (includes build --watch E2E) | Default (threads) | Requires Daml SDK + Java |
| `e2e-sandbox` | `test/e2e/{dev,deploy,status}.e2e.test.ts` | `pool: 'forks'`, `singleFork: true` | Requires Canton sandbox (JVM) |
| `e2e-docker` | `test/e2e/dev-full.e2e.test.ts` | `pool: 'forks'`, `singleFork: true` | Requires Docker + Canton image |
| `e2e-playground` | `test/e2e/playground.e2e.test.ts` | `pool: 'forks'`, `singleFork: true` | Playground serve API + sandbox |

**Why forks for sandbox/docker/playground tests**: Vitest's default thread pool kills JVM child processes when a test file completes. The `forks` pool isolates each file in its own Node.js process, preventing cross-file interference between Canton sandbox JVM process trees.

**Adding new E2E tests**: Add the file path to the appropriate project's `include` array in `vitest.config.ts`. If the test starts a Canton sandbox, it goes in `e2e-sandbox`. If it only needs the Daml SDK CLI, it goes in `e2e-sdk`. If it starts a playground serve server, it goes in `e2e-playground`.

### SpawnedProcess lifecycle

Long-running processes (Canton sandbox) must be properly cleaned up:
- `stop()` must call `kill()` then `await waitForExit()` — never fire-and-forget.
- Mock `SpawnedProcess` objects must include `waitForExit: vi.fn().mockResolvedValue(0)`.

### CI workflow structure

The GitHub Actions workflow (`.github/workflows/ci.yml`) has four jobs:
- **`unit-tests`** — Matrix: Node 18/20/22. Runs on every push and PR. Required.
- **`e2e-sdk-tests`** — Node 22 + Java 21 + Daml SDK. Runs on every push and PR. Required.
- **`e2e-sandbox-tests`** — Same as SDK + Canton sandbox. Runs on main pushes only. Informational (not in gate).
- **`all-green`** — Gate job. Depends on `unit-tests` + `e2e-sdk-tests`. The only required status check in branch protection.

### Docker CI environment

`Dockerfile.ci` replicates the GitHub Actions runner:
- Ubuntu 24.04 (matches `ubuntu-latest`)
- Node 22 (override with `NODE_VERSION=18 docker compose -f docker-compose.ci.yml build ci`)
- Java 21 Temurin (matches `actions/setup-java distribution: temurin`)
- Daml SDK 3.4.11 (matches CI install step)
- `JAVA_OPTS: -Xms512M -Xmx2G -XX:+UseSerialGC` for sandbox tests (matches CI env)

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
| `errors.ts` | `new CantonctlError(ErrorCode.XXX, opts)` | 24 error codes organized E1xxx-E8xxx |
| `output.ts` | `createOutput({json, quiet, noColor})` | Human/JSON/quiet output modes |
| `process-runner.ts` | `createProcessRunner()` | execa wrapper. Mock with `vi.fn()` stubs. |
| `daml.ts` | `createDamlSdk({runner})` | SDK abstraction: detect, build, test, codegen, startSandbox |
| `ledger-client.ts` | `createLedgerClient({baseUrl, token, fetch?})` | Canton JSON Ledger API V2 (6 endpoints) |
| `jwt.ts` | `createSandboxToken(opts)` | HS256 JWT for sandbox auth (well-known secret) |
| `scaffold.ts` | `scaffoldProject(opts)` | Project scaffolding with 5 templates, interactive mode (inquirer prompts when no args) |
| `dev-server.ts` | `createDevServer(deps)` | Dev server: sandbox + health + parties + hot-reload |
| `builder.ts` | `createBuilder(deps)` | Build orchestration: DAR caching, codegen, --watch mode (chokidar), AbortSignal |
| `test-runner.ts` | `createTestRunner(deps)` | Test execution: structured output, ANSI stripping |
| `deployer.ts` | `createDeployer(deps)` | 6-step deploy pipeline: validate → build → auth → preflight → upload → verify |
| `credential-store.ts` | `createCredentialStore(deps)` | Keychain-backed JWT storage. Env var override: `CANTONCTL_JWT_<NETWORK>` |
| `plugin-hooks.ts` | `createPluginHookManager()` | Lifecycle hook registry: beforeBuild, afterBuild, beforeDeploy, afterDeploy, beforeTest, afterTest, onError |
| `repl/parser.ts` | `parseCommand(input)` | REPL command grammar shared with future `exec` command |
| `repl/executor.ts` | `createExecutor(deps)` | Dispatches parsed REPL commands to LedgerClient |
| `repl/completer.ts` | `createCompleter(deps)` | Tab completion for REPL (commands, parties, flags) |
| `topology.ts` | `generateTopology(opts)` | Pure function: generates Docker Compose + Canton HOCON + bootstrap script from config |
| `docker.ts` | `createDockerManager(deps)` | Docker Compose lifecycle: checkAvailable, composeUp, composeDown, composeLogs |
| `dev-server-full.ts` | `createFullDevServer(deps)` | Multi-node dev server: Docker topology, multi-participant health, cross-node hot-reload |
| `cleaner.ts` | `createCleaner(deps)` | Build artifact cleanup (.daml/, dist/, node_modules/) |
| `keytar-backend.ts` | `createBackendWithFallback()` | OS keychain backend via keytar with in-memory fallback |
| `serve.ts` | `createServeServer(deps)` | Canton IDE Protocol server: REST + WebSocket API for any IDE client |
| `doctor.ts` | `createDoctor(deps)` | Environment diagnostics: Node, Java, SDK, Docker, ports |
| `daml-parser.ts` | `parseDamlSource(source)` | Regex-based Daml source parser: templates, fields, choices, signatories |

## Playground (`playground/`)

Browser IDE served by `cantonctl playground`. React + Monaco + Tailwind frontend.

- `playground/src/panels/` — UI panels (FileExplorer, Editor, InteractPanel, Terminal, SplitView)
- `playground/src/hooks/` — React hooks (useFiles, useContracts, useTemplates, useBuild)
- `playground/src/lib/` — API client, WebSocket client, Daml syntax highlighting
- `playground/src/panels/DynamicCreateForm.tsx` — Auto-generates create forms from parsed Daml templates
- `playground/src/panels/DynamicChoiceForm.tsx` — Auto-generates choice exercise forms
- `playground/src/panels/SplitView.tsx` — Multi-party side-by-side contract view

### Canton V2 API Format (critical knowledge)

The Canton JSON Ledger API V2 has specific format requirements discovered through testing:

**Submit command** — requires `userId: 'admin'` in request body:
```json
{"commands": [...], "actAs": ["party"], "commandId": "...", "userId": "admin"}
```

**Template IDs** — use `#packageName:Module:Template` format (with `#` prefix):
```json
{"templateId": "#my-app:Main:Token"}
```

**Active contracts query** — requires nested `identifierFilter` with `WildcardFilter`:
```json
{
  "activeAtOffset": N,
  "filter": {"filtersByParty": {"PARTY": {"cumulative": [{
    "identifierFilter": {"WildcardFilter": {"value": {"includeCreatedEventBlob": false}}}
  }]}}},
  "verbose": true
}
```

**JWT** — must include `sub` claim: `.setSubject('admin')`

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

**SpawnedProcess mocks** — Must include `waitForExit`:
```ts
const mockProc: SpawnedProcess = {
  kill: vi.fn(),
  onExit: vi.fn(),
  waitForExit: vi.fn().mockResolvedValue(0),
  pid: 12345,
  stderr: null,
  stdout: null,
}
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
- E3xxx: Sandbox (E3001 start failed, E3002 port in use, E3003 health timeout, E3004 Docker not available, E3005 Docker Compose failed)
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
| Phase 5: Polish (E2E, hooks integration, keychain, clean, CI, docs) | Complete (hook integration into commands, keytar backend, clean command, deploy/status E2E, CI workflow, task/concept docs) |
| Phase 6: `dev --full` multi-node topology | Complete (topology generation, Docker lifecycle, multi-participant dev server — see ADR-0014) |
| Phase 7: build --watch, interactive init, multi-node status | Complete (chokidar file watching, inquirer prompts, .cantonctl/ directory detection) |

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
