# cantonctl

Infrastructure-grade CLI toolchain for building on Canton Network. Scaffold, develop, test, and deploy Daml applications with a single tool.

## Why

The [Q1 2026 Canton Developer Experience Survey](https://forum.canton.network/t/canton-network-developer-experience-and-tooling-survey-analysis-2026/8412) found that **41% of developers** cited environment setup as the task that took the longest to get right. 71% of Canton developers come from EVM backgrounds and expect Hardhat/Foundry-level tooling.

cantonctl eliminates the "infrastructure engineer before product builder" problem.

## Quick Start

```bash
# Install
npm install -g cantonctl

# Create a new project
cantonctl init my-app --template token

# Start local development
cd my-app
cantonctl dev

# Build & test
cantonctl build
cantonctl test

# Deploy
cantonctl deploy devnet
```

## Commands

| Command | Description |
|---------|-------------|
| `cantonctl init <name>` | Scaffold a new project from a template |
| `cantonctl dev` | Start local Canton node with hot-reload |
| `cantonctl build` | Compile Daml + generate TypeScript bindings |
| `cantonctl test` | Run Daml Script tests with structured output |
| `cantonctl deploy <network>` | Deploy to local/devnet/testnet/mainnet |
| `cantonctl console` | Interactive REPL connected to Canton node |
| `cantonctl status` | Show node health, packages, and parties |

## Templates

| Template | Target Audience |
|----------|----------------|
| `basic` | First-time Canton developer |
| `token` | DeFi builder starting with tokens |
| `defi-amm` | AMM / liquidity pool development |
| `api-service` | Backend service consuming Ledger API |
| `zenith-evm` | EVM developer building via Zenith |

## Architecture

cantonctl is built on [oclif](https://oclif.io/) with a plugin system inspired by Hardhat's HRE. Design decisions are justified by research across 16 blockchain CLI toolchains, 7 AI documentation platforms, and 5 critical infrastructure documentation standards.

- **[Design Decisions](docs/DESIGN_DECISIONS.md)** — Every choice justified by evidence
- **[Agentic Documentation System](docs/AGENTIC_DOCS_SYSTEM.md)** — Beyond-SOTA documentation architecture
- **[Research: Blockchain CLIs](docs/research/blockchain-cli-toolchain-research.md)** — 16 toolchains analyzed
- **[Research: Canton Ecosystem](docs/research/CANTON_ECOSYSTEM_RESEARCH.md)** — Full ecosystem deep dive
- **[Research: Agentic Docs](docs/research/AGENTIC_DOCS_RESEARCH.md)** — AI documentation SOTA survey

## Plugin System

cantonctl supports npm-based plugins following the oclif pattern:

```bash
# Install a community plugin
npm install @cantonctl/plugin-zenith

# Plugins are auto-discovered from node_modules
cantonctl zenith deploy  # commands from the plugin
```

Plugin authors: see [Plugin Development Guide](docs/plugin-development.md) (coming soon).

## Project Structure

```
cantonctl/
├── src/
│   ├── commands/        # CLI commands (oclif)
│   │   ├── init.ts      # Project scaffolding
│   │   ├── dev.ts       # Local development server
│   │   ├── build.ts     # Daml compilation
│   │   ├── test.ts      # Test runner
│   │   ├── deploy.ts    # Network deployment
│   │   ├── console.ts   # Interactive REPL
│   │   └── status.ts    # Node status
│   ├── hooks/           # oclif lifecycle hooks
│   └── lib/             # Shared utilities
│       └── config.ts    # cantonctl.yaml loader (Zod-validated)
├── docs/                # Design docs & research
├── templates/           # Project templates (bundled)
└── bin/                 # CLI entry point
```

## Development Fund Proposal

This tool is proposed under the [Canton Development Fund](https://github.com/canton-foundation/canton-dev-fund). See the [proposal](https://github.com/canton-foundation/canton-dev-fund/proposals/cantonctl.md) for full details.

## Contributing

Contributions welcome. Please read the design decisions document before proposing architectural changes.

## License

MIT
