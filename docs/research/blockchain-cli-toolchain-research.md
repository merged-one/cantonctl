# Blockchain / Smart Contract CLI Toolchain Research

Comprehensive analysis of every major blockchain CLI development toolchain, covering architecture, command structure, plugin systems, local dev environments, testing, scaffolding, developer sentiment, and documentation approaches.

---

## TABLE OF CONTENTS

1. [EVM Ecosystem](#evm-ecosystem)
   - [Hardhat](#1-hardhat)
   - [Foundry/Forge](#2-foundryforge)
   - [Truffle (Sunset)](#3-truffle-sunset)
   - [Brownie (Declining)](#4-brownie-declining)
   - [Remix IDE](#5-remix-ide)
2. [Solana Ecosystem](#solana-ecosystem)
   - [Anchor](#6-anchor)
   - [Seahorse](#7-seahorse)
3. [Move Ecosystems](#move-ecosystems)
   - [Aptos CLI](#8-aptos-cli)
   - [Sui CLI](#9-sui-cli)
4. [Cosmos Ecosystem](#cosmos-ecosystem)
   - [Ignite CLI](#10-ignite-cli)
5. [Substrate / Polkadot](#substratepolkadot)
   - [cargo-contract](#11-cargo-contract)
   - [Pop CLI](#12-pop-cli)
6. [Other Ecosystems](#other-ecosystems)
   - [NEAR CLI](#13-near-cli)
   - [Tezos / LIGO](#14-tezos--ligo)
   - [Starknet Foundry](#15-starknet-foundry)
   - [Aztec CLI](#16-aztec-cli)
7. [Cross-Cutting Analysis](#cross-cutting-analysis)
8. [Design Recommendations for a New CLI](#design-recommendations-for-a-new-cli)

---

## EVM ECOSYSTEM

### 1. HARDHAT

**Status:** Active, market leader for EVM development. Hardhat 3 released 2025 with major Rust rewrite.

#### Installation & Runtime
- **Runtime:** Node.js v22+ (Hardhat 3), npm/pnpm/yarn
- **Install:** `npm init` then `npm install --save-dev hardhat`, init with `npx hardhat --init`
- **Config file:** `hardhat.config.js` or `hardhat.config.ts` (TypeScript first-class)
- **Recommendation:** pnpm strongly recommended for Hardhat 3

#### Core Command Set
| Command | Purpose |
|---------|---------|
| `npx hardhat compile` | Compile Solidity contracts |
| `npx hardhat test` | Run test suite (Mocha + Chai or Solidity tests in v3) |
| `npx hardhat node` | Start local Hardhat Network node |
| `npx hardhat ignition deploy` | Deploy via Hardhat Ignition |
| `npx hardhat console` | Interactive JS/TS console with HRE |
| `npx hardhat clean` | Clear cache and artifacts |
| `npx hardhat verify` | Verify contracts on Etherscan |

#### Plugin / Extension Architecture
Hardhat's plugin system is its defining architectural feature:

- **Hardhat Runtime Environment (HRE):** Central coordination object. During init, the config file builds a list of tasks, configs, and plugins to inject into the HRE. When tasks/tests/scripts run, the HRE is always present.
- **`extendEnvironment()`:** Plugins call this to inject functionality. Callbacks execute in order after HRE init. Example: `hardhat-ethers` adds an Ethers.js instance to the HRE.
- **`extendProvider()`:** Extends the EIP-1193 provider with middleware.
- **Task System:** Tasks are async JS functions with access to HRE. Defined with `task(name, description, action)`. Tasks can be overridden with `runSuper` to call the original. Subtasks and scoped tasks allow grouping.
- **Global scope injection:** Before running tasks/tests/scripts, HRE fields become global variables; restored afterward.
- **Hundreds of community plugins:** gas reporting, Etherscan verification, TypeScript support, deployment tools, etc.

#### Local Dev Environment
- **Hardhat Network (EDR):** In-process simulated Ethereum blockchain rewritten in Rust for Hardhat 3. Supports mainnet forking, OP Stack simulation, L1 mode.
- **Two modes:** In-memory (automatic, spun up per task) or standalone (`npx hardhat node` for external clients like wallets/frontends).
- **Forking:** Configure `fork.url` and optional `fork.blockNumber` to fork any EVM chain.
- **Performance:** 2-10x speed improvement over Hardhat v2 thanks to EDR (Rust).

#### Testing Framework
- **JS/TS tests:** Mocha + Chai with ethers.js or viem integration
- **Solidity tests (v3):** First-class Solidity test support, can mix with JS/TS tests
- **Stack traces:** Detailed Solidity stack traces and console.log support in contracts
- **Coverage:** Via `solidity-coverage` plugin

#### Code Generation / Scaffolding
- `npx hardhat --init` creates project with sample contract, test, and config
- Template options: JavaScript, TypeScript, or empty config
- Hardhat Ignition provides declarative deployment modules
- No opinionated scaffolding beyond initial project setup

#### What Developers Love
- Massive plugin ecosystem and community
- Excellent TypeScript support
- Detailed Solidity stack traces and error messages
- HRE makes everything composable
- Hardhat Network is extremely capable (forking, mining modes, etc.)
- Strong documentation
- Hardhat 3's Rust-powered EDR is significantly faster

#### What Developers Complain About
- Slow compilation and test startup (pre-v3, being addressed)
- Silent compilation failures
- Optimizer config confusion
- Platform-specific build issues (ARM/Linux)
- Node.js dependency management complexity
- Plugin compatibility issues across versions
- JavaScript/TypeScript requirement (some want Solidity-only like Foundry)

#### Documentation Approach
- Comprehensive official docs at hardhat.org
- Tutorial-driven getting started guide
- Reference docs for config, HRE, tasks, plugins
- Active community on Discord and GitHub

---

### 2. FOUNDRY / FORGE

**Status:** Active, rapidly growing, dominant for security-focused and performance-critical EVM work.

#### Installation & Runtime
- **Runtime:** Rust-based native binaries, no Node.js required
- **Install:** `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Config file:** `foundry.toml`
- **Updates:** Run `foundryup` anytime for latest stable release
- **Storage:** Files in `~/.foundry`

#### Core Command Set (4 Tools)

**Forge (Build/Test/Deploy):**
| Command | Purpose |
|---------|---------|
| `forge init` | Create new project |
| `forge build` | Compile contracts |
| `forge test` | Run tests (unit, fuzz, invariant) |
| `forge test -vvvv` | Verbose test with traces |
| `forge script` | Run Solidity deployment scripts |
| `forge create` | Deploy a single contract |
| `forge coverage` | Generate coverage report |
| `forge snapshot` | Gas snapshot for benchmarking |
| `forge install` | Install dependencies (git submodules) |
| `forge verify-contract` | Verify on block explorer |

**Cast (Chain Interaction):**
| Command | Purpose |
|---------|---------|
| `cast call` | Read from contract |
| `cast send` | Send transaction |
| `cast balance` | Get ETH balance |
| `cast block-number` | Current block number |
| `cast wallet sign` | Sign messages |
| `cast abi-encode` | ABI encode data |

**Anvil (Local Node):**
- `anvil` starts local node with test accounts (10,000 ETH each)
- `anvil --fork-url <RPC>` forks a live network

**Chisel (REPL):**
- Interactive Solidity REPL for quick experiments

#### Plugin / Extension Architecture
- **No formal plugin system.** Foundry is monolithic by design.
- Extensions come via: Solidity libraries (forge-std), community templates, and third-party tools
- **Soldeer:** Community-built alternative package manager now integrated (`forge soldeer`)
- Extensibility through `foundry.toml` configuration and remappings

#### Local Dev Environment
- **Anvil:** Fast local Ethereum node, Ganache replacement
- Mainnet forking with `--fork-url`
- Configurable block time, chain ID, accounts
- Supports impersonating accounts

#### Testing Framework
- **Solidity-native tests.** Tests written in Solidity, not JS/TS.
- **Cheatcodes:** `vm.warp()` (timestamp), `vm.roll()` (block), `vm.prank()` (impersonate), `vm.deal()` (set balance), `vm.store()` (set storage), etc.
- **Fuzz testing:** Any test function with parameters becomes a fuzz test automatically. Default 256 runs, configurable.
- **Invariant testing:** Stateful fuzz tests with `invariant_` prefix. Forge generates random transaction sequences to try breaking protocol-wide properties.
- **Fork testing:** `vm.createFork()` / `vm.selectFork()` for multi-chain fork testing
- **Gas snapshots:** Built-in gas reporting and snapshot comparison

#### Code Generation / Scaffolding
- `forge init` creates minimal project structure (src/, test/, script/, lib/)
- No opinionated scaffolding beyond basic structure
- Community templates (e.g., PaulRBerg/foundry-template)

#### What Developers Love
- **Blazing fast:** Rust-compiled, parallelized compilation and testing
- **Solidity-native:** Write everything in Solidity, no JS/TS context switching
- **Cheatcodes:** Extremely powerful testing primitives
- **Fuzz + invariant testing:** Built-in, no extra setup
- **Minimal dependencies:** No Node.js, no npm
- **Gas reporting:** Precise and built-in

#### What Developers Complain About
- **Deployment scripts limited:** No artifact management like hardhat-deploy, library linking issues
- **No TypeScript/JS flexibility:** Can't use off-chain logic in deployment scripts
- **Git submodules:** Fragile, don't scale, path issues. Led to Soldeer alternative.
- **Debugging UX:** Less polished error messages than Hardhat
- **No plugin system:** Hard to extend without forking
- **Learning curve for cheatcodes:** Large API surface to learn

#### Documentation Approach
- The Foundry Book (book.getfoundry.sh) - comprehensive reference
- GitHub README and examples
- Community-driven tutorials and cheat sheets
- Less structured than Hardhat docs but improving

---

### 3. TRUFFLE (SUNSET)

**Status:** Discontinued early 2024 by ConsenSys. No longer maintained.

#### What It Was
- First major Ethereum development framework
- Part of Truffle Suite: Truffle (framework), Ganache (local chain), Drizzle (frontend lib)
- JavaScript-based with migrations system for deployments
- Set industry standards for testing and contract management

#### Why It Declined
1. **Ecosystem evolution outpaced it:** Newer frameworks (Hardhat, Foundry) offered more advanced capabilities
2. **Slow to innovate:** Plugin system was less flexible than Hardhat's HRE
3. **Performance:** JavaScript-based, slower than Foundry
4. **ConsenSys resource allocation:** Parent company shifted priorities
5. **Migration system was rigid:** Less flexible than script-based approaches
6. **Community momentum shifted:** Tutorials, hiring, and integrations moved to Hardhat/Foundry

#### Lessons Learned
- **Pioneering tools shape ecosystems even after sunset:** Truffle's patterns (migrations, testing, project structure) live on in successors
- **Standards matter:** Automated testing and migration patterns became industry norms
- **Incumbency doesn't protect against faster tools:** Performance and DX innovation wins
- **Community migration support is critical:** Truffle provided migration guides, preserving goodwill
- **Monolithic design limits adaptation:** Hardhat's composable HRE/plugin system was more adaptable

---

### 4. BROWNIE (DECLINING)

**Status:** No longer actively maintained. Community directed to Ape Framework.

#### What It Was
- Python-based smart contract development framework
- Built on web3.py, targeting Python developers
- Provided: console, testing (pytest), deployment scripts, network management

#### Why It Lost
1. **Foundry's speed advantage:** Rust-based Foundry is orders of magnitude faster
2. **Ecosystem momentum:** Tutorials, integrations, hiring shifted to Foundry/Hardhat
3. **Maintenance stopped:** No active development
4. **Niche audience:** Python devs in smart contracts are a minority
5. **Ape Framework emerged:** Spiritual successor with active development, backed by Vyper/Curve teams

#### Where It Still Has Value
- Python shops already invested in Brownie
- Data science teams working close to on-chain logic
- DeFi scripting and automation pipelines

---

### 5. REMIX IDE

**Status:** Active, maintained by Remix Project. 12M+ contracts deployed through it.

#### Why CLIs Won for Production
1. **Browser-based limitations:** Files in localStorage can be lost, no git integration, dependent on internet
2. **No CI/CD integration:** Can't run Remix in pipelines
3. **Performance degrades:** Large projects slow down
4. **No automation:** Manual deployment, no scripting
5. **No plugin/extension ecosystem** comparable to Hardhat's

#### Where Remix Excels
- Zero-setup learning environment
- Instant prototyping and experimentation
- Education and hackathons
- Quick debugging with built-in JavaScript VM

#### The Multi-Tool Reality (2025)
Most developers use Remix for quick experiments, VS Code + Hardhat/Foundry for development, and CLI tools for deployment/testing. The progression: Remix (learn) -> Hardhat (build) -> Foundry (optimize/audit).

---

## SOLANA ECOSYSTEM

### 6. ANCHOR

**Status:** Active, dominant Solana development framework. Maintained by Solana Foundation. 4,500+ GitHub stars.

#### Installation & Runtime
- **Prerequisites:** Rust, Solana CLI, Node.js (for client generation)
- **Install:** `cargo install --git https://github.com/coral-xyz/anchor anchor-cli`
- **Config file:** `Anchor.toml` (project config), `Cargo.toml` (Rust workspace)
- **Also installs:** Solana CLI tools, SPL token CLI

#### Core Command Set
| Command | Purpose |
|---------|---------|
| `anchor init <name>` | Scaffold new project (--template single/multiple) |
| `anchor build` | Compile programs, generate IDL |
| `anchor test` | Build, deploy to localnet, run tests |
| `anchor deploy` | Deploy to configured network |
| `anchor idl` | Manage on-chain IDL |
| `anchor keys list` | List program keypairs |
| `anchor new <name>` | Add new program to workspace |
| `anchor shell` | Interactive shell |
| `anchor migrate` | Run migration scripts |
| `anchor upgrade` | Upgrade deployed program |

#### Plugin / Extension Architecture
- **No formal plugin system.** Anchor is a framework, not a plugin platform.
- Extensions through: Rust crates, custom macros, IDL-generated clients
- TypeScript client package auto-generated from IDL
- Anchor.toml supports workspace-level configuration

#### Local Dev Environment
- Relies on **Solana CLI's `solana-test-validator`** for local development
- `anchor test` automatically starts/stops a local validator
- Configurable networks in Anchor.toml (localnet, devnet, mainnet-beta)

#### Testing Framework
- **TypeScript tests** using Mocha + @coral-xyz/anchor client
- Tests interact with programs through auto-generated TypeScript bindings from IDL
- Bankrun (lightweight test environment) gaining adoption for faster tests
- No built-in fuzz testing (community tools like Trident fill this gap)

#### Code Generation / Scaffolding
- **IDL generation** is the killer feature: `anchor build` generates JSON IDL from Rust program annotations
- IDL enables: TypeScript client auto-generation, on-chain IDL storage, cross-language interop
- `anchor init` scaffolds workspace with programs/, tests/, app/ directories
- Modular template (recommended) vs single-file template

#### What Developers Love
- Dramatically reduces Solana boilerplate (serialization, deserialization, account validation)
- IDL generation + TypeScript client auto-generation
- Strong security defaults (account ownership checks, signer validation)
- Active community and Solana Foundation backing
- Workspace concept for multi-program projects

#### What Developers Complain About
- **Cryptic macro errors:** When Anchor macros fail, errors are hard to debug
- **APIs in flux:** Breaking changes across versions (notably 0.30.0 IDL format change)
- **Steep learning curve:** PDA derivation, account constraints, Solana's programming model
- **CI/CD gaps:** No official CI templates
- **Missing error explainers:** Error codes not human-friendly
- **Version compatibility:** Must match Anchor version to Solana CLI version

#### Documentation Approach
- Official docs at anchor-lang.com
- Solana Foundation developer courses
- Community tutorials on Medium, YouTube
- The Anchor Book (community-maintained)

---

### 7. SEAHORSE

**Status:** Beta, not production-ready. Community project under Solana Developers org.

#### Installation & Runtime
- **Prerequisites:** Rust, Solana CLI, Anchor CLI, Python 3
- **Install:** `pip install seahorse-lang` (after all prerequisites)
- **Compiler:** Python -> Rust transpilation -> Anchor compilation

#### Architecture
- Parses Python source into AST (via rustpython)
- Transpiles to Anchor-compatible Rust code
- Outputs standard Anchor artifacts (including IDL)
- Seahorse Framework models closely mirror Anchor Framework

#### Core Commands
- Leverages Anchor CLI commands after transpilation
- `seahorse compile` to generate Rust from Python
- Then standard `anchor build`, `anchor test`, `anchor deploy`

#### What Developers Love
- Python accessibility for non-Rust developers
- Still produces Anchor-compatible, auditable output
- Good for hackathons and prototyping

#### What Developers Complain About
- Beta quality, many features unimplemented
- Not production-ready
- Double dependency chain (Python + Rust + Solana + Anchor)
- Limited community and documentation

---

## MOVE ECOSYSTEMS

### 8. APTOS CLI

**Status:** Active, maintained by Aptos Labs.

#### Installation & Runtime
- **Install:** Pre-built binaries for macOS/Linux/Windows, or `brew install aptos`
- **Runtime:** Standalone binary (Rust-compiled)
- **Config:** Profile-based configuration (`aptos init` creates `.aptos/config.yaml`)

#### Core Command Set
| Command | Purpose |
|---------|---------|
| `aptos move compile` | Compile Move packages |
| `aptos move test` | Run Move unit tests |
| `aptos move publish` | Publish package to chain |
| `aptos move prove` | Run Move Prover (formal verification) |
| `aptos move init` | Initialize new Move package |
| `aptos move coverage` | Generate test coverage |
| `aptos move document` | Generate documentation |
| `aptos node run-local-testnet` | Start local testnet with faucet |
| `aptos init` | Initialize CLI profile/config |
| `aptos account create` | Create on-chain account |
| `aptos account fund-with-faucet` | Fund account on testnet |

#### Plugin / Extension Architecture
- **No plugin system.** Monolithic CLI.
- Extensibility through Move packages and module system
- Named addresses configurable at compile time

#### Local Dev Environment
- `aptos node run-local-testnet --with-faucet` starts full local testnet
- Includes REST API (port 8080) and faucet (port 8081)
- Profile system (`aptos init --profile local`) for multi-network config

#### Testing Framework
- Move's built-in test framework with `#[test]` annotations
- `aptos move test` runs Move unit tests
- **Move Prover:** Formal verification tool for mathematical correctness proofs
- Coverage reporting with `aptos move coverage`

#### Code Generation / Scaffolding
- `aptos move init` creates Move.toml and basic package structure
- No opinionated project scaffolding beyond package initialization
- Named addresses allow parameterized deployments

#### Key Compile Options
- `--save-metadata`: Save package metadata for publishing
- `--compiler-version v1|v2`: Select compiler version
- `--included-artifacts none|sparse|all`: Control artifact size (impacts gas cost)
- `--skip-fetch-latest-git-deps`: Offline compilation

#### What Developers Love
- Formal verification via Move Prover (unique advantage)
- Clean Move language design with resource safety
- Integrated local testnet
- Profile-based multi-network management

#### What Developers Complain About
- Smaller ecosystem and community compared to EVM
- Documentation gaps
- Move learning curve
- Fewer third-party tools and integrations

---

### 9. SUI CLI

**Status:** Active, maintained by Mysten Labs. One of the fastest-growing ecosystems (159% dev growth).

#### Installation & Runtime
- **Install:** Via `suiup` version manager (recommended), or `cargo install sui`
- **Runtime:** Rust-compiled binary
- **Config:** `Move.toml` (package), `Move.lock` (dependencies), network config via `sui client`

#### Core Command Set
| Command | Purpose |
|---------|---------|
| `sui move build` | Build Move packages |
| `sui move test` | Run Move unit tests |
| `sui client publish` | Publish package to network |
| `sui client call` | Call Move functions |
| `sui client object` | Inspect objects |
| `sui client gas` | Check gas coins |
| `sui start` | Start local network |
| `sui keytool` | Key management |
| `sui validator` | Validator management |

#### Architecture
- Hierarchical command structure defined by `SuiCommand` enum (clap-based)
- `BuildConfig` wraps Move compiler's `MoveBuildConfig` with Sui-specific settings
- Object-centric model (unique to Sui) reflected in CLI commands

#### Plugin / Extension Architecture
- **No plugin system.** Monolithic CLI.
- Extensibility through Move packages
- `Published.toml` tracks publication metadata per environment

#### Local Dev Environment
- `sui start` launches local Sui network
- `BuildConfig::new_for_testing()` for test configurations
- `test-publish` command allows cross-environment testing (build for testnet, publish to localnet)

#### Testing Framework
- Move's `#[test]` annotation system
- `sui move test` with filter strings for targeted testing
- Tracing feature for coverage and debugging
- `TreeShakingTest` utilities for package publishing/upgrade testing

#### Package Management
- `Move.toml` for package config and dependencies
- `Move.lock` tracks dependency versions per environment (mainnet, testnet, localnet)
- `ManagedPackage` structure for multi-environment metadata
- **Package upgrades:** UpgradeCap object maintains version chain with compatibility checking

#### What Developers Love
- Object-centric programming model (novel and powerful)
- Built-in package upgrade system with compatibility checking
- Multi-environment lock file management
- Fast-growing community and ecosystem (159% growth)

#### What Developers Complain About
- Object model learning curve
- Smaller tooling ecosystem than EVM
- Rapid changes and breaking updates
- Documentation sometimes lags behind releases

---

## COSMOS ECOSYSTEM

### 10. IGNITE CLI

**Status:** Active but with significant issues. Formerly "Starport."

#### Installation & Runtime
- **Install:** `curl https://get.ignite.com/cli! | bash` or from source
- **Runtime:** Go-based binary
- **Config:** Auto-generated Go project with Cosmos SDK structure

#### Core Command Set
| Command | Purpose |
|---------|---------|
| `ignite scaffold chain <name>` | Scaffold entire blockchain |
| `ignite scaffold module <name>` | Add a new module |
| `ignite scaffold message <name>` | Create a message type |
| `ignite scaffold query <name>` | Create a query |
| `ignite scaffold type <name>` | Create a type |
| `ignite scaffold list/map/single` | CRUD operations |
| `ignite chain serve` | Build + start with hot reload |
| `ignite chain build` | Build the blockchain binary |
| `ignite generate` | Generate clients, API docs |
| `ignite relayer` | IBC relayer management |
| `ignite account` | Account management |

#### Plugin / Extension Architecture
- **Ignite Apps:** Plugin marketplace for extending functionality
- Apps include: EVM support, GnoVM support, Proof of Authority module
- Marketplace at ignite.com for discovering apps
- Plugins can add scaffolding templates, deployment tools, and more

#### Local Dev Environment
- `ignite chain serve` starts blockchain with **hot reloading**
- Auto-generates genesis file, validator keys, peer config
- CometBFT (Tendermint) consensus engine included
- Chain simulation for testing (`ignite chain simulate`)

#### Scaffolding (Unique Strength)
This is Ignite's defining feature:
- Scaffolds **entire blockchains**, not just contracts
- Module scaffolding with dependencies (`--dep auth,bank`)
- CRUD scaffolding (list, map, single) auto-generates: proto files, keeper methods, CLI commands, REST endpoints, genesis state
- IBC packet scaffolding for cross-chain communication
- Each scaffold generates proto files, Go code, and client code

#### What Developers Love
- **Fastest way to bootstrap a Cosmos chain** (minutes, not days)
- Hot reloading during development
- Comprehensive scaffolding covers full stack
- IBC integration built-in
- Good initial getting-started experience

#### What Developers Complain About
- **Broken frontend/ts-client generation:** Persistent issue in 2024-2025
- **Lags behind Cosmos SDK versions:** Uses outdated SDK/IBC versions
- **Tight version coupling:** Must match Ignite version to SDK version
- **Scaffolded code quality:** Generated code sometimes needs significant cleanup
- **Limited for production:** Many teams outgrow scaffolding quickly

#### Documentation Approach
- Official docs at docs.ignite.com
- Cosmos SDK tutorials portal integration
- Tutorial-driven learning
- Separate tutorials site (tutorials.ignite.com)

---

## SUBSTRATE / POLKADOT

### 11. CARGO-CONTRACT

**Status:** Active but undergoing maintenance transition. Issues/PRs locked on GitHub.

#### Installation & Runtime
- **Prerequisites:** Rust with `rust-src` component, C++17 compiler
- **Install:** `cargo install --force --locked cargo-contract`
- **Runtime:** Rust/Cargo ecosystem
- **Config:** Standard Cargo.toml with ink! dependencies

#### Core Command Set
| Command | Purpose |
|---------|---------|
| `cargo contract new <name>` | Create new ink! contract |
| `cargo contract build` | Build contract (generates .wasm + metadata) |
| `cargo contract test` | Run contract tests |
| `cargo contract upload` | Upload contract code |
| `cargo contract instantiate` | Deploy contract instance |
| `cargo contract call` | Call contract message |
| `cargo contract decode` | Decode contract data |
| `cargo contract verify` | Verify contract binary matches source |
| `cargo contract info` | Display on-chain contract info |
| `cargo contract storage` | Display contract storage |
| `cargo contract remove` | Remove contract from chain |

#### Plugin / Extension Architecture
- **No plugin system.** Cargo subcommand pattern.
- Integrates with Rust/Cargo ecosystem naturally
- ink! provides the smart contract eDSL as a Rust crate

#### Local Dev Environment
- Uses `substrate-contracts-node` for local testing
- Must install separately
- Connects to any pallet-contracts enabled chain

#### What Developers Love
- Rust ecosystem integration
- Contract verification built-in
- ink! provides familiar Rust patterns

#### What Developers Complain About
- Complex setup (Rust + C++ compiler + substrate node)
- Smaller community than EVM tools
- Maintenance transition causing uncertainty
- substrate-contracts-node must be installed separately

---

### 12. POP CLI

**Status:** Active, growing. Production-ready as of 2025 Milestone 4. Built by R0GUE with Web3 Foundation grant.

#### Installation & Runtime
- **Install:** `cargo install pop-cli --locked` (add `--features contract` for ink! support)
- **Runtime:** Rust/Cargo
- **Config:** Inherits from Substrate/Cumulus project structure

#### Core Command Set
| Command | Purpose |
|---------|---------|
| `pop new parachain` | Scaffold parachain from template |
| `pop new contract` | Scaffold ink! contract |
| `pop build` | Build with Polkadot-specific features |
| `pop up parachain` | Launch local network (via Zombienet) |
| `pop call chain` | Interact with Substrate chains |
| `pop call contract` | Interact with ink! contracts |
| `pop bench` | Benchmarking and try-runtime |
| `pop build spec` | Build chain spec |

#### Key Differentiators
- **Template marketplace:** Predefined templates for NFTs, DeFi, identity, smart contracts
- **Zombienet integration:** `pop up` automatically fetches binaries and spins up multi-chain networks
- **Polkadot Development Portal integration:** Deploy directly to PDP
- **PolkaVM support:** Experimental pallet_revive support
- **OpenZeppelin EVM template:** Audited parachain templates
- **300+ new installs/month** (March 2025)

#### What Developers Love
- All-in-one tool for Polkadot development
- Template-driven scaffolding
- Automatic binary management
- Good abstraction over complex Substrate stack

#### What Developers Complain About
- Relatively new, still maturing
- Smart contract support is opt-in, not default
- Learning Substrate/Polkadot itself remains complex

---

## OTHER ECOSYSTEMS

### 13. NEAR CLI

**Status:** Active. Two versions: near-cli (Node.js, legacy) and near-cli-rs (Rust, recommended).

#### Installation & Runtime
- **near-cli-rs (recommended):** Install via shell script or `cargo install near-cli-rs`
- **near-cli (legacy):** `npm install -g near-cli`
- **Config:** `config.toml` for network connections
- **Network selection:** `NEAR_NETWORK=testnet` env var or `--network` flag

#### Core Command Set (near-cli-rs)
| Command | Purpose |
|---------|---------|
| `near account` | Manage accounts (create, delete, view, keys) |
| `near tokens` | Manage NEAR, FT, NFT |
| `near staking` | View/manage staking |
| `near contract deploy` | Deploy .wasm contract |
| `near contract call-function as-transaction` | Call change method |
| `near contract call-function as-read-only` | Call view method |
| `near transaction` | Transaction operations |
| `near config` | Manage network connections |
| `near extension` | Manage CLI extensions |

#### Plugin / Extension Architecture
- **No formal plugin system**
- `near extension` command suggests extensibility is being explored
- Monolithic command structure
- Companion tool: `cargo-near` for building Rust contracts

#### Local Dev Environment
- Uses `nearcore` or `near-workspaces` for local testing
- `near-workspaces` (Rust and JS versions) provides sandboxed environments
- No built-in local node command in CLI itself

#### Interactive Mode
- Running `near` without arguments enters interactive menu
- Guided prompts for command selection
- Good for discovery but slower for experienced users

#### What Developers Love
- Interactive mode is beginner-friendly
- Supports multiple languages (Rust, JS, Python, Go for contracts)
- Clean separation of read vs write operations
- System keychain integration for key storage
- Active development (0.23.0 in Dec 2025)

#### What Developers Complain About
- Two CLI versions (Node.js vs Rust) causes confusion
- No built-in local node
- Key management complexity
- Smaller ecosystem than EVM/Solana

---

### 14. TEZOS / LIGO

**Status:** Active. LIGO is the primary high-level language; octez-client is the node CLI.

#### Installation & Runtime
- **LIGO:** Via Docker (`docker run ligolang/ligo`), npm, or native binary
- **octez-client:** Part of Tezos node distribution
- **Syntaxes:** CameLIGO (OCaml-inspired), JsLIGO (JavaScript-inspired)

#### Core Command Set
| Tool | Command | Purpose |
|------|---------|---------|
| LIGO | `ligo compile contract <file>` | Compile to Michelson |
| LIGO | `ligo compile storage <file> <expr>` | Compile initial storage |
| LIGO | `ligo run dry-run <file> <param> <storage>` | Simulate execution |
| LIGO | `ligo run test <file>` | Run LIGO tests |
| octez | `octez-client originate contract ...` | Deploy contract |
| octez | `octez-client transfer ... --arg ...` | Call contract |
| octez | `octez-client get contract storage for ...` | Read storage |

#### Ecosystem Tools
- **Taqueria:** Higher-level development toolkit with plugin system
  - `@taqueria/plugin-ligo`: Compile and test LIGO contracts
  - `taq create contract`: Scaffolding from templates
  - Plugin architecture for extensibility
- **LIGO registry:** Package system for reusable contract libraries
- **VSCode extension** for LIGO
- **Online IDE** at ide.ligolang.org

#### What Developers Love
- Multiple syntax options (OCaml or JS-like)
- Formal verification heritage from Tezos
- Dry-run simulation without deployment
- LIGO registry for package sharing

#### What Developers Complain About
- Small community compared to EVM/Solana
- Fragmented tooling (LIGO + octez-client + Taqueria)
- Tezos ecosystem shrinking
- Documentation scattered across multiple sites

---

### 15. STARKNET FOUNDRY

**Status:** Active, rapidly developing. Built by Software Mansion (ex-Protostar team). Written in Rust.

#### Installation & Runtime
- **Install (2025):** Single command: `curl --proto '=https' --tlsv1.2 -sSf https://sh.starkup.sh | sh`
- **`starkup` installs:** Cairo compiler (Scarb), Starknet Foundry (snforge + sncast)
- **Config:** `Scarb.toml` (package config), `snfoundry.toml` (network profiles)
- **Current version:** snforge 0.51.1

#### Core Command Set

**snforge (Testing):**
| Command | Purpose |
|---------|---------|
| `snforge test` | Run Cairo tests |
| `snforge test --ignored` | Run only ignored tests |
| `snforge test --include-ignored` | Run all tests |
| `snforge new <name>` | Create new project |
| `scarb test` | Runs snforge test (via Scarb.toml script config) |

**sncast (Chain Interaction):**
| Command | Purpose |
|---------|---------|
| `sncast declare` | Declare contract class |
| `sncast deploy` | Deploy contract |
| `sncast invoke` | Call contract function |
| `sncast call` | Read from contract |
| `sncast account create` | Create account |
| `sncast account deploy` | Deploy account |

#### Plugin / Extension Architecture
- **No formal plugin system**
- Integrates with Scarb (Cairo's package manager) as a plugin
- `snforge_std` as a trusted Scarb plugin (since 0.37.0)
- Oracles support for external data in tests (Scarb >= 2.13.1)

#### Testing Framework (Strong)
- **Unit tests:** In `src/` with `#[cfg(test)]`, use cheatcodes freely
- **Integration tests:** In `tests/` directory, verify cross-contract interactions
- **Fork tests:** Run against real blockchain state via RPC
- **Fuzz testing:** Configurable fuzzer runs and seed
- **Coverage:** Via `cairo-coverage` tool integration
- **Cairo-native execution:** Contracts can run on cairo-native instead of cairo-vm for speed

#### What Developers Love
- **Single-command install** (`starkup`) installs entire toolchain
- Fast Rust-based execution
- Familiar Foundry-like patterns for EVM developers transitioning
- Fork testing against mainnet/testnet
- Growing Starknet ecosystem (2,000+ developers)

#### What Developers Complain About
- Cairo language learning curve
- Rapidly changing APIs
- Smaller ecosystem than EVM tools
- Some features still experimental

---

### 16. AZTEC CLI

**Status:** Active, rapidly developing. Privacy-first L2 on Ethereum. Ignition Chain launched November 2025.

#### Installation & Runtime
- **Install:** `curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/aztec-up/aztec-up.sh | bash`
- **`aztec-up` installs:** aztec-nargo (Noir compiler), aztec CLI, aztec-postprocess-contract, aztec-wallet
- **Runtime:** Docker required for sandbox
- **Language:** Noir (Rust-like DSL for zero-knowledge circuits)
- **Framework:** Aztec.nr (smart contract library on top of Noir)
- **Config:** `Nargo.toml` (package metadata and dependencies)

#### Core Command Set
| Command | Purpose |
|---------|---------|
| `aztec start --sandbox` | Start local Aztec network (Docker) |
| `aztec-nargo compile` | Compile Noir contracts |
| `aztec deploy` | Deploy contract to network |
| `aztec-wallet create-account` | Create account (schnorr/ecdsa) |
| `aztec register-contract` | Register external contract with PXE |
| `aztec deploy-l1-contracts` | Deploy Ethereum bridge contracts |
| `aztec update` | Update toolchain and dependencies |
| `aztec codegen` | Generate TypeScript client from artifacts |

#### Architecture (Unique)
- **Client-side proving:** ZK proofs generated on user's device
- **Private + Public state:** Contracts mix private (encrypted UTXOs) and public (merkle tree) state
- **PXE (Private Execution Environment):** Runs locally, manages private state
- **Sandbox components:** Configurable — can start individual components (node, pxe, archiver, sequencer, prover, p2p-bootstrap)
- **Aztec.js:** Client library (similar to ethers.js) for dApp interaction

#### Local Dev Environment
- `aztec start --sandbox` runs full local network in Docker
- Pre-funded accounts for testing
- Similar to Ganache/Anvil but for Aztec's privacy-preserving VM
- Components can be started individually for advanced testing

#### What Developers Love
- **Privacy by default:** Unique capability no other toolchain offers
- Noir language is well-designed (Rust-like, expressive)
- Full local sandbox for testing
- Mix of private and public functions in same contract
- Growing ecosystem (185 operators, 3,400+ sequencers on Ignition Chain)

#### What Developers Complain About
- **Docker dependency** for sandbox adds complexity
- **Noir learning curve** (new language + ZK concepts)
- **Rapidly changing APIs** (frequent breaking changes)
- **Long compilation times** (ZK circuit compilation)
- **Heavy resource usage** (proving is computationally expensive)
- **Small but growing ecosystem**

---

## CROSS-CUTTING ANALYSIS

### Installation Patterns

| Tool | Method | Runtime | Complexity |
|------|--------|---------|------------|
| Hardhat | npm install | Node.js v22+ | Medium |
| Foundry | curl + foundryup | None (Rust binaries) | Low |
| Anchor | cargo install | Rust + Solana + Node.js | High |
| Aptos CLI | Binary download / brew | None | Low |
| Sui CLI | suiup / cargo | None (or Rust) | Low-Medium |
| Ignite CLI | curl install | Go | Low |
| cargo-contract | cargo install | Rust + C++17 | High |
| Pop CLI | cargo install | Rust | Medium |
| NEAR CLI RS | Shell script / cargo | None (or Rust) | Low |
| LIGO | Docker / npm / binary | Varies | Medium |
| Starknet Foundry | starkup (one-liner) | None | Low |
| Aztec | aztec-up | Docker | Medium-High |

**Key pattern:** The most successful tools (Foundry, Starknet Foundry, Aptos) provide single-command installs with minimal prerequisites.

### Plugin System Comparison

| Tool | Plugin Architecture | Extensibility |
|------|-------------------|---------------|
| **Hardhat** | HRE extension + Task system | **Best in class** - hundreds of community plugins |
| **Foundry** | None (monolithic) | Via Solidity libs + foundry.toml config |
| **Ignite CLI** | Ignite Apps marketplace | Growing plugin marketplace |
| **Pop CLI** | Template system | Template-based extensibility |
| **Taqueria** | Plugin architecture | Plugins for LIGO, SmartPy, etc. |
| **All others** | None | Monolithic CLIs |

**Key insight:** Only Hardhat has truly nailed the plugin system. Most tools are monolithic. Ignite's Apps marketplace is an interesting middle ground. Foundry proved that a monolithic tool can win on speed and DX without plugins.

### Local Dev Environment Approaches

| Pattern | Tools | Pros | Cons |
|---------|-------|------|------|
| **In-process simulation** | Hardhat (EDR) | Fastest, no external deps | Limited realism |
| **Standalone local node** | Anvil, Sui, Aptos | Realistic, external clients can connect | Separate process |
| **Docker-based** | Aztec sandbox | Full stack simulation | Heavy, Docker required |
| **Test validator** | Anchor/Solana | Uses real validator code | Slower startup |
| **Hot-reload chain** | Ignite CLI | Instant feedback | Custom, may diverge from prod |
| **SDK test harness** | NEAR workspaces | Lightweight, in-test | Limited scope |

### Testing Framework Approaches

| Approach | Tools | Advantages |
|----------|-------|------------|
| **Solidity-native tests** | Foundry, Hardhat v3 | No context switching, cheatcodes |
| **JS/TS tests** | Hardhat, Anchor | Flexible, familiar to web devs |
| **Language-native** | Aptos/Sui (Move), Starknet (Cairo) | Type-safe, co-located |
| **Python tests** | Brownie (pytest) | Python ecosystem |
| **Built-in fuzz testing** | Foundry, Starknet Foundry | Property-based testing out of box |
| **Formal verification** | Aptos (Move Prover) | Mathematical correctness |

### Scaffolding Spectrum

| Level | Tool | What It Generates |
|-------|------|-------------------|
| **Entire blockchain** | Ignite CLI | Full Cosmos chain with modules, proto, genesis |
| **Full project** | Anchor, Pop CLI | Workspace with programs, tests, configs |
| **Minimal project** | Foundry, Hardhat | Basic structure (src, test, config) |
| **Package only** | Aptos, Sui | Move.toml + source directory |
| **None** | Cast, NEAR CLI | Interaction tools only, no scaffolding |

### Developer Ecosystem Size (2025)

| Ecosystem | Monthly Active Devs | Growth Trend |
|-----------|-------------------|--------------|
| Ethereum (EVM) | 31,800+ total | Stable, mature |
| Solana | 17,700+ total | 83% YoY growth |
| Bitcoin | 11,000+ | Growing |
| Polygon | 4,000+ | Stable |
| Sui | Growing fast | 159% growth |
| Aptos | Growing | 96% growth |
| Base (L2) | 4,287 | 42% of new ETH code |
| Starknet | 2,000+ | Growing |

---

## DESIGN RECOMMENDATIONS FOR A NEW CLI

Based on this exhaustive analysis, here are the key patterns that make CLI toolchains successful:

### 1. Installation Must Be Trivial
- **Best practice:** Single curl command (Foundry, Starknet Foundry)
- **Anti-pattern:** Multi-step manual installs with many prerequisites (cargo-contract, Anchor)
- Consider a version manager like `suiup` or `starkup`

### 2. Speed Is a Competitive Moat
- Foundry won significant market share from Hardhat primarily on speed
- Rust-based tools consistently outperform JS/TS tools
- Hardhat 3 rewrote its core in Rust (EDR) specifically to compete
- **Lesson:** Build performance-critical paths in a compiled language

### 3. Plugin System: Decide Early and Commit
- Hardhat's HRE + plugin system is its greatest asset and biggest differentiator
- Foundry proved you can win without plugins if the core is excellent
- **Middle ground:** Ignite's App marketplace or Pop CLI's template system
- If you build a plugin system, make it easy to author plugins (Hardhat's `extendEnvironment` is elegant)

### 4. Testing Is the Core Value Proposition
- Every successful tool makes testing excellent
- Built-in fuzz testing (Foundry) is increasingly expected
- Cheatcodes (Foundry) or equivalent testing primitives are powerful differentiators
- Support both unit and integration testing patterns

### 5. Scaffolding Range Matters
- Ignite's "scaffold everything" approach is powerful for onboarding but teams outgrow it
- Foundry's minimal scaffolding works because the core tool is excellent
- **Best approach:** Minimal default + optional rich scaffolding templates

### 6. Local Dev Must Be Zero-Config
- In-process simulation (Hardhat EDR) provides the best DX
- Standalone node (Anvil) is needed for frontend/wallet testing
- **Avoid:** Requiring Docker for basic development (Aztec's main friction point)

### 7. Code Generation Is Crucial
- Anchor's IDL -> TypeScript client generation is its killer feature
- Sui's package upgrade system is innovative
- Auto-generated types/clients dramatically reduce developer effort

### 8. Documentation Patterns That Work
- Tutorial-driven getting started (Hardhat)
- Reference docs (Foundry Book)
- Interactive examples (Remix-style playground)
- **Avoid:** Scattered docs across multiple sites (Tezos/LIGO)

### 9. Dependency Management Is Hard
- Foundry's git submodules are widely criticized (led to Soldeer)
- npm/yarn work but bring Node.js dependency
- Move's built-in package system is clean
- **Consider:** Purpose-built package management or leverage existing ecosystems wisely

### 10. Lessons from Failures
- **Truffle:** Incumbency doesn't protect against better tools; stay ahead of ecosystem evolution
- **Brownie:** Niche language choice (Python) limits ecosystem growth
- **Ignite CLI:** Tight version coupling creates upgrade nightmares; decouple aggressively
- **Seahorse:** Transpilation adds fragility; native language support is more sustainable
