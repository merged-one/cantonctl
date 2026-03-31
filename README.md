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

# Create a new project
cantonctl init my-app --template token

# Start local development (sandbox + hot-reload + party provisioning)
cd my-app
cantonctl dev

# Build & test
cantonctl build
cantonctl test

# Deploy
cantonctl deploy devnet
```

## Commands

| Command | Description | Status |
|---------|-------------|--------|
| `cantonctl init <name>` | Scaffold a new project from a template | Implemented |
| `cantonctl dev` | Start local Canton sandbox with hot-reload | Implemented |
| `cantonctl build` | Compile Daml + generate TypeScript bindings | Stub |
| `cantonctl test` | Run Daml Script tests with structured output | Stub |
| `cantonctl deploy <network>` | Deploy to local/devnet/testnet/mainnet | Stub |
| `cantonctl console` | Interactive REPL connected to Canton node | Stub |
| `cantonctl status` | Show node health, packages, and parties | Stub |

All commands support `--json` for CI pipeline integration. All errors include error codes, suggestions, and documentation links.

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

`cantonctl dev` provides a complete local development environment:

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

## Architecture

### Core Principles

- **Test-first TDD**: Tests define the contract, implementation follows (218 tests, 99.9% coverage)
- **Dependency injection**: Every I/O module accepts injected dependencies. Zero `vi.mock()`.
- **AbortSignal everywhere**: All long-running operations support graceful cancellation
- **Structured errors**: Every error is a `CantonctlError` with code (E1xxx-E8xxx), suggestion, and docs URL
- **Dual output**: Every command supports `--json` for CI pipelines

### Foundation Libraries

| Module | Purpose | Test Coverage |
|--------|---------|---------------|
| `src/lib/config.ts` | Hierarchical config: project > user > env > flags. Zod-validated YAML. | 98% |
| `src/lib/errors.ts` | 21 error codes (E1xxx-E8xxx) with suggestions and docs URLs | 100% |
| `src/lib/output.ts` | Human/JSON/quiet output modes, spinners, tables | 97% |
| `src/lib/process-runner.ts` | Subprocess abstraction over execa. Injectable mock for tests. | Mock-tested |
| `src/lib/daml.ts` | DamlSdk: detect, build, test, codegen, startSandbox | 95% |
| `src/lib/ledger-client.ts` | HTTP client for Canton JSON Ledger API V2 (6 endpoints) | 100% |
| `src/lib/jwt.ts` | HS256 JWT generation for sandbox auth (well-known secret) | 100% |
| `src/lib/scaffold.ts` | Pure scaffolding logic, 5 templates, community template support | 100% |
| `src/lib/dev-server.ts` | Dev server orchestration: sandbox + health + parties + hot-reload | 94% |

### Project Structure

```
cantonctl/
├── src/
│   ├── commands/              # CLI commands (thin oclif wrappers)
│   │   ├── init.ts            # → scaffold.ts
│   │   ├── dev.ts             # → dev-server.ts
│   │   ├── build.ts           # → daml.ts (stub)
│   │   ├── test.ts            # → daml.ts (stub)
│   │   ├── deploy.ts          # → ledger-client.ts (stub)
│   │   ├── console.ts         # (stub)
│   │   └── status.ts          # (stub)
│   ├── hooks/                 # oclif lifecycle hooks
│   │   ├── init.ts
│   │   └── prerun.ts
│   └── lib/                   # Foundation libraries (fully tested)
│       ├── config.ts          # Config loading + hierarchical merge
│       ├── config.test.ts
│       ├── daml.ts            # SDK abstraction (dpm/daml)
│       ├── daml.test.ts
│       ├── dev-server.ts      # Dev server orchestration
│       ├── dev-server.test.ts
│       ├── errors.ts          # Structured error system
│       ├── errors.test.ts
│       ├── jwt.ts             # Sandbox JWT generation
│       ├── jwt.test.ts
│       ├── ledger-client.ts   # Canton JSON Ledger API V2 client
│       ├── ledger-client.test.ts
│       ├── output.ts          # Human/JSON/quiet output
│       ├── output.test.ts
│       ├── process-runner.ts  # Subprocess abstraction
│       ├── process-runner.test.ts
│       ├── scaffold.ts        # Project scaffolding + templates
│       └── scaffold.test.ts
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
| E3xxx | Sandbox | `E3001` Start failed, `E3002` Port in use, `E3003` Health timeout |
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
- **[Agentic Documentation System](docs/AGENTIC_DOCS_SYSTEM.md)** — Beyond-SOTA documentation architecture
- **[Research: Blockchain CLIs](docs/research/blockchain-cli-toolchain-research.md)** — 16 toolchains analyzed
- **[Research: Canton Ecosystem](docs/research/CANTON_ECOSYSTEM_RESEARCH.md)** — Full ecosystem deep dive
- **[Research: Agentic Docs](docs/research/AGENTIC_DOCS_RESEARCH.md)** — AI documentation SOTA survey

## Development

```bash
npm install          # Install dependencies
npm test             # Run unit tests (161 tests)
npm run test:watch   # Watch mode
npm run test:e2e     # Run E2E tests (57 tests, requires Daml SDK + Java 21)
npm run test:all     # Run all 218 tests
npm run test:coverage # Coverage report (99.9% statements)
npm run build        # Compile TypeScript
```

## Development Fund Proposal

This tool is proposed under the [Canton Development Fund](https://github.com/canton-foundation/canton-dev-fund). See the [proposal](https://github.com/canton-foundation/canton-dev-fund/proposals/cantonctl.md) for full details.

## Contributing

Contributions welcome. Please read the [Design Decisions](docs/DESIGN_DECISIONS.md) document before proposing architectural changes.

## License

MIT
