# cantonctl v1.0 Production Plan

> What it takes to ship a production-grade CLI on par with Hardhat for the Canton ecosystem.

## What "on par with Hardhat" means for Canton

Hardhat won because of four things: every command works reliably, plugins let the community extend without forking, error messages tell you exactly what's wrong and how to fix it, and the local network gives instant feedback. We don't need to match Hardhat feature-for-feature (they have 5 years and 28 packages). We need the Canton equivalent: `init → dev → build → test → deploy` works end-to-end with zero friction.

## Current State

### Done (Phases 0-2)

| Component | Status | Tests | Coverage |
|-----------|--------|-------|----------|
| `src/lib/config.ts` | Hierarchical config (project > user > env > flags) | 22 | 100% |
| `src/lib/errors.ts` | 22 error codes (E1001-E8002) with suggestions + docs URLs | 12 | 100% |
| `src/lib/output.ts` | Human / JSON / quiet modes, spinners, tables | 23 | 99% |
| `src/lib/process-runner.ts` | execa wrapper with DI | 8 | Mock-tested |
| `src/lib/daml.ts` | DamlSdk: detect, build, test, codegen, startSandbox | 16 | 100% |
| `src/lib/ledger-client.ts` | Canton JSON Ledger API V2 (6 endpoints) | 16 | 100% |
| `src/lib/jwt.ts` | HS256 sandbox JWT generation | 9 | 100% |
| `src/lib/scaffold.ts` | 5 templates + community template support | 26 | 100% |
| `src/lib/dev-server.ts` | Sandbox lifecycle + health + parties + hot-reload | 29 | 100% |
| `src/commands/init.ts` | Fully functional, E2E tested against real SDK | 54 E2E | Verified |
| `src/commands/dev.ts` | Fully functional, E2E tested against real sandbox | 3 E2E | Verified |
| Layer 1 docs | Reference, troubleshooting, concepts, tasks, llms.txt, JSON Schema | — | — |

**Total: 161 unit + 57 E2E = 218 tests. 99.9% statement coverage on lib/.**

### Remaining for v1

```
Phase 3:  build, test, status commands          — use existing DamlSdk + LedgerClient
Phase 4a: deploy command (7-step pipeline)      — use existing LedgerClient + JWT
Phase 4b: console command (REPL)                — use existing LedgerClient
Phase 4c: plugin hooks + credential store       — new infrastructure
Phase 5:  polish (interactive init, clean)      — refinement
Phase 5:  E2E tests for all new commands        — against real SDK
Phase 5:  docs for all new commands             — reference + tasks + troubleshooting
```

---

## Phase 3: Simple Commands

### 3.1 `build` command

Rewrite stub to use `DamlSdk.build()` with proper lifecycle.

**Acceptance criteria:**
- Compiles Daml via `DamlSdk.build({projectDir})`
- `--codegen` flag triggers `DamlSdk.codegen({language: 'ts', projectDir})`
- `--watch` mode: chokidar watches `daml/`, rebuilds on `.daml` change (debounced)
- `--json` output: `{success, data: {darPath, packageId, durationMs}, warnings}`
- Build caching: skip if `.dar` modification time is newer than all `.daml` source files
- Reports errors via `CantonctlError` (E4001 BUILD_DAML_ERROR, E4002 BUILD_DAR_NOT_FOUND)
- E2E test: scaffold basic template → build → assert .dar exists

**Files:**
- `src/lib/builder.ts` — Build logic with caching, codegen, watch mode
- `src/lib/builder.test.ts` — Unit tests
- `src/commands/build.ts` — Thin wrapper
- `test/e2e/build.e2e.test.ts` — E2E: all 5 templates build successfully
- `docs/reference/build.md` — Reference docs

### 3.2 `test` command

Rewrite stub to use `DamlSdk.test()` with structured output.

**Acceptance criteria:**
- Runs tests via `DamlSdk.test({projectDir, filter})`
- `--filter <pattern>` passes `--test-pattern` to SDK
- `--json` output: `{success, data: {passed, failed, total, durationMs, tests: [...]}}`
- Exit code 1 on any failure
- Reports errors via `CantonctlError` (E5001 TEST_EXECUTION_FAILED)
- E2E test: scaffold token template → test → assert all 4 tests pass

**Files:**
- `src/lib/test-runner.ts` — Test logic with output parsing
- `src/lib/test-runner.test.ts` — Unit tests
- `src/commands/test.ts` — Thin wrapper
- `test/e2e/test.e2e.test.ts` — E2E: token template tests pass
- `docs/reference/test.md` — Reference docs

### 3.3 `status` command

Query a running Canton node for health, packages, and parties.

**Acceptance criteria:**
- Queries `LedgerClient.getVersion()` for health
- Queries `LedgerClient.getParties()` for party list
- Generates JWT automatically from config parties
- `--json` output: `{success, data: {healthy, version, parties: [...], packages: [...]}}`
- `--network` flag selects which network config to use (default: `local`)
- Reports `E7001` if node is not reachable
- E2E test: start sandbox → status → assert healthy + parties listed

