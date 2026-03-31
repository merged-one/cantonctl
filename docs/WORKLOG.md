# cantonctl Worklog

## 2026-03-31 (Session 2) — E2E Tests, SDK Integration, Layer 1 Docs, Hardening

### Summary

Installed Daml SDK 3.4.11 + JDK 21, wrote and passed 57 E2E tests proving init and dev work against real Canton infrastructure. Built Layer 1 of the agentic documentation system. Fixed real-world bugs discovered during E2E testing.

### E2E Test Results

**Init (54 tests):**
- All 5 templates scaffold correctly on real filesystem
- All 5 templates' `cantonctl.yaml` passes Zod schema validation
- All 5 templates compile with `daml build` (real Daml SDK)
- All 5 templates' Daml Script tests pass with `daml test`
- Directory collision detection works
- JSON output returns correct structure

**Dev (3 tests):**
- Real Canton sandbox starts and becomes healthy (~8s)
- Party provisioning attempts gracefully (sandbox doesn't support explicit allocation — parties auto-allocate on first command use)
- Shutdown cleanly frees ports and kills process

### Real-World Bugs Fixed

| Bug | Discovery | Fix |
|-----|-----------|-----|
| `POST /v2/parties/allocate` doesn't exist in Canton V2 API | E2E: 405 Method Not Allowed | Changed to `POST /v2/parties` with `{partyIdHint, displayName}` |
| `createMockProcessRunner` has `await` without `async` | E2E: esbuild transform error | Made function async (then removed entirely — unused) |
| Canton sandbox doesn't support explicit party allocation | E2E: "PARTY_ALLOCATION_WITHOUT_CONNECTED_SYNCHRONIZER" | Dev server handles gracefully via warn(); parties auto-allocate on first use |
| `daml build` output goes to stderr, not stdout | E2E: assertion checked stdout for ".dar" | Changed to verify `.dar` file exists on disk |

### Layer 1: Agentic Documentation Content Taxonomy

| Type | Files | Content |
|------|-------|---------|
| Reference | `docs/reference/init.md`, `docs/reference/dev.md` | Full command docs: args, flags, examples, error codes, JSON output schema |
| Reference | `docs/reference/cantonctl-schema.json` | JSON Schema for cantonctl.yaml (enables IDE autocomplete) |
| Troubleshooting | `docs/troubleshooting/errors.md` | All 21 error codes with symptoms and resolution steps |
| Concepts | `docs/concepts/canton-for-evm-developers.md` | EVM-to-Canton mapping: msg.sender→Party, Hardhat→cantonctl, JSON-RPC→Ledger API |
| Concepts | `docs/concepts/configuration.md` | Hierarchical config system, merge behavior, env vars |
| Tasks | `docs/tasks/create-token-project.md` | End-to-end tutorial with `<!-- doctest:begin -->` blocks |
| Tasks | `docs/tasks/local-development.md` | Dev environment setup tutorial with doctest blocks |
| Machine | `llms.txt` | AI-discoverable summary for LLM tooling |

### Infrastructure

- `scripts/install-prerequisites.sh` — Installs Java 21, Daml SDK 3.4.11 (or checks with `--check`)
- `npm run test:e2e` — Runs E2E tests (requires SDK)
- `npm run test:all` — Runs unit + E2E tests
- Removed deprecated `createMockProcessRunner` from process-runner.ts

### Metrics

- **Unit tests:** 161 (all passing)
- **E2E tests:** 57 (all passing)
- **Total:** 218 tests
- **Coverage:** 99.89% statements, 92.22% branches, 100% functions (lib/)

---

## 2026-03-31 (Session 1) — Phase 1-2 Complete + init/dev Fully Implemented

### Session Summary

Single implementation session completing Phases 1-2 and delivering production-grade `init` and `dev` commands with 142 tests at 97% coverage.

### Work Completed

#### Phase 1 Remaining: Enhanced Config

- **`src/lib/config.ts`** — Complete rewrite from 60-line loader to 285-line hierarchical config system
  - 4-layer merge: user config (`~/.config/cantonctl/config.yaml`) < project config < `CANTONCTL_*` env vars < CLI flags
  - `loadConfig()`, `resolveConfig()`, `mergeConfigs()` public API
  - `ConfigFileSystem` DI interface (no vi.mock needed)
  - Human-readable Zod error messages with field paths
  - All 3 config error codes: `E1001` not found, `E1002` invalid YAML, `E1003` schema violation
- **`src/lib/config.test.ts`** — 18 tests

#### Phase 2: SDK & Ledger Libraries

- **`src/lib/daml.ts`** — DamlSdk abstraction (13 tests)
  - `detect()` — auto-finds dpm (preferred) or daml, caches result
  - `build()`, `test()`, `codegen()` — subprocess delegation with structured errors
  - `startSandbox()` — spawns long-running process
  - AbortSignal on all operations

- **`src/lib/ledger-client.ts`** — Canton JSON Ledger API V2 client (11 tests)
  - 6 endpoints: `getVersion`, `uploadDar`, `submitAndWait`, `getActiveContracts`, `allocateParty`, `getParties`
  - Error mapping: network → E7001, 401 → E7003, upload fail → E6003, command rejected → E7002
  - Fetch DI for testability

- **`src/lib/jwt.ts`** — Sandbox JWT generation (9 tests)
  - HS256 signing with well-known secret (Canton sandbox decodes but doesn't validate)
  - `createSandboxToken()` + `decodeSandboxToken()` round-trip
  - Configurable expiry (default 24h)

#### Phase 2 Continued: init & dev Commands

- **`src/lib/scaffold.ts`** — Pure scaffolding logic (26 tests, 100% coverage)
  - All 5 templates generate real content:
    - `basic` — Hello contract + UpdateMessage
    - `token` — Token with Transfer/Burn/Mint + 4 Daml Script tests
    - `defi-amm` — LiquidityPool with AddLiquidity/Swap
    - `api-service` — Record CRUD contract + Express.js server with Ledger API endpoints + tsconfig + package.json
    - `zenith-evm` — EvmBridgeRecord contract + Solidity ERC-20 token + Hardhat config + package.json
  - `scaffoldFromUrl()` — git clone with 60s timeout, validates `cantonctl-template.yaml` manifest
  - `ScaffoldFileSystem` DI interface
  - All generated configs pass Zod schema validation

- **`src/lib/dev-server.ts`** — Dev server orchestration (24 tests, 92% coverage)
  - Full startup sequence: detect SDK → check ports → start sandbox → poll health → generate JWT → provision parties → start watcher
  - Port-in-use detection before startup → `SANDBOX_PORT_IN_USE` (E3002) with port number
  - Health polling with retry/backoff (conformance kit pattern) + fail-fast on sandbox exit → `SANDBOX_START_FAILED` (E3001)
  - Idempotent party provisioning: fetches existing parties first, skips already-allocated
  - Hot-reload: chokidar watches `daml/`, filters `.daml` files only, debounced (300ms default), concurrent rebuild protection (queue)
  - DAR discovery: `findDarFile()` globs for `*.dar` in `.daml/dist/`
  - Graceful shutdown: AbortSignal propagation, clean watcher close, sandbox kill

- **`src/commands/init.ts`** — Thin oclif wrapper over scaffold.ts
  - `--json` flag via OutputWriter, CantonctlError on all failures

- **`src/commands/dev.ts`** — Thin oclif wrapper over dev-server.ts
  - Promise-based shutdown (no `process.exit`), stdin cleanup, error-path cleanup
  - `[q]` key and SIGINT/SIGTERM for graceful shutdown
  - JSON mode: emits structured result then waits for shutdown signal

#### Documentation & Assets

- **`README.md`** — Complete rewrite with light/dark logo, implementation status, architecture section, error codes reference, foundation libraries table
- **`CLAUDE.md`** — Project guide with architecture rules, module layout, test patterns, error code ranges, Canton-specific context, implementation status
- **`assets/cantonctl-logo.svg`** — Light mode wordmark (terminal prompt icon + monospace "cantonctl")
- **`assets/cantonctl-logo-dark.svg`** — Dark mode variant

#### Fixes (infrastructure-grade hardening)

| Issue | Resolution |
|-------|-----------|
| `@types/cli-table3` doesn't exist on npm | Removed from devDependencies |
| Hot-reload reads directory as file | New `findDarFile` dependency globs for `*.dar` |
| No debounce on file watcher | Configurable `debounceMs` with clearTimeout/setTimeout |
| No concurrent rebuild protection | `rebuildInProgress` flag + `rebuildQueued` queue |
| No sandbox exit detection | `onExit` callback → `sandboxExited` flag → fail-fast in health poll |
| No port-in-use detection | `isPortInUse` dependency checked before sandbox start |
| `process.exit(0)` in shutdown | Promise-based shutdown, stdin cleanup |
| Party provisioning not idempotent | Fetches existing parties, skips already-allocated |
| Non-.daml files trigger rebuild | Filter: `if (!fp.endsWith('.daml')) return` |
| `--from` git clone no timeout | Added `timeout: 60_000` |
| api-service/zenith-evm templates empty | Full Express.js server + Solidity ERC-20 + Hardhat config |

### Metrics

- **Test files:** 9
- **Tests:** 142 (all passing)
- **Coverage:** 97.07% statements, 85.66% branches, 100% functions
- **New source files:** 6 (config.test.ts, daml.ts, jwt.ts, ledger-client.ts, scaffold.ts, dev-server.ts + their test files)
- **Modified files:** 6 (README.md, package.json, config.ts, init.ts, dev.ts, vitest.config.ts)

### What's Next

- **Phase 3:** Rewrite build, test, status commands with real DamlSdk integration
- **Phase 4:** dev --full (Docker), console REPL, deploy pipeline
- **Phase 5:** Integration tests, --json conformance, error code coverage, help snapshots
