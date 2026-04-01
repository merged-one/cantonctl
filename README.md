<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/banner.svg">
  <img alt="cantonctl — Institutional-grade CLI toolchain for Canton Network" src="assets/banner.svg">
</picture>

## Why

The [Q1 2026 Canton Developer Experience Survey](https://forum.canton.network/t/canton-network-developer-experience-and-tooling-survey-analysis-2026/8412) found that **41% of developers** cited environment setup as the task that took the longest to get right. **71%** of Canton developers come from EVM backgrounds and expect Hardhat/Foundry-level tooling.

cantonctl eliminates the "infrastructure engineer before product builder" problem.

## Quick Start

```bash
# Install
npm install -g cantonctl

# Create a new project (or run `cantonctl init` for interactive prompts)
cantonctl init my-app --template token

# Start local development (sandbox + hot-reload + party provisioning)
cd my-app
cantonctl dev

# Build, test, and inspect the local node
cantonctl build
cantonctl build --watch   # Continuous compilation on .daml changes
cantonctl test
cantonctl status          # Multi-node aware via .cantonctl/ directory

# Deploy to local sandbox
cantonctl deploy

# Interactive REPL
cantonctl console
```

## Commands

| Command | Description | Status |
|---------|-------------|--------|
| `cantonctl init [name]` | Scaffold a new project (interactive prompts when no args) | Implemented |
| `cantonctl dev` | Start local Canton sandbox with hot-reload | Implemented |
| `cantonctl dev --full` | Multi-node Docker topology (synchronizer + N participants) | Implemented |
| `cantonctl build` | Compile Daml + generate TypeScript bindings | Implemented |
| `cantonctl build --watch` | Continuous compilation on `.daml` file changes (chokidar) | Implemented |
| `cantonctl test` | Run Daml Script tests with structured output | Implemented |
| `cantonctl deploy <network>` | 7-step DAR deployment pipeline for local and remote networks | Implemented |
| `cantonctl console` | Interactive REPL for querying and submitting ledger commands | Implemented |
| `cantonctl status` | Show node health, version, and active parties (multi-node aware) | Implemented |
| `cantonctl auth login/logout/status` | Manage JWT credentials per network | Implemented |
| `cantonctl clean` | Remove build artifacts (.daml/, dist/) | Implemented |

All implemented commands support `--json` for CI pipeline integration. All errors include error codes, suggestions, and documentation links.

## Templates

```bash
cantonctl init my-app                        # basic template (default)
cantonctl init my-app --template token       # Token with Mint/Transfer/Burn
cantonctl init my-app --template defi-amm    # Liquidity pool + AMM swap
cantonctl init my-app --template api-service # Express.js + Ledger API
cantonctl init my-app --template zenith-evm  # Solidity + Hardhat + Canton bridge
cantonctl init my-app --from <github-url>    # Community template
```

| Template | Target Audience | What's Generated |
|----------|----------------|------------------|
| `basic` | First-time Canton developer | Hello contract, Daml Script test, cantonctl.yaml |
| `token` | DeFi builder | Token with Transfer/Burn/Mint, 4 test cases, React frontend scaffold |
| `defi-amm` | AMM / liquidity pool | LiquidityPool with AddLiquidity/Swap, 2 test cases |
| `api-service` | Backend developer | Daml Record contract + Express.js server with Ledger API endpoints |
| `zenith-evm` | EVM developer via Zenith | Solidity ERC-20 token, Hardhat config, Canton bridge contract |

Community templates: any GitHub repo with a `cantonctl-template.yaml` manifest.

## Local Development

### Sandbox Mode (default)

`cantonctl dev` provides a zero-Docker local development environment:

1. **SDK detection** — Finds `dpm` (preferred) or `daml` on PATH
2. **Sandbox startup** — Spawns Canton sandbox as subprocess (no Docker required)
3. **Health polling** — Waits for JSON Ledger API to become available (retry with backoff)
4. **JWT generation** — Creates HS256 token for sandbox authentication
5. **Party provisioning** — Allocates all parties defined in `cantonctl.yaml`
6. **Hot-reload** — Watches `daml/` for changes, rebuilds, and uploads new DARs
7. **Graceful shutdown** — `Ctrl+C` or `q` key cleanly stops sandbox and watcher

```bash
cantonctl dev                    # Default: port 5001, JSON API 7575
cantonctl dev --port 6001        # Custom Canton node port
cantonctl dev --json             # JSON output for CI
```

### Multi-Node Mode (`--full`)

`cantonctl dev --full` launches a realistic multi-node Canton topology via Docker:

- **Single Canton container** hosting synchronizer + multiple participants (conformance kit pattern)
- **Auto-generated configs** — Docker Compose, Canton HOCON, and bootstrap scripts from `cantonctl.yaml`
- **Party-to-participant mapping** — `operator` → participant1, `participant` → participant2
- **Cross-node hot-reload** — DAR changes uploaded to all participants simultaneously
- **In-memory storage** — Fastest startup, no Postgres required

```bash
cantonctl dev --full                          # Multi-node on default ports (10000+)
cantonctl dev --full --base-port 20000        # Custom base port
cantonctl dev --full --canton-image <image>   # Custom Canton Docker image
```

See [ADR-0014](docs/adr/0014-dev-full-multi-node-topology.md) for architecture details.

## Architecture

### Core Principles

- **Test-first TDD**: Tests define the contract, implementation follows (443 tests, 98.18% statement coverage)
- **Dependency injection**: Every I/O module accepts injected dependencies. Zero `vi.mock()`.
- **AbortSignal everywhere**: All long-running operations support graceful cancellation
- **Structured errors**: Every error is a `CantonctlError` with code (E1xxx-E8xxx), suggestion, and docs URL
- **Dual output**: Every shipped command supports `--json`; new commands must preserve that contract

### Foundation Libraries

| Module | Purpose | Test Coverage |
|--------|---------|---------------|
| `src/lib/config.ts` | Hierarchical config: project > user > env > flags. Zod-validated YAML. | 98% |
| `src/lib/errors.ts` | 23 error codes (E1xxx-E8xxx) with suggestions and docs URLs | 100% |
| `src/lib/output.ts` | Human/JSON/quiet output modes, spinners, tables | 97% |
| `src/lib/process-runner.ts` | Subprocess abstraction over execa. Injectable mock for tests. | Mock-tested |
| `src/lib/daml.ts` | DamlSdk: detect, build, test, codegen, startSandbox | 95% |
| `src/lib/ledger-client.ts` | HTTP client for Canton JSON Ledger API V2 (6 endpoints) | 100% |
| `src/lib/jwt.ts` | HS256 JWT generation for sandbox auth (well-known secret) | 100% |
| `src/lib/scaffold.ts` | Pure scaffolding logic, 5 templates, community template support, interactive mode | 100% |
| `src/lib/dev-server.ts` | Dev server orchestration: sandbox + health + parties + hot-reload | 100% |
| `src/lib/builder.ts` | Build orchestration with DAR caching, codegen, and --watch mode (chokidar) | 100% |
| `src/lib/test-runner.ts` | Test execution with structured output and ANSI stripping | 100% |
| `src/lib/deployer.ts` | 6-step deploy pipeline: validate → build → auth → preflight → upload → verify | 100% |
| `src/lib/credential-store.ts` | Keychain-backed JWT storage with env var override | 100% |
| `src/lib/plugin-hooks.ts` | Lifecycle hook registry (7 hooks) for build/test/deploy | 100% |
| `src/lib/repl/parser.ts` | REPL command grammar shared with future `exec` | 100% |
| `src/lib/repl/executor.ts` | Dispatches parsed commands to LedgerClient | 100% |
| `src/lib/repl/completer.ts` | Tab completion for commands, parties, flags | 100% |
| `src/lib/cleaner.ts` | Build artifact cleanup (.daml/, dist/, node_modules/) | 100% |
| `src/lib/keytar-backend.ts` | OS keychain backend via keytar with in-memory fallback | 100% |
| `src/lib/topology.ts` | Multi-node topology generation (Docker Compose + Canton HOCON) | 100% |
| `src/lib/docker.ts` | Docker Compose lifecycle management | 100% |
| `src/lib/dev-server-full.ts` | Multi-node dev server with cross-participant hot-reload | 100% |

### Project Structure

```
cantonctl/
├── src/
│   ├── commands/              # CLI commands (thin oclif wrappers)
│   │   ├── init.ts            # → scaffold.ts
│   │   ├── dev.ts             # → dev-server.ts
│   │   ├── build.ts           # → builder.ts
│   │   ├── test.ts            # → test-runner.ts
│   │   ├── deploy.ts          # → deployer.ts
│   │   ├── console.ts         # → repl/{parser,executor,completer}
│   │   ├── status.ts          # → ledger-client.ts + jwt.ts
│   │   └── auth/              # Credential management subcommands
│   │       ├── login.ts       # Store JWT for a network
│   │       ├── logout.ts      # Remove stored credentials
│   │       └── status.ts      # Show auth state per network
│   ├── hooks/                 # oclif lifecycle hooks
│   │   ├── init.ts
│   │   └── prerun.ts
│   └── lib/                   # Foundation libraries (fully tested)
│       ├── config.ts          # Config loading + hierarchical merge
│       ├── deployer.ts        # 6-step deploy pipeline
│       ├── credential-store.ts# Keychain-backed JWT storage
│       ├── plugin-hooks.ts    # Lifecycle hook registry
│       ├── daml.ts            # SDK abstraction (dpm/daml)
│       ├── dev-server.ts      # Sandbox dev server orchestration
│       ├── dev-server-full.ts # Multi-node Docker dev server
│       ├── topology.ts        # Topology config generation
│       ├── docker.ts          # Docker Compose lifecycle
│       ├── errors.ts          # Structured error system
│       ├── jwt.ts             # Sandbox JWT generation
│       ├── ledger-client.ts   # Canton JSON Ledger API V2 client
│       ├── output.ts          # Human/JSON/quiet output
│       ├── process-runner.ts  # Subprocess abstraction
│       ├── scaffold.ts        # Project scaffolding + templates
│       ├── builder.ts         # Build orchestration + DAR caching
│       ├── test-runner.ts     # Test execution + ANSI stripping
│       ├── cleaner.ts         # Build artifact cleanup
│       ├── keytar-backend.ts  # OS keychain backend for credentials
│       └── repl/
│           ├── parser.ts      # Command grammar (shared with exec)
│           ├── executor.ts    # Dispatch commands to LedgerClient
│           └── completer.ts   # Tab completion
├── assets/                    # Logo SVGs
├── docs/                      # Design docs & research
│   ├── DESIGN_DECISIONS.md    # 10 evidence-backed decisions
│   ├── AGENTIC_DOCS_SYSTEM.md # Documentation architecture
│   └── research/              # 16 CLIs, Canton ecosystem, AI docs
├── bin/
│   └── run.js                 # CLI entry point
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Error Codes

Every error includes a code, message, suggestion, and link to documentation.

| Range | Subsystem | Examples |
|-------|-----------|---------|
| E1xxx | Configuration | `E1001` Config not found, `E1002` Invalid YAML, `E1003` Schema violation, `E1004` Directory exists |
| E2xxx | SDK/Tools | `E2001` SDK not installed, `E2003` Command failed |
| E3xxx | Sandbox/Docker | `E3001` Start failed, `E3002` Port in use, `E3003` Health timeout, `E3004` Docker not available, `E3005` Compose failed |
| E4xxx | Build | `E4001` Daml compilation error |
| E5xxx | Test | `E5001` Test execution failed |
| E6xxx | Deploy | `E6001` Auth failed, `E6003` Upload failed |
| E7xxx | Ledger API | `E7001` Connection failed, `E7003` Auth expired |
| E8xxx | Console | `E8001` Parse error |

## Plugin System

cantonctl supports npm-based plugins following the oclif pattern:

```bash
npm install @cantonctl/plugin-zenith
cantonctl zenith deploy  # Commands from the plugin
```

Plugins are auto-discovered from `node_modules` matching `@cantonctl/plugin-*` or `cantonctl-plugin-*`.

## Design Documentation

- **[Design Decisions](docs/DESIGN_DECISIONS.md)** — 10 evidence-backed architecture decisions
- **[ADR-0014: Multi-Node Topology](docs/adr/0014-dev-full-multi-node-topology.md)** — `dev --full` Docker architecture
- **[Agentic Documentation System](docs/AGENTIC_DOCS_SYSTEM.md)** — Beyond-SOTA documentation architecture
- **[Phase 4 Prep](docs/PHASE_4_PREP.md)** — Concrete execution order for deploy, console, auth, and hooks
- **[Research: Blockchain CLIs](docs/research/blockchain-cli-toolchain-research.md)** — 16 toolchains analyzed
- **[Research: Canton Ecosystem](docs/research/CANTON_ECOSYSTEM_RESEARCH.md)** — Full ecosystem deep dive
- **[Research: Agentic Docs](docs/research/AGENTIC_DOCS_RESEARCH.md)** — AI documentation SOTA survey

## Development

```bash
npm install          # Install dependencies
npm test             # Run unit tests (371 tests)
npm run test:watch   # Watch mode
npm run test:e2e     # Run E2E tests (75 tests, requires Daml SDK + Java 21)
npm run test:all     # Run all 446 tests
npm run test:coverage # Coverage report (98.18% statements)
npm run build        # Compile TypeScript
```

## Development Fund Proposal

This tool is proposed under the [Canton Development Fund](https://github.com/canton-foundation/canton-dev-fund). See the [proposal](https://github.com/canton-foundation/canton-dev-fund/proposals/cantonctl.md) for full details.

## Contributing

Contributions welcome. Please read the [Design Decisions](docs/DESIGN_DECISIONS.md) document before proposing architectural changes.

## License

MIT