**Files:**
- `src/commands/status.ts` — Rewrite with LedgerClient
- `test/e2e/status.e2e.test.ts` — E2E against running sandbox
- `docs/reference/status.md` — Reference docs

---

## Phase 4a: Deploy Command

The 7-step deployment pipeline from Design Decision 8.

### `deploy` command

**Acceptance criteria:**
- `cantonctl deploy <network>` where network is `local`, `devnet`, `testnet`, `mainnet`
- Step 1 — **Validate**: Load config, verify network exists, check required fields
- Step 2 — **Build**: Run `DamlSdk.build()`, locate `.dar` in `.daml/dist/`
- Step 3 — **Auth**: Generate JWT for target network (sandbox secret for local, prompt for remote)
- Step 4 — **Preflight**: `LedgerClient.getVersion()` to verify connectivity + compatibility
- Step 5 — **Upload**: `LedgerClient.uploadDar(darBytes)` with progress indication
- Step 6 — **Vet**: Wait for package vetting (poll status)
- Step 7 — **Verify**: `LedgerClient.getVersion()` + confirm package appears in deployed list
- `--dar <path>` flag to skip build step and upload specific DAR
- `--dry-run` flag: execute steps 1-4 only, report what would happen
- `--json` output for each step: `{step, status, data}`
- Reports deployment-specific errors: E6001 (auth), E6002 (unreachable), E6003 (upload failed), E6004 (already exists)
- E2E test: scaffold → build → deploy local → verify package uploaded

**Files:**
- `src/lib/deployer.ts` — 7-step pipeline logic
- `src/lib/deployer.test.ts` — Unit tests (mocked LedgerClient)
- `src/commands/deploy.ts` — Thin wrapper
- `test/e2e/deploy.e2e.test.ts` — E2E: deploy to local sandbox
- `docs/reference/deploy.md` — Reference docs
- `docs/tasks/deploy-to-devnet.md` — Task doc with doctest

---

## Phase 4b: Console Command

Interactive REPL connected to a Canton node, inspired by Foundry's Chisel + Cast.

### `console` command

**Acceptance criteria:**
- Connects to a running Canton node (default: local sandbox on 7575)
- Generates JWT automatically
- Built-in commands:
  - `parties` — List all parties (table format)
  - `query <template> [--party <name>]` — Query active contracts
  - `submit <party> create <template> with <args>` — Submit create command
  - `submit <party> exercise <contractId> <choice> with <args>` — Exercise choice
  - `status` — Node health + version
  - `help` — List commands
  - `exit` / `quit` / Ctrl+D — Exit REPL
- Tab completion for template names, party names, command names
- Command history (persisted to `~/.cantonctl/console_history`)
- `--network` flag to connect to non-local nodes
- `--json` flag: output each result as JSON line (for piping)
- Errors display inline without crashing the REPL
- E2E test: start sandbox → console → execute `parties` → assert output

**Files:**
- `src/lib/repl/parser.ts` — Command parser
- `src/lib/repl/executor.ts` — Command executor (delegates to LedgerClient)
- `src/lib/repl/completer.ts` — Tab completion provider
- `src/lib/repl/repl.ts` — REPL loop (readline-based)
- `src/lib/repl/*.test.ts` — Unit tests for each module
- `src/commands/console.ts` — Thin wrapper
- `docs/reference/console.md` — Reference docs

---

## Phase 4c: Plugin Hooks + Credential Store

### Plugin hook system

**Acceptance criteria:**
- Lifecycle hooks: `beforeBuild`, `afterBuild`, `beforeDeploy`, `afterDeploy`, `beforeTest`, `afterTest`, `onError`
- Plugins register handlers via oclif hook system
- Hooks receive context: `{config, projectDir, command, args}`
- Hooks can modify behavior (e.g., `beforeBuild` can add compiler flags)
- Plugin discovery: auto-find `@cantonctl/plugin-*` and `cantonctl-plugin-*` in node_modules
- Documented plugin authoring guide

**Files:**
- `src/lib/plugin-hooks.ts` — Hook registry and dispatcher
- `src/lib/plugin-hooks.test.ts` — Unit tests
- `docs/concepts/plugins.md` — Plugin authoring guide

### Credential store

**Acceptance criteria:**
- Store JWT tokens and credentials per-network
- `cantonctl auth login <network>` — Generate and store JWT for a network
- `cantonctl auth logout <network>` — Remove stored credentials
- `cantonctl auth status` — Show which networks have stored credentials
- Config variable resolution: `auth: {credential}` in network config resolves at runtime
- Storage: encrypted local file at `~/.cantonctl/credentials.json` (AES-256-GCM via `@noble/ciphers`)
- Fallback: environment variable `CANTONCTL_JWT_<NETWORK>` overrides stored credential
- E2E test: auth login → deploy → verify credential was used

