## Development Fund Proposal

**Author:** Merged One
**Status:** Draft
**Created:** 2026-03-31
**Repository:** [merged-one/cantonctl](https://github.com/merged-one/cantonctl)

---

## Abstract

cantonctl is a unified CLI toolchain that gives developers a Hardhat/Foundry-like experience for building on Canton. It eliminates the #1 pain point identified in the Q1 2026 Developer Experience Survey — environment setup and node operations — by providing a single command-line tool that scaffolds, builds, tests, and deploys Daml applications without requiring developers to become infrastructure engineers first.

Today, getting a Canton dev environment running means orchestrating Docker Compose files, multi-node topologies, Keycloak auth, and observability stacks (cn-quickstart, 8GB+ Docker RAM). cantonctl replaces this with `cantonctl init`, `cantonctl dev`, and `cantonctl deploy` — commands that feel familiar to the 71% of Canton developers coming from EVM ecosystems.

**Current status:** Two commands (`init`, `dev`) are fully implemented and E2E-tested against a real Canton sandbox. The CLI ships with 5 project templates, 9 foundation libraries, Layer 1 of an agentic documentation system, and 218 tests at 99.89% coverage. The repository is public at [merged-one/cantonctl](https://github.com/merged-one/cantonctl).

---

## Specification

### 1. Objective

**Problem:** 41% of surveyed Canton developers said environment setup took the longest to "get right." The current path from zero to a running Daml app requires:
- Cloning cn-quickstart and understanding its Docker Compose orchestration
- Configuring multi-node topologies manually
- Setting up authentication (Keycloak / shared-secret)
- Managing .dar builds, package IDs, and deployment artifacts by hand
- Debugging blind deployments with no resource/cost profiling

**Intended Outcome:** A single CLI tool (`cantonctl`) that reduces time-to-first-transaction from hours to minutes, with:
- Zero-config project scaffolding with templates for common DeFi patterns
- A lightweight local dev environment (single Canton node, hot-reload)
- Integrated build, test, and deploy pipeline
- EVM-familiar ergonomics and terminology mapping

### 2. Implementation Mechanics

**Technology Stack (validated by [research across 16 blockchain CLI toolchains](https://github.com/merged-one/cantonctl/blob/main/docs/research/blockchain-cli-toolchain-research.md)):**
- **oclif v4 (TypeScript)** — chosen over Go/Cobra and Rust/Clap for its production-proven npm-based plugin system (used by Salesforce CLI, Heroku CLI, Twilio CLI) and alignment with the 71% EVM developer audience
- **execa v9** for subprocess management (dpm/daml wrapping)
- **Zod** for runtime config validation with developer-friendly error messages
- **picocolors** for terminal output (14x smaller, 2x faster than chalk)
- Wraps `dpm` under the hood — does not replace the Daml SDK, orchestrates it

**Core Commands:**

| Command | Description | Status |
|---------|-------------|--------|
| `cantonctl init [template]` | Scaffold a new project from a template | **Implemented** — 54 E2E tests |
| `cantonctl dev` | Start local Canton sandbox with hot-reload | **Implemented** — 3 E2E tests |
| `cantonctl build` | Compile Daml to .dar, extract package IDs, generate TypeScript bindings | Framework ready |
| `cantonctl test` | Run Daml Script tests with structured output | Framework ready |
| `cantonctl deploy [network]` | Deploy .dar to devnet/testnet/mainnet with guided auth flow | Framework ready |
| `cantonctl console` | Interactive REPL connected to local or remote Canton node | Framework ready |
| `cantonctl status` | Show node health, deployed packages, active parties | Framework ready |

**Project Templates (5 implemented, all E2E-tested with real Daml SDK):**

| Template | Target | What's Generated | E2E Verified |
|----------|--------|------------------|--------------|
| `basic` | First-time Canton dev | Hello contract + UpdateMessage + Daml Script test | `daml build` + `daml test` pass |
| `token` | DeFi builder | Token (Mint/Transfer/Burn) + 4 tests + React frontend scaffold | `daml build` + `daml test` pass |
| `defi-amm` | AMM development | LiquidityPool (AddLiquidity/Swap, constant-product) + 2 tests | `daml build` + `daml test` pass |
| `api-service` | Backend developer | Record CRUD contract + Express.js server + Ledger API endpoints | `daml build` + `daml test` pass |
| `zenith-evm` | EVM developer | EvmBridgeRecord + Solidity ERC-20 + Hardhat config | `daml build` + `daml test` pass |

Community templates supported via `cantonctl init --from <github-url>` with git clone + `cantonctl-template.yaml` manifest validation.

**Foundation Libraries (9 modules, 99.89% statement coverage):**

| Module | Purpose | Coverage |
|--------|---------|----------|
| `config.ts` | Hierarchical config: project > user > env > flags. Zod-validated YAML. | 98% |
| `errors.ts` | 21 error codes (E1xxx–E8xxx) with suggestions and docs URLs | 100% |
| `output.ts` | Human/JSON/quiet output modes, spinners, tables. Respects NO_COLOR. | 97% |
| `process-runner.ts` | Subprocess abstraction over execa. Injectable mock for tests. | Mock-tested |
| `daml.ts` | DamlSdk: detect, build, test, codegen, startSandbox. AbortSignal support. | 95% |
| `ledger-client.ts` | HTTP client for Canton JSON Ledger API V2 (6 endpoints) | 100% |
| `jwt.ts` | HS256 JWT generation for sandbox auth (well-known secret) | 100% |
| `scaffold.ts` | Pure scaffolding logic, 5 templates, community template support | 100% |
| `dev-server.ts` | Dev server orchestration: sandbox + health + parties + hot-reload | 94% |

**Local Dev Environment (`cantonctl dev` — fully implemented):**

The dev server runs a complete local development environment without Docker:

1. **SDK detection** — finds `dpm` (preferred) or `daml` on PATH
2. **Port check** — verifies ports are free before starting (E3002 if occupied)
3. **Sandbox startup** — spawns Canton sandbox as subprocess
4. **Health polling** — retries with backoff until JSON Ledger API responds
5. **JWT generation** — creates HS256 token for sandbox authentication
6. **Party provisioning** — allocates parties from `cantonctl.yaml` (idempotent)
7. **DAR upload** — uploads compiled .dar to running sandbox
8. **Hot-reload** — chokidar watches `daml/` for `.daml` changes, debounced (300ms), concurrent rebuild protection via build queue
9. **Graceful shutdown** — `Ctrl+C` or `q` key, AbortSignal propagation to all components

Real-world bugs discovered and fixed during E2E testing against Canton sandbox:

| Bug | Discovery | Fix |
|-----|-----------|-----|
| `POST /v2/parties/allocate` doesn't exist in Canton V2 API | E2E: 405 Method Not Allowed | Changed to `POST /v2/parties` with `{partyIdHint, displayName}` |
| Canton sandbox doesn't support explicit party allocation | E2E: "PARTY_ALLOCATION_WITHOUT_CONNECTED_SYNCHRONIZER" | Dev server handles gracefully; parties auto-allocate on first use |
| `daml build` output goes to stderr, not stdout | E2E: stdout assertion empty | Changed to verify `.dar` file exists on disk |

### 3. Architectural Alignment

- **Builds on existing tools:** Uses `dpm` for package management, wraps the Canton sandbox, interfaces with JSON Ledger API V2 (`/v2/dars`, `/v2/commands/submit-and-wait`, `/v2/state/active-contracts`, `/v2/parties`)
- **Aligns with CIP-0082/CIP-0100:** Directly serves the Development Fund's mission to strengthen developer tooling and ecosystem growth
- **Supports the DeFi pivot:** Templates and ergonomics specifically target DeFi builders transitioning from EVM ecosystems
- **Open-source, community-extensible:** oclif plugin system allows npm-based extensions; template system supports `--from <github-url>` for community templates; MIT-licensed
- **Zenith-aware:** Includes `zenith-evm` template with Solidity ERC-20, Hardhat config, and Canton bridge contract

### 4. Backward Compatibility

*No backward compatibility impact.* cantonctl is a new tool. Projects generated by cantonctl produce standard .dar artifacts and use standard Ledger API / JSON API interfaces. Developers can eject from cantonctl at any time and use raw `dpm` / Canton tools directly.

---

## Design Evidence

All design decisions are justified by primary research (included in the [repository](https://github.com/merged-one/cantonctl)):

| Research | Scope | Key Finding |
|----------|-------|-------------|
| [16 Blockchain CLI Toolchains](https://github.com/merged-one/cantonctl/blob/main/docs/research/blockchain-cli-toolchain-research.md) | Hardhat, Foundry, Anchor, Sui, Ignite, NEAR, Starknet Foundry, Aztec, +8 more | Speed wins markets; plugin systems are competitive moats; only 3/16 have plugins |
| [Canton Ecosystem Deep Dive](https://github.com/merged-one/cantonctl/blob/main/docs/research/CANTON_ECOSYSTEM_RESEARCH.md) | Architecture, SDK, cn-quickstart, all existing tools, pain points | The #2 most-requested tool in the survey is exactly a "Unified CLI framework" |
| [7 AI Documentation Platforms](https://github.com/merged-one/cantonctl/blob/main/docs/research/AGENTIC_DOCS_RESEARCH.md) | Mintlify, Swimm, GitBook, ReadMe, Fern, Copilot, Cursor | MCP + llms.txt + executable doc tests represent the documentation frontier |
| [10 Design Decisions](https://github.com/merged-one/cantonctl/blob/main/docs/DESIGN_DECISIONS.md) | Framework, plugins, config, local dev, testing, distribution | Each decision backed by competitive analysis and survey data |

---

## Documentation System

cantonctl includes an [agentic documentation architecture](https://github.com/merged-one/cantonctl/blob/main/docs/AGENTIC_DOCS_SYSTEM.md) designed for critical financial infrastructure. Layer 1 is implemented:

| Type | Files | Purpose |
|------|-------|---------|
| Reference | `docs/reference/init.md`, `docs/reference/dev.md` | Full command docs with args, flags, examples, error codes, JSON schemas |
| Reference | `docs/reference/cantonctl-schema.json` | JSON Schema for cantonctl.yaml (IDE autocomplete) |
| Troubleshooting | `docs/troubleshooting/errors.md` | All 21 error codes with symptoms and resolution steps |
| Concepts | `docs/concepts/canton-for-evm-developers.md` | EVM-to-Canton mapping (msg.sender→Party, Hardhat→cantonctl) |
| Concepts | `docs/concepts/configuration.md` | Hierarchical config system, merge behavior, env vars |
| Tasks | `docs/tasks/create-token-project.md` | End-to-end tutorial with `<!-- doctest:begin -->` executable blocks |
| Tasks | `docs/tasks/local-development.md` | Dev environment setup tutorial with doctest blocks |
| Machine | `llms.txt` | AI-discoverable summary for LLM tooling (MCP, Claude, Cursor) |

---

## Milestones and Deliverables

### Milestone 1: Core CLI + Local Dev Environment
- **Estimated Delivery:** T+6 weeks
- **Focus:** Ship `init`, `dev`, `build`, and `test` commands with all 5 templates

**Progress (as of 2026-03-31):**

| Deliverable | Status |
|-------------|--------|
| `cantonctl init` scaffolds working projects from 5 templates | **Done** — 54 E2E tests |
| `cantonctl dev` starts local sandbox with hot-reload | **Done** — 3 E2E tests |
| 9 foundation libraries | **Done** — 99.89% coverage |
| Layer 1 documentation (8 files, 4 content types + llms.txt) | **Done** |
| 218 total tests (161 unit + 57 E2E) | **Done** |
| `cantonctl build` compiles Daml + generates TypeScript bindings | Framework ready |
| `cantonctl test` runs tests with structured pass/fail output | Framework ready |
| All commands support `--json` flag | In progress (init, dev done) |
| All errors include codes with troubleshooting links | **Done** — 21 codes |
| Published npm package | Pending |

### Milestone 2: Deploy Pipeline + Console + Community Templates
- **Estimated Delivery:** T+12 weeks
- **Focus:** Ship `deploy`, `console`, and `status` commands; guided auth flow
- **Deliverables:**
  - `cantonctl deploy` with 6-step pipeline (validate→build→auth→preflight→upload→verify)
  - `cantonctl console` — interactive REPL with tab completion
  - `cantonctl status` — node health, parties, and packages
  - JWT auth helper for remote network deployment
  - End-to-end integration tests for all commands
  - Video walkthrough of full DeFi dApp development cycle

### Milestone 3: Plugin System, Advanced Docs, Ecosystem Integration
- **Estimated Delivery:** T+16 weeks
- **Focus:** Plugin architecture, agentic documentation Layers 2-5, community growth
- **Deliverables:**
  - Plugin system (`@cantonctl/plugin-*` npm packages)
  - Agentic docs Layers 2-5: CI quality gates, autonomous agents, MCP server
  - GitHub Actions / CI recipe for Canton projects
  - Homebrew tap and standalone binary distribution
  - 3+ community-contributed templates or plugins
  - Developer satisfaction survey (target: >70% would recommend)

---

## Acceptance Criteria

- **Time-to-first-transaction:** Under 5 minutes from `npm install -g cantonctl` to executing a transaction on a local node
- **Template quality:** All 5 templates compile and pass tests with current Daml SDK
- **Test coverage:** 80%+ statement coverage
- **CI/automation:** Every command produces valid JSON with `--json`
- **Documentation:** Every command has reference docs, every error code has a troubleshooting entry
- **Ecosystem compatibility:** Generated projects work with current Canton devnet/testnet

---

## Funding

**Total Funding Request:** <!-- XX CC -->

### Payment Breakdown by Milestone
- Milestone 1 (Core CLI + Local Dev): XX CC upon committee acceptance
- Milestone 2 (Deploy + Console + Community): XX CC upon committee acceptance
- Milestone 3 (Plugins + Docs + Ecosystem): XX CC upon final release and acceptance

### Volatility Stipulation
Project duration is estimated at 16 weeks (under 6 months). Should the project timeline extend beyond 6 months due to Committee-requested scope changes, any remaining milestones must be renegotiated to account for significant USD/CC price volatility.

---

## Co-Marketing

Upon release, the implementing entity will collaborate with the Foundation on:
- Launch announcement across Canton social channels
- "Getting Started with cantonctl" technical blog post
- Video tutorial series (3 videos: quickstart, DeFi template, deployment)
- Presentation at next Canton community call
- Integration into official Canton documentation as recommended dev path

---

## Motivation

The Q1 2026 Developer Experience Survey made it clear: **environment setup is the biggest barrier to Canton adoption.** 41% of developers cited it as the task that took longest to get right, and "Local Development Frameworks" was rated as the single most critical tooling gap.

Canton is competing for mindshare with ecosystems that offer `npx create-eth-app`, `forge init`, and `anchor init`. The 71% of Canton developers coming from EVM backgrounds expect this level of tooling. Without it, Canton risks losing builders at the first hurdle — before they ever write a line of Daml.

cantonctl directly converts the survey's top pain point into a solved problem, reducing time-to-productivity from days to minutes and making Canton the easiest institutional DeFi chain to build on.

---

## Rationale

**Why a CLI (not a browser IDE, not extending cn-quickstart)?**

Our [research across 16 blockchain CLI toolchains](https://github.com/merged-one/cantonctl/blob/main/docs/research/blockchain-cli-toolchain-research.md) established clear patterns:

- **CLI-first matches the DeFi dev workflow.** Hardhat, Foundry, and Anchor prove that professional DeFi developers prefer local CLI tooling over browser IDEs. Among the 16 toolchains analyzed, the 5 most successful are all CLI-first.
- **cn-quickstart is infrastructure, not DX.** It requires Docker (8GB+ RAM), Nix, Gradle, JDK 21. cantonctl solves "how do I build a Daml app" without Docker.
- **oclif/TypeScript over Go/Cobra.** Only 3/16 toolchains have plugin systems. Hardhat's plugin ecosystem is its primary competitive moat. Canton's community needs extensibility without forking.
- **Templates accelerate the DeFi pivot.** Our 5 templates include real Daml contracts with working test suites, all verified against the Daml SDK via E2E tests.

**Alternatives considered:**
- *Extending DPM* — Package manager, not a dev framework. Single responsibility.
- *Go/Cobra CLI* — Faster startup but no plugin system.
- *VS Code Extension* — Editor-specific.
- *Browser-based IDE* — Lower priority per survey.
