# cantonctl v1.0 Production Plan

> What it takes to ship a production-grade CLI on par with Hardhat for the Canton ecosystem.

## What "on par with Hardhat" means for Canton

Hardhat won because of four things: every command works reliably, plugins let the community extend without forking, error messages tell you exactly what's wrong and how to fix it, and the local network gives instant feedback. We don't need to match Hardhat feature-for-feature (they have 5 years and 28 packages). We need the Canton equivalent: `init → dev → build → test → deploy` works end-to-end with zero friction.

## Current State

### Done (Phases 0-3)

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
| `src/lib/builder.ts` | Build orchestration: DAR caching, codegen | 11 | 100% |
| `src/lib/test-runner.ts` | Test execution: structured output, ANSI stripping | 8 | 100% |
| `src/commands/init.ts` | Fully functional, E2E tested against real SDK | 54 E2E | Verified |
| `src/commands/dev.ts` | Fully functional, E2E tested against real sandbox | 3 E2E | Verified |
| `src/commands/build.ts` | Fully functional, E2E tested (5 templates) | 7 E2E | Verified |
| `src/commands/test.ts` | Fully functional, E2E tested | 2 E2E | Verified |
| `src/commands/status.ts` | Functional (queries real Ledger API) | — | — |
| Layer 1 docs | Reference (5 commands), troubleshooting, concepts, tasks, llms.txt, JSON Schema | — | — |
| ADR system | 14 ADRs (10 converted + 3 from Phase 3 + 1 from Phase 6) | — | — |

**Total (Phases 0-3): 180 unit + 67 E2E = 247 tests. 99.9% statement coverage on lib/.**

### Done (Phase 4)

| Component | Status | Tests | Coverage |
|-----------|--------|-------|----------|
| `src/lib/deployer.ts` | 6-step deploy pipeline (validate/build/auth/preflight/upload/verify) | 20 | 100% |
| `src/lib/credential-store.ts` | Keychain-backed JWT storage, env var override, in-memory backend | 13 | 100% |
| `src/lib/plugin-hooks.ts` | Lifecycle hook registry (7 hooks), ordered dispatch, onError swallowing | 11 | 100% |
| `src/lib/repl/parser.ts` | REPL command grammar shared with future `exec` | 29 | 100% |
| `src/lib/repl/executor.ts` | Dispatches parsed commands to LedgerClient | 14 | 100% |
| `src/lib/repl/completer.ts` | Tab completion for commands, parties, flags | 10 | 100% |
| `src/commands/deploy.ts` | Thin wrapper with `--dar`, `--dry-run`, `--json`, `--party` | — | — |
| `src/commands/console.ts` | Readline REPL, banner, inline error recovery | — | — |
| `src/commands/auth/login.ts` | Store JWT per network (validates connectivity first) | — | — |
| `src/commands/auth/logout.ts` | Remove stored credentials | — | — |
| `src/commands/auth/status.ts` | Show auth state per network (env var + keychain) | — | — |

**Total (Phases 0-4): 277 unit + 66 E2E = 343 tests.**

### Done (Phase 5)

| Component | Status | Tests |
|-----------|--------|-------|
| Plugin hook integration | builder, test-runner, deployer emit before/after hooks | +9 unit |
| OS keychain wiring | keytar-backend.ts with fallback, auth commands updated | +2 unit |
| `cantonctl clean` | cleaner.ts + clean.ts command + docs/reference/clean.md | +9 unit |
| Deploy E2E | scaffold → build → deploy pipeline (3 tests) | +3 E2E |
| Status E2E | health check, unreachable, parties query (3 tests) | +3 E2E |
| CI workflow | .github/workflows/ci.yml — unit on PR, E2E on main | — |
| Task docs | deploy-to-devnet, use-the-console, write-and-run-tests | — |
| Concept docs | authentication.md (JWT, token lifecycle, credential resolution) | — |

**Total (Phases 0-5): 297 unit + 72 E2E = 369 tests.**

### Done (Phase 6)

| Component | Status | Tests |
|-----------|--------|-------|
| `src/lib/topology.ts` | Pure topology generation: Docker Compose + Canton HOCON + bootstrap script | +32 unit |
| `src/lib/docker.ts` | Docker Compose lifecycle: checkAvailable, composeUp, composeDown, composeLogs | +9 unit |
| `src/lib/dev-server-full.ts` | Multi-node dev server: Docker topology, multi-participant health, cross-node hot-reload | +23 unit |
| `src/lib/errors.ts` | 2 new error codes: E3004 (Docker not available), E3005 (Docker Compose failed) | — |
| `src/commands/dev.ts` | Updated: `--full`, `--base-port`, `--canton-image` flags wired to FullDevServer | — |
| `docs/adr/0014-dev-full-multi-node-topology.md` | Architecture decision with best practice criteria and alternatives analysis | — |

**Total (Phases 0-6): 361 unit + 72 E2E = 433 tests.**

### Done (Phase 7)