**Files:**
- `src/lib/credential-store.ts` — Encrypted credential storage
- `src/lib/credential-store.test.ts` — Unit tests
- `src/commands/auth.ts` — Auth management command
- `docs/reference/auth.md` — Reference docs
- `docs/concepts/authentication.md` — Concept doc: JWT for Canton, token lifecycle

---

## Phase 5: Polish

### 5.1 Interactive init

- `cantonctl init` with no args launches inquirer prompts
- Prompts: project name → template selection → SDK version → add parties?
- Same output as flag-based init

### 5.2 `clean` command

- Removes `.daml/`, `dist/`, generated TypeScript bindings
- `--all` flag also removes `node_modules/`
- Confirms before deleting (unless `--force`)

### 5.3 Build watch mode

- `cantonctl build --watch` continuously compiles on `.daml` changes
- Different from `dev` which also starts sandbox
- Useful for library development (no sandbox needed)

### 5.4 Comprehensive E2E test suite

- E2E tests for every command: build, test, deploy, status, console, clean, auth
- Fixture projects: one per template (basic, token, defi-amm, api-service, zenith-evm)
- CI configuration: GitHub Actions with Daml SDK + JDK 21 setup
- Two-tier CI (from conformance kit pattern): fast unit tests on every PR, E2E on schedule/release

### 5.5 Documentation completion

- Reference docs for every command (build, test, deploy, status, console, clean, auth)
- Task docs: "Deploy to DevNet", "Write and run tests", "Use the console"
- Troubleshooting: ensure every new error code has a page
- Plugin authoring guide
- CONTRIBUTING.md

---

## Acceptance Criteria for v1.0 Release

### Functional (every command works)

| Command | Criteria |
|---------|----------|
| `init` | All 5 templates scaffold, compile, and pass tests. `--from` works. Interactive mode works. |
| `dev` | Sandbox starts, health polling, party provisioning, hot-reload, graceful shutdown. |
| `build` | Compiles Daml, produces .dar, codegen for TypeScript, watch mode, caching. |
| `test` | Runs Daml Script tests, structured output, filter, exit code on failure. |
| `deploy` | 7-step pipeline works for local. Auth + connectivity for remote networks. Dry-run. |
| `status` | Shows health, version, parties, packages for any configured network. |
| `console` | REPL with parties, query, submit, status, help, tab completion, history. |
| `clean` | Removes build artifacts. |
| `auth` | Login, logout, status for network credentials. |

### Quality

| Criteria | Target |
|----------|--------|
| Unit test coverage (lib/) | ≥99% statements, ≥90% branches, 100% functions |
| E2E tests | Every command has ≥3 E2E tests against real SDK |
| Error handling | Zero stack traces shown to users. Every error is CantonctlError. |
| `--json` conformance | Every command produces valid JSON. Schema documented. |
| Documentation | Reference doc for every command. Troubleshooting for every error code. |
| CI | GitHub Actions: unit tests on PR, E2E on schedule. |

### Ecosystem

| Criteria | Target |
|----------|--------|
| Plugin hooks | ≥7 lifecycle hooks. One example plugin demonstrated. |
| Credential management | Secure local storage. Works with local + remote networks. |
| Distribution | `npm install -g cantonctl` works. `npx cantonctl` works. |
| llms.txt | Up to date with all commands and endpoints. |
| JSON Schema | Covers full config, available for IDE autocomplete. |

---

## Not in v1 (explicitly deferred)

| Feature | Why deferred |
|---------|-------------|
| `dev --full` (Docker multi-node) | Complex infra, most users need sandbox only |
| Contract verification (block explorer) | Canton doesn't have public explorers yet |
| Fork mode (`dev --fork`) | Canton sandbox doesn't support forking |
| Network helpers (`setBalance`, `mine`) | Canton's privacy model doesn't expose state manipulation |
| Gas reporting | Canton doesn't have application-level gas |
| Telemetry / analytics | Can add post-launch with opt-in |
| Homebrew / standalone binary distribution | npm is sufficient for v1 |
| Centralized plugin registry | Community too small; GitHub URLs sufficient |
| Multi-SDK version management | Pin in config; version switching is dpm's job |
| Layer 2-5 of agentic docs system | Layer 1 content taxonomy is sufficient for launch |

---

## Implementation Order

```
Week 1-2:  Phase 3 — build, test, status (leverages existing DamlSdk + LedgerClient)
Week 3-4:  Phase 4a — deploy pipeline (leverages existing LedgerClient + JWT)
Week 5-6:  Phase 4b — console REPL
Week 5-6:  Phase 4c — plugin hooks + credential store (parallel with console)
Week 7:    Phase 5 — polish, interactive init, clean, build --watch
Week 8:    Phase 5 — comprehensive E2E suite, CI setup, docs completion
```

Each phase follows the established pattern:
1. Write tests defining the contract
2. Implement to pass tests
3. E2E test against real SDK
4. Write reference + task docs
5. Update troubleshooting for new error codes
6. Update llms.txt and JSON Schema