| Component | Status | Tests |
|-----------|--------|-------|
| `build --watch` | Chokidar file watching for continuous `.daml` compilation | +5 unit |
| Interactive init | Inquirer prompts when `cantonctl init` run with no args | +3 unit |
| Multi-node status | Detects `.cantonctl/` directory for multi-node topology awareness | +2 unit |
| Build --watch E2E | E2E test verifying file change detection and rebuild | +3 E2E |
| Docker E2E tests | Multi-node topology start, health, parties, shutdown | +2 E2E |
| Java discovery | Cross-platform resolution: JAVA_HOME → java_home → Homebrew → PATH | Fix |
| Canton 3.4.x HOCON | Sequencers + mediators schema, 0.0.0.0 bindings, custom entrypoint | Fix |
| CI parity | e2e-docker job, Canton image caching, ci-local.sh alignment | +1 CI job |

**Total (Phases 0-7): 374 unit + 77 E2E = 451 tests. 98.18% statement coverage. 100% pass rate.**

### Remaining for v1

```
CHANGELOG.md                                    — release notes for v1.0.0
Version bump (0.1.0 → 1.0.0)                   — package.json
npm publish                                      — npm install -g cantonctl
--json conformance audit                        — verify every command's JSON output
```

Detailed sequencing and open decisions live in [docs/PHASE_4_PREP.md](./PHASE_4_PREP.md).

---

## Phase 3: Delivered Scope

### 3.1 `build` command

Shipped in Phase 3:
- `createBuilder()` wraps `DamlSdk.build()` with DAR caching and `--force`
- `--codegen` triggers TypeScript generation after successful compilation
- `--json` output reports `{darPath, cached, durationMs}`
- 11 unit tests + 7 E2E tests cover the live build path

Deferred:
- `build --watch` stays in Phase 5 so `dev` remains the only long-running rebuild loop

Files:
- `src/lib/builder.ts` — Build logic with caching and codegen
- `src/lib/builder.test.ts` — Unit tests
- `src/commands/build.ts` — Thin wrapper
- `test/e2e/build.e2e.test.ts` — E2E: all 5 templates build successfully
- `docs/reference/build.md` — Reference docs

### 3.2 `test` command

Shipped in Phase 3:
- `createTestRunner()` wraps `DamlSdk.test()` and reports pass/fail via exit code
- `--filter` forwards the test pattern to the SDK
- ANSI escape codes are stripped before human or JSON output
- 8 unit tests + 2 E2E tests cover the live SDK path

Deferred:
- Per-test counts and richer structured parsing wait on a stable machine-readable SDK format

Files:
- `src/lib/test-runner.ts` — Test logic with output parsing
- `src/lib/test-runner.test.ts` — Unit tests
- `src/commands/test.ts` — Thin wrapper
- `test/e2e/test-cmd.e2e.test.ts` — E2E: token template tests pass
- `docs/reference/test.md` — Reference docs

### 3.3 `status` command

Shipped in Phase 3:
- `status` loads the selected network from config and queries `LedgerClient.getVersion()`
- When healthy, it also queries `LedgerClient.getParties()`
- JWT generation is automatic for sandbox-style local flows
- `--json` output reports `{healthy, version, parties}`

Deferred:
- Package listing remains out of scope until the client grows a stable package-query path
- A dedicated status E2E fixture is still pending

Files:
- `src/commands/status.ts` — Rewrite with LedgerClient
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
- Step 6 — **Vet**: Wait for package vetting on remote networks when required
- Step 7 — **Verify**: confirm the returned `mainPackageId` and re-check node health
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
- Storage: OS keychain-backed credential store (per ADR-0008 / NEAR CLI pattern)
- Fallback: environment variable `CANTONCTL_JWT_<NETWORK>` overrides stored credential
- E2E test: auth login → deploy → verify credential was used

**Files:**
- `src/lib/credential-store.ts` — Keychain-backed credential storage
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
| `status` | Shows health, version, and parties for any configured network. |
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
| ~~`dev --full` (Docker multi-node)~~ | **Implemented in Phase 6** (ADR-0014) |
| Contract verification (block explorer) | Canton doesn't have public explorers yet |
| Fork mode (`dev --fork`) | Canton sandbox doesn't support forking |
| Network helpers (`setBalance`, `mine`) | Canton's privacy model doesn't expose state manipulation |
| Gas reporting | Canton doesn't have application-level gas |
| Telemetry / analytics | Can add post-launch with opt-in |
| Homebrew / standalone binary distribution | npm is sufficient for v1 |
| Centralized plugin registry | Community too small; GitHub URLs sufficient |
| Multi-SDK version management | Pin in config; version switching is dpm's job |
| `cantonctl exec` (scripting mode) | Wait until the console grammar stabilizes |
| Layer 2-5 of agentic docs system | Layer 1 content taxonomy is sufficient for launch |

---

## Implementation Order

1. Phase 4a — local deploy pipeline (`--dar`, `--dry-run`, upload, verification)
2. Phase 4c — keychain-backed credential store and `auth` command for remote deploy
3. Phase 4b — console REPL (`help`, `status`, `parties`, `query`, then submit flows)
4. Phase 4c — plugin hooks once build/test/deploy surfaces are stable
5. Phase 5 — polish, `build --watch`, broader E2E coverage, CI, and docs completion

Each phase follows the established pattern:
1. Write tests defining the contract
2. Implement to pass tests
3. E2E test against real SDK
4. Write reference + task docs
5. Update troubleshooting for new error codes
6. Update llms.txt and JSON Schema
