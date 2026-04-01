# Blockchain Full-Stack dApp Scaffolding Tools: Research Survey

> Research date: April 2026
> Purpose: Inform the design of `create-canton-app` for the Canton Network ecosystem
> Analogous to the CLI toolchain research that informed cantonctl

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Tool-by-Tool Analysis](#tool-by-tool-analysis)
3. [Cross-Cutting Patterns](#cross-cutting-patterns)
4. [Authentication Models](#authentication-models)
5. [Canton's Unique Challenges](#cantons-unique-challenges)
6. [Comparison Table](#comparison-table)
7. [Key Takeaways for create-canton-app](#key-takeaways-for-create-canton-app)

---

## Executive Summary

This survey analyzes 10 blockchain dApp scaffolding tools across Ethereum, Solana, StarkNet, NEAR, Sui, and multi-chain ecosystems. These tools solve the "last mile" problem: generating a working frontend that connects to deployed smart contracts, with wallet integration, state management, and contract interaction already wired up.

The landscape reveals three distinct tiers:

- **Tier 1 (Ecosystem anchors):** Scaffold-ETH 2, wagmi/create-wagmi, RainbowKit -- high adoption, deep integration with their chain's tooling
- **Tier 2 (Platform plays):** thirdweb, Alchemy create-web3-dapp, Moralis -- multi-chain, API-backed, vendor lock-in tradeoff
- **Tier 3 (Chain-specific):** create-solana-dapp, create-near-app, Scaffold-Stark-2, Sui dApp Kit -- official foundation tools, narrower but well-integrated

Key finding: **Scaffold-ETH 2 is the gold standard** for developer experience. Its auto-generated debug UI from contract ABIs, hot-reload on contract changes, and custom React hooks pattern have been adopted across multiple ecosystems (Scaffold-Stark-2 is a direct port). For Canton, which has a fundamentally different auth model (party-based vs wallet-based), the architecture patterns are highly relevant but the implementation must diverge significantly.

---

## Tool-by-Tool Analysis

### 1. Scaffold-ETH 2 (create-eth)

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | Ethereum |
| **GitHub** | [scaffold-eth/scaffold-eth-2](https://github.com/scaffold-eth/scaffold-eth-2) |
| **npm package** | `create-eth` |
| **npm weekly downloads** | ~480 (understated; most users clone the repo) |
| **GitHub stars** | ~2,000 |
| **CLI command** | `npx create-eth@latest` |

**What it scaffolds:**
- Full-stack Next.js app with React frontend
- Hardhat or Foundry smart contract project (user's choice)
- RainbowKit wallet connection (pre-configured)
- Wagmi hooks for contract interaction
- Viem as the low-level Ethereum interface
- TypeScript throughout

**Tech stack:** Next.js, RainbowKit, Wagmi, Viem, Hardhat/Foundry, Tailwind CSS, daisyUI

**Key features:**
- **Contract Hot Reload** -- Frontend auto-adapts when smart contracts change. Deployed contract ABIs are read and hooks regenerate automatically.
- **Debug Contracts page** -- Auto-generated UI from contract ABIs lets you call any function, inspect state, and test interactions without writing frontend code.
- **Custom hooks** -- `useScaffoldContractRead`, `useScaffoldContractWrite`, `useScaffoldEventSubscriber`, `useScaffoldEventHistory`, `useDeployedContractInfo` wrap wagmi with automatic ABI loading and TypeScript autocompletion.
- **Burner Wallet & Local Faucet** -- Instant testing without MetaMask.
- **Extension system** -- Modular add-ons for additional functionality.
- **AI-ready** -- Recent updates position it for AI agent interactions.

**Template system:** Single opinionated template with choice of Hardhat vs Foundry. Extensions provide customization rather than multiple templates.

**Relationship to CLI tool:** Tightly coupled to Hardhat/Foundry. The scaffold expects a Hardhat/Foundry project alongside the frontend. Smart contract compilation triggers frontend updates.

**Strengths:**
- Best-in-class developer experience for rapid prototyping
- Debug Contracts page is a unique differentiator -- no other tool auto-generates interactive UI from ABIs
- Strong community (BuidlGuidl, SpeedRunEthereum educational platform)
- Opinionated but well-chosen defaults

**Weaknesses:**
- Ethereum-only (though forks exist for other EVM chains)
- Low npm downloads suggest discovery problem -- most developers find it via GitHub/YouTube, not npm
- Monorepo structure can be complex for beginners
- Not designed for institutional/permissioned use cases

---

### 2. create-solana-dapp

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | Solana |
| **GitHub** | [solana-developers/create-solana-dapp](https://github.com/solana-developers/create-solana-dapp) |
| **npm package** | `create-solana-dapp` |
| **npm weekly downloads** | ~5,098 |
| **GitHub stars** | ~500 (estimated) |
| **CLI command** | `npx create-solana-dapp@latest` |

**What it scaffolds:**
- Frontend app (Next.js or Vue, user's choice)
- Anchor program scaffold (or native Solana program)
- Wallet adapter integration
- @tanstack/react-query for state management

**Tech stack:** Next.js or Vue/Nuxt, Solana Wallet Adapter, @tanstack/react-query, Anchor, TypeScript, pnpm

**Key features:**
- **Multi-framework support** -- Both React (Next.js) and Vue are first-class options.
- **Template system** -- Supports external templates via giget; any GitHub repo can serve as a template with `-t <github-org>/<repo>`.
- **Version checks** -- CLI validates Anchor (>= 0.30.1) and Solana CLI (>= 1.18.0) versions.
- **Init scripts** -- Templates can define post-scaffold instructions and rename maps in package.json.
- **Wallet provider pre-configured** -- `solana-provider.tsx` handles wallet auto-connect.

**Template system:** Extensible. Official templates from `solana-foundation/templates` repo, plus arbitrary GitHub repos via `-t` flag.

**Relationship to CLI tool:** Companion to Anchor framework. Scaffold includes `npm run anchor-build` and `npm run anchor-test` scripts. IDL generation feeds the frontend.

**Strengths:**
- Highest npm downloads of any chain-specific scaffold tool (10x Scaffold-ETH's npm numbers)
- External template system is elegant and community-driven
- Multi-framework (React + Vue) is rare among scaffold tools
- Solana Foundation official backing

**Weaknesses:**
- Less opinionated than Scaffold-ETH -- fewer auto-generated components
- No equivalent of the Debug Contracts page
- Requires Anchor knowledge for program development
- Community templates vary in quality

---

### 3. create-web3-dapp (Alchemy)

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | Multi-chain (Ethereum, Polygon, Optimism, Arbitrum, Solana) |
| **GitHub** | [alchemyplatform/create-web3-dapp](https://github.com/alchemyplatform/create-web3-dapp) |
| **npm package** | `create-web3-dapp` |
| **npm weekly downloads** | ~186 |
| **GitHub stars** | ~870 |
| **CLI command** | `npx create-web3-dapp@latest` |

**What it scaffolds:**
- Next.js frontend with React components
- RainbowKit or Phantom wallet integration (chain-dependent)
- Alchemy SDK integration for enhanced APIs
- Optional Hardhat or Foundry smart contract environment

**Tech stack:** Next.js, React, Alchemy SDK, RainbowKit, Wagmi, Hardhat/Foundry/Anchor

**Key features:**
- **Multi-chain from day one** -- Interactive CLI lets you select target blockchain.
- **Pre-made React components** -- Webhooks, APIs, and UI components included.
- **Alchemy Enhanced APIs** -- Built-in integration with Alchemy's infrastructure (NFT API, token API, etc.).
- **Zero-config tooling** -- RainbowKit, Phantom, Hardhat, Anchor are auto-configured.

**Template system:** Three options: empty full-stack dapp (with optional smart contract env), pre-built templates (Block Explorer, NFT Explorer), or community templates.

**Relationship to CLI tool:** Works with Hardhat, Foundry, or Anchor depending on chain. Rebranded to "Scaffold Alchemy" in late 2025.

**Strengths:**
- Multi-chain support in a single tool
- Alchemy API integration adds powerful indexing/querying capabilities
- Good onboarding with Alchemy University educational platform
- Pre-built templates for common patterns (NFT explorer, block explorer)

**Weaknesses:**
- Vendor lock-in to Alchemy's infrastructure
- Lower adoption than chain-specific tools
- Multi-chain breadth sacrifices depth on any single chain
- Template selection is limited compared to Scaffold-ETH extensions

---

### 4. wagmi CLI / create-wagmi

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | Ethereum (EVM chains) |
| **GitHub** | [wevm/wagmi](https://github.com/wevm/wagmi) |
| **npm package** | `create-wagmi` (scaffold), `@wagmi/cli` (code generation), `wagmi` (core) |
| **npm weekly downloads** | ~340,000 (wagmi core) |
| **GitHub stars** | ~6,700 |
| **CLI command** | `npm create wagmi` |

**What it scaffolds:**
- React or Vue app (Vite or Next.js/Nuxt)
- Wagmi configuration with wallet connectors
- Type-safe contract interaction hooks

**Tech stack:** React or Vue, Vite or Next.js/Nuxt, Wagmi, Viem, TypeScript

**Key features:**
- **Framework-agnostic** -- React (Vite, Next.js) and Vue (Vite, Nuxt) templates.
- **@wagmi/cli** -- Separate code-generation tool that creates type-safe hooks from contract ABIs. This is the "ABI-to-hooks" pipeline that other tools build on top of.
- **Reactive primitives** -- Wagmi provides React hooks for wallet connection, contract reads/writes, ENS resolution, transaction watching, etc.
- **Connector system** -- Pluggable wallet connectors (MetaMask, WalletConnect, Coinbase Wallet, etc.).
- **240+ contributors** -- Largest contributor community of any tool surveyed.

**Template system:** 4 templates: vite-react, next, vite-vue, nuxt.

**Relationship to CLI tool:** wagmi is the underlying library that Scaffold-ETH 2, RainbowKit, and many other tools build upon. It is the foundational layer, not a full-stack scaffold.

**Strengths:**
- De facto standard for Ethereum React hooks (340k weekly downloads)
- Type safety with full ABI typing via @wagmi/cli
- Framework-agnostic (React + Vue)
- Foundation that other scaffolds build upon

**Weaknesses:**
- Minimal scaffold -- provides structure but not components or UI
- Requires additional libraries for wallet UI (RainbowKit, ConnectKit, etc.)
- No smart contract tooling -- frontend only
- Steeper learning curve than full-stack scaffolds

---

### 5. RainbowKit Scaffold

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | Ethereum (EVM chains) |
| **GitHub** | [rainbow-me/rainbowkit](https://github.com/rainbow-me/rainbowkit) |
| **npm package** | `@rainbow-me/rainbowkit` (library), `@rainbow-me/create-rainbowkit` (scaffold) |
| **npm weekly downloads** | ~80,000-92,000 (library) |
| **GitHub stars** | ~2,700 |
| **CLI command** | `npm init @rainbow-me/rainbowkit@latest` |

**What it scaffolds:**
- Next.js app with RainbowKit wallet modal pre-configured
- Wagmi integration
- Beautiful wallet connection UI out of the box

**Tech stack:** Next.js, React, Wagmi, Viem, RainbowKit, TypeScript

**Key features:**
- **Best-in-class wallet connection UI** -- Polished modal with wallet discovery, chain switching, ENS avatar display, and transaction status.
- **Theming system** -- Customizable themes (light, dark, midnight, custom).
- **Chain support** -- Works with any EVM chain.
- **Authentication adapters** -- SIWE (Sign-In with Ethereum) integration.
- **Minimal scaffold** -- Focused on wallet connection, not full dApp scaffolding.

**Template system:** Single template (Next.js + RainbowKit + wagmi).

**Relationship to CLI tool:** RainbowKit is a UI component library, not a CLI tool. The scaffold creates a minimal app demonstrating RainbowKit's wallet modal. It layers on top of wagmi.

**Strengths:**
- Best wallet connection UX in the ecosystem
- High adoption (80k+ weekly downloads as a library)
- Actively maintained with security updates
- Clean, polished defaults

**Weaknesses:**
- Narrow scope -- wallet connection only, not a full scaffold
- React/Next.js only (no Vue, no other frameworks)
- Ethereum/EVM only
- Scaffold is minimal -- just a starting point

---

### 6. thirdweb create

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | Multi-chain (Ethereum, Polygon, Avalanche, Solana, 500+ chains) |
| **GitHub** | [thirdweb-dev/js](https://github.com/thirdweb-dev/js) |
| **npm package** | `thirdweb` (unified SDK, current), `@thirdweb-dev/cli` (legacy) |
| **npm weekly downloads** | ~12,000+ (legacy SDK); unified package growing |
| **GitHub stars** | ~600 |
| **CLI command** | `npx thirdweb create` (**DEPRECATED** as of late 2025) |

**What it scaffolded (before deprecation):**
- React/Next.js or React Native app
- Smart contract project (Solidity or pre-built)
- thirdweb SDK integration
- In-app wallet (email/social login) or external wallet connection

**Tech stack:** React/Next.js/React Native, thirdweb unified SDK, TypeScript

**Key features (SDK, still active):**
- **Unified package** -- Single `npm install thirdweb` for everything (90% smaller than previous version).
- **In-app wallets** -- Email, social login, phone -- walletless onboarding without browser extensions.
- **Account abstraction** -- Smart wallets with gas sponsorship.
- **500+ chains** -- Broadest chain support of any tool.
- **Pre-built contracts** -- ERC-20, ERC-721, ERC-1155, marketplace, etc.
- **AI integration** -- Nebula AI model for natural language blockchain interaction.

**Template system:** Multiple templates were available: app (frontend), contract (Solidity), dynamic contract extension. Now deprecated in favor of direct SDK integration.

**Relationship to CLI tool:** The CLI scaffolded projects using thirdweb's SDK and pre-built contracts. Deprecation of `create` suggests the industry is moving toward SDK-first approaches rather than scaffolding CLIs.

**Strengths:**
- Broadest chain support (500+)
- In-app wallets solve the onboarding problem for non-crypto users
- Account abstraction support is production-grade
- Unified SDK is clean and well-documented

**Weaknesses:**
- `thirdweb create` CLI is deprecated -- signal that scaffolding CLIs may not be the future
- Vendor lock-in to thirdweb infrastructure (RPC, bundler, paymaster, indexer)
- Lower GitHub stars than expected for a well-funded project
- Frequent breaking changes between SDK versions

---

### 7. Moralis create

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | Multi-chain (Ethereum, Polygon, BSC, Solana, etc.) |
| **GitHub** | [MoralisWeb3/create-moralis-dapp](https://github.com/MoralisWeb3/create-moralis-dapp) |
| **npm package** | `create-moralis-dapp` |
| **npm weekly downloads** | Low (not widely tracked) |
| **GitHub stars** | Low (repo has no description/topics) |
| **CLI command** | `npx create-moralis-dapp@latest` |

**What it scaffolds:**
- Next.js app with Moralis SDK integration
- Web3 authentication (wallet-based login)
- API integration for on-chain data (balances, NFTs, tokens)

**Tech stack:** Next.js, React, Moralis SDK, Nx monorepo, Jest, TypeScript

**Key features:**
- **Moralis API integration** -- Built-in access to Moralis' Web3 Data API for fetching balances, NFTs, token prices.
- **Web3 Authentication** -- Wallet connection and session management.
- **Nx workspace** -- Monorepo structure with code generation.
- **Cross-chain data** -- Query data across EVM chains and Solana.

**Template system:** Nx-based with workspace generation. Supports creating apps and libraries within the monorepo.

**Relationship to CLI tool:** Moralis is primarily a data API platform, not a smart contract tooling provider. The scaffold is oriented toward data-heavy dApps (dashboards, explorers, analytics) rather than contract interaction.

**Strengths:**
- Strong data APIs for reading on-chain state
- Cross-chain data aggregation
- Good for dashboard/analytics use cases
- Educational content and tutorials

**Weaknesses:**
- Minimal community adoption of the scaffold tool
- Nx monorepo is unusual for dApp projects (adds complexity)
- Legacy v1 CLI is deprecated; v2 scaffold is under-documented
- Heavy vendor lock-in to Moralis APIs
- Not suited for contract interaction -- focused on data reading

---

### 8. create-near-app

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | NEAR Protocol |
| **GitHub** | [near/create-near-app](https://github.com/near/create-near-app) |
| **npm package** | `create-near-app` |
| **npm weekly downloads** | ~139 |
| **GitHub stars** | ~400 (estimated) |
| **CLI command** | `npx create-near-app@latest` |

**What it scaffolds:**
- Smart contract project (Rust, JavaScript, TypeScript, or Python)
- Web app (Vite React or Next.js)
- NEAR wallet integration

**Tech stack:** Vite React or Next.js, NEAR JS SDK, near-api-js, TypeScript/Rust/Python

**Key features:**
- **Multi-language smart contracts** -- Rust, JS, TS, Python for contract development.
- **Interactive wizard** -- Choose "Smart Contract" or "Web App" with framework selection.
- **Non-interactive mode** -- CLI arguments for CI/automation: `--frontend next-app|none --contract js|rs|none`.
- **Cross-contract calls** -- Scaffolds support complex multi-contract interactions.

**Template system:** Built-in templates based on combination of frontend framework + contract language. No external template system.

**Relationship to CLI tool:** Official NEAR Foundation tool. Integrates with `cargo near` for Rust contracts and NEAR CLI for deployment.

**Strengths:**
- Multi-language contract support (Rust, JS, TS, Python)
- Official foundation support
- Non-interactive mode for automation
- Mature project (version 8.4.1)

**Weaknesses:**
- Low adoption (139 weekly downloads)
- No hot reload or debug UI
- Limited to NEAR ecosystem
- Frontend templates are basic compared to Scaffold-ETH

---

### 9. Scaffold-Stark-2 / create-stark

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | StarkNet |
| **GitHub** | [Scaffold-Stark/scaffold-stark-2](https://github.com/Scaffold-Stark/scaffold-stark-2) |
| **npm package** | `create-stark` |
| **npm weekly downloads** | Low (not widely tracked) |
| **GitHub stars** | ~126 |
| **CLI command** | `npx create-stark@latest` (or clone scaffold-stark-2) |

**What it scaffolds:**
- Next.js frontend with StarkNet integration
- Cairo smart contract project (via Scarb + Starknet Foundry)
- Starknet-React hooks for wallet interaction
- StarknetKit wallet connection

**Tech stack:** Next.js, Starknet.js, Starknet-React, StarknetKit, Scarb, Starknet Foundry, TypeScript

**Key features:**
- **Contract Fast Reload** -- Frontend auto-adapts on contract deployment (mirrors Scaffold-ETH).
- **Custom hooks** -- Starknet-React wrappers for contract interaction with TypeScript autocompletion.
- **Burner Wallet & Prefunded Accounts** -- Quick testing like Scaffold-ETH.
- **Extensions** -- Modular add-ons.
- **Starknet Devnet** -- Local development network integration.

**Template system:** Extensions provide customization (mirroring Scaffold-ETH's model). create-stark CLI lets you choose configurations.

**Relationship to CLI tool:** Direct port of Scaffold-ETH 2 patterns to StarkNet. Uses Scarb (Cairo build tool) and Starknet Foundry for smart contract development.

**Strengths:**
- Scaffold-ETH patterns adapted for StarkNet (proven UX)
- Active development and community
- Native Cairo/Scarb integration
- Contract Fast Reload is a strong feature

**Weaknesses:**
- Small community (126 stars)
- StarkNet ecosystem is still maturing
- Older Starknet-Scaffold project deprecated, fragmenting the community
- Cairo smart contract language has a steep learning curve

---

### 10. Sui dApp Kit Scaffold (@mysten/create-dapp)

| Attribute | Value |
|-----------|-------|
| **Ecosystem** | Sui (Move language) |
| **GitHub** | [MystenLabs/sui](https://github.com/MystenLabs/sui) (monorepo) |
| **npm package** | `@mysten/create-dapp` |
| **npm weekly downloads** | ~273 |
| **GitHub stars** | Sui monorepo: ~10,000+ |
| **CLI command** | `npm create @mysten/dapp` |

**What it scaffolds:**
- Vite + React + TypeScript app
- @mysten/dapp-kit integration (wallet connection, RPC hooks)
- Radix UI for components
- ESLint configuration

**Tech stack:** Vite, React, TypeScript, @mysten/dapp-kit (now split: dapp-kit-core + dapp-kit-react), Radix UI

**Key features:**
- **All-wallet support** -- Automatically supports all Sui wallets without manual configuration.
- **RPC hooks** -- Built-in hooks for querying Sui objects, transactions, and state.
- **Two templates** -- `react-client-dapp` (basic wallet + object listing) and `react-e2e-counter` (full Move + frontend example).
- **v2.0 SDK update** -- New dApp Kit with gRPC and GraphQL support, modular core/react split.

**Template system:** Two official templates. No external template system.

**Relationship to CLI tool:** Part of the broader Sui TypeScript SDK. Move smart contract development is separate (Sui CLI). The scaffold focuses purely on the frontend.

**Strengths:**
- Official Mysten Labs support with active development
- Clean SDK architecture (core + react split)
- Automatic wallet discovery
- Sui's object-centric model is well-represented in the hooks

**Weaknesses:**
- Only 2 templates -- very limited starting points
- Frontend-only scaffold (no Move project integration)
- Sui ecosystem is newer and smaller
- v2.0 migration required for existing projects

---

## Cross-Cutting Patterns

### Frontend Framework Dominance

| Framework | Tools Using It |
|-----------|---------------|
| **Next.js** | Scaffold-ETH 2, create-web3-dapp, Scaffold-Stark-2, create-near-app, Moralis |
| **Vite + React** | create-solana-dapp, Sui dApp Kit, create-near-app |
| **Vue/Nuxt** | create-solana-dapp, create-wagmi |
| **React Native** | thirdweb (formerly) |

**Finding:** Next.js is the dominant choice for full-stack dApps (server-side rendering, API routes, SEO). Vite is preferred for client-only SPAs. Vue support exists but is secondary. **No tool supports Angular, Svelte, or other frameworks as first-class options.**

### State Management

Most tools converge on a similar pattern:
- **@tanstack/react-query** for server/async state (RPC calls, contract reads)
- **React context/hooks** for local state (wallet connection, user preferences)
- **Wagmi/chain-specific hooks** as the primary contract interaction layer

No tool uses Redux, Zustand, or Jotai. The React hooks + query pattern has won.

### Hot Reload / Contract Synchronization

| Tool | Hot Reload Mechanism |
|------|---------------------|
| Scaffold-ETH 2 | ABI file watching; frontend auto-updates |
| Scaffold-Stark-2 | Contract Fast Reload; same pattern |
| create-solana-dapp | IDL generation feeds frontend |
| Others | Manual rebuild required |

**Finding:** Auto-generated frontend from contract ABIs/IDLs is the killer feature that separates Scaffold-ETH from the rest. Only Scaffold-Stark-2 has replicated this.

### Auto-Generated UI from ABI

Only **Scaffold-ETH 2** (and its StarkNet port) provide a Debug Contracts page that auto-generates interactive UI from smart contract ABIs. This is unanimously cited as the most valuable feature for rapid prototyping.

### Monorepo vs Single Project

| Structure | Tools |
|-----------|-------|
| **Monorepo** (frontend + contracts) | Scaffold-ETH 2, Scaffold-Stark-2, create-web3-dapp |
| **Frontend-only** | wagmi, RainbowKit, Sui dApp Kit |
| **Separate projects** | create-solana-dapp, create-near-app |

**Finding:** Full-stack scaffolds use monorepos. This couples the frontend to the smart contract project, enabling hot reload but adding complexity.

---

## Authentication Models

### Wallet-Based Auth (Standard Web3)

The dominant pattern across all surveyed tools:

1. User clicks "Connect Wallet"
2. Browser extension or mobile wallet responds
3. User signs a challenge message (EIP-4361 / Sign-In with Ethereum)
4. Backend verifies signature, issues JWT session
5. Subsequent API calls use JWT; on-chain calls use wallet signature

**Tools using this:** All 10 surveyed tools

### Embedded Wallets (Walletless Onboarding)

Emerging pattern for mainstream adoption:

1. User signs in with email/social/passkey
2. App provisions a non-custodial embedded wallet (MPC or secure enclave)
3. Wallet exists on-chain only when first used (counterfactual deployment)
4. Smart account enables gas sponsorship, batch transactions, session keys

**Tools supporting this:** thirdweb (primary), Alchemy (via Account Kit), RainbowKit (partial via adapters)

### API Key Auth

Traditional Web2 pattern used by data APIs:

1. Developer registers on platform, receives API key
2. Backend calls data APIs with API key
3. Frontend calls backend, never touches API key directly

**Tools using this:** Moralis, Alchemy (for their data APIs, not wallet auth)

### Party-Based Auth (Canton Network)

Canton's fundamentally different model:

1. **No global state** -- Unlike Ethereum where all nodes see all data, Canton parties see only their own contracts
2. **Party = identity** -- Parties are the core on-ledger identity (analogous to Ethereum EOAs but with built-in privacy)
3. **Validator-specific connections** -- To access a party's data, you must connect to the validator hosting that party
4. **CIP-0103 standard** -- Canton's equivalent of EIP-1193, defining dApp-to-wallet communication
5. **Wallet Gateway architecture** -- dApps use the dApp SDK to communicate with Wallet Gateways, which authenticate to validator Ledger APIs

The `@canton-network/dapp-sdk` implements this with:
- `window.canton` provider (like `window.ethereum`)
- Wallet Discovery (browser extensions + remote gateways)
- Multi-transport (HTTP/SSE for remote, postMessage for extensions)
- Account management (list accounts, respond to changes)
- Transaction lifecycle events

---

## Canton's Unique Challenges

### 1. Party-Based vs Wallet-Based Identity

In Ethereum, an address has a single private key and can interact with any smart contract on any node. In Canton, a party's data is distributed across specific validators, and the party can only see contracts where it is a stakeholder.

**Implication for create-canton-app:** The wallet connection UI must show not just "connected" but which party the user is acting as, which validator they're connected to, and which contracts are visible to them. This is a fundamentally richer state model than "address + chain ID."

### 2. Sub-Transaction Privacy

Canton supports sub-transaction privacy -- parties see only the parts of a transaction relevant to them. This means a frontend cannot display a full transaction tree; it can only show the user's view.

**Implication:** Transaction history and contract state displays must be party-scoped. There is no "block explorer" that shows everything.

### 3. Daml vs Solidity Contract Model

Daml contracts have a different lifecycle than Solidity:
- Contracts are created, exercised (which may archive the original and create new ones), and archived
- Contracts have explicit signatories, observers, and controllers
- No mutable state -- state changes create new contracts

**Implication:** The "Debug Contracts" pattern from Scaffold-ETH needs significant adaptation. Instead of calling arbitrary functions on a deployed contract, the UI should show active contracts for a party, allow exercising choices, and display the contract lifecycle.

### 4. No Global Smart Contract Addresses

In Ethereum, you deploy a contract to an address and everyone interacts with it at that address. In Canton, there are no global addresses for contracts. Contracts exist in the context of their participants.

**Implication:** The scaffold cannot use a simple "contract address" configuration. It needs to understand the Daml package ID, template names, and party-based contract discovery.

### 5. JWT Auth for Sandbox, Wallet Auth for Network

cantonctl already handles JWT auth for local sandbox development. For Canton Network, the `@canton-network/dapp-sdk` handles wallet-based auth via CIP-0103. The scaffold must support both modes seamlessly.

---

## Comparison Table

| Tool | Ecosystem | Stars | npm/wk | Frontend | Smart Contract Integration | Hot Reload | Debug UI | Wallet UI | Templates | Auth Model |
|------|-----------|-------|--------|----------|--------------------------|------------|----------|-----------|-----------|------------|
| **Scaffold-ETH 2** | Ethereum | ~2,000 | ~480 | Next.js | Hardhat/Foundry (monorepo) | Yes (ABI) | Yes (auto-gen) | RainbowKit | 1 + extensions | Wallet (EIP-4361) |
| **create-solana-dapp** | Solana | ~500 | ~5,100 | Next.js/Vue | Anchor (monorepo or separate) | IDL-based | No | Solana Wallet Adapter | Extensible (giget) | Wallet (Solana) |
| **create-web3-dapp** | Multi-chain | ~870 | ~186 | Next.js | Hardhat/Foundry/Anchor | No | No | RainbowKit/Phantom | 3 built-in | Wallet + API key |
| **wagmi / create-wagmi** | Ethereum | ~6,700 | ~340,000 | Next.js/Vue | None (frontend only) | N/A | No | BYO (RainbowKit etc.) | 4 framework templates | Wallet (EIP-1193) |
| **RainbowKit** | Ethereum | ~2,700 | ~80,000 | Next.js | None (wallet only) | N/A | No | Yes (best-in-class) | 1 | Wallet + SIWE |
| **thirdweb** | Multi-chain | ~600 | ~12,000 | Next.js/RN | thirdweb contracts | No | Dashboard | ConnectButton | Deprecated | Wallet + Embedded + AA |
| **Moralis** | Multi-chain | Low | Low | Next.js | None (data API) | No | No | Wallet connect | Nx-based | Wallet + API key |
| **create-near-app** | NEAR | ~400 | ~139 | Vite/Next.js | Rust/JS/TS/Python | No | No | NEAR Wallet | Built-in combos | NEAR Wallet |
| **Scaffold-Stark-2** | StarkNet | ~126 | Low | Next.js | Cairo/Scarb/Foundry | Yes (Fast Reload) | Yes (ported) | StarknetKit | Extensions | Wallet (StarkNet) |
| **Sui dApp Kit** | Sui | ~273 (pkg) | ~273 | Vite React | None (frontend only) | N/A | No | Auto-discovery | 2 | Wallet (Sui) |

---

## Key Takeaways for create-canton-app

### 1. Follow the Scaffold-ETH Pattern (Adapt, Don't Copy)

Scaffold-ETH 2's architecture is the proven winner:
- **Monorepo** with frontend + contract project
- **Auto-generated UI** from contract definitions
- **Custom hooks** wrapping the chain-specific SDK
- **Hot reload** on contract changes
- **Burner/dev mode** for quick testing

For Canton, this means:
- Monorepo with Next.js frontend + Daml project
- Auto-generated "Contract Explorer" from Daml templates (analogous to Debug Contracts)
- Custom React hooks wrapping `@canton-network/dapp-sdk` and the JSON Ledger API
- Hot reload on `daml build` (cantonctl's `--watch` mode already supports this)
- JWT-based sandbox mode for local development

### 2. Party-Aware UI Components

No existing tool has party-scoped UI. This is Canton's differentiator and create-canton-app's opportunity:
- **PartyPicker** component (choose active party from connected wallet)
- **ContractList** component (active contracts visible to the current party)
- **ChoiceExerciser** component (exercise a choice on a contract, like Scaffold-ETH's function caller)
- **ContractTimeline** component (lifecycle: created -> exercised -> archived)
- **MultiPartyView** component (for dev mode: see the ledger from multiple party perspectives)

### 3. Dual Auth Mode

Support both development and production auth:
- **Dev mode:** JWT auth via cantonctl sandbox (well-known secret, instant setup)
- **Network mode:** CIP-0103 wallet auth via `@canton-network/dapp-sdk`
- Configuration switch in a single file, not a code rewrite

### 4. Template System

Follow create-solana-dapp's external template model:
- **Built-in templates:** basic (hello world), token (asset management), multi-party (workflow between parties)
- **External templates:** Any GitHub repo can serve as a template via `-t` flag
- **Interactive mode:** Wizard with prompts (cantonctl's `init` already does this)

### 5. What to Avoid

- **Vendor lock-in** (Alchemy, Moralis, thirdweb patterns) -- Canton apps should work with any validator
- **Frontend-only scaffolds** (wagmi, RainbowKit) -- the Daml project integration is essential
- **Over-complexity** (Moralis Nx monorepo) -- keep it simple, one frontend + one Daml project
- **Deprecating the scaffold** (thirdweb) -- maintain the CLI as the primary onramp

### 6. Institutional-Grade Defaults

Canton targets institutional users ($6T+ in tokenized assets). The scaffold should reflect this:
- **TypeScript strict mode** everywhere
- **ESLint + Prettier** pre-configured
- **Testing scaffolded** from day one (Vitest + React Testing Library)
- **Environment management** (local sandbox, devnet, mainnet configs)
- **No burner wallets in production mode** -- clear separation of dev and prod
- **Audit-friendly code structure** -- clean separation of concerns, no magic

### 7. The ABI-to-UI Pipeline is the Killer Feature

Scaffold-ETH's Debug Contracts page is universally praised. For Canton:
- Parse Daml template definitions (from DAR metadata or codegen output)
- Generate interactive UI for each template: create contracts, exercise choices, view active contracts
- Display contract arguments with proper types (Party, ContractId, Text, Int, etc.)
- Show signatory/observer/controller information
- This is the feature that would make create-canton-app stand out

### 8. Name: `create-canton-app`

Following the established convention:
- `create-eth` (Ethereum)
- `create-solana-dapp` (Solana)
- `create-near-app` (NEAR)
- `create-stark` (StarkNet)
- `@mysten/create-dapp` (Sui)
- **`create-canton-app`** (Canton Network)

The command would be: `npx create-canton-app@latest`

---

## Sources

- [Scaffold-ETH 2 GitHub](https://github.com/scaffold-eth/scaffold-eth-2)
- [Scaffold-ETH 2 Docs](https://docs.scaffoldeth.io/)
- [create-solana-dapp GitHub](https://github.com/solana-developers/create-solana-dapp)
- [create-solana-dapp npm](https://www.npmjs.com/package/create-solana-dapp)
- [Solana Scaffold Guide](https://solana.com/developers/guides/getstarted/scaffold-nextjs-anchor)
- [create-web3-dapp GitHub](https://github.com/alchemyplatform/create-web3-dapp)
- [wagmi GitHub](https://github.com/wevm/wagmi)
- [wagmi Docs](https://wagmi.sh/cli/create-wagmi)
- [RainbowKit GitHub](https://github.com/rainbow-me/rainbowkit)
- [RainbowKit npm](https://www.npmjs.com/package/@rainbow-me/rainbowkit)
- [thirdweb JS SDK GitHub](https://github.com/thirdweb-dev/js)
- [thirdweb Docs](https://portal.thirdweb.com/cli/create)
- [Moralis create-moralis-dapp GitHub](https://github.com/MoralisWeb3/create-moralis-dapp)
- [Moralis JS SDK GitHub](https://github.com/MoralisWeb3/Moralis-JS-SDK)
- [create-near-app GitHub](https://github.com/near/create-near-app)
- [create-near-app npm](https://www.npmjs.com/package/create-near-app)
- [Scaffold-Stark-2 GitHub](https://github.com/Scaffold-Stark/scaffold-stark-2)
- [create-stark GitHub](https://github.com/Scaffold-Stark/create-stark)
- [Sui dApp Kit Docs](https://sdk.mystenlabs.com/dapp-kit)
- [@mysten/create-dapp Docs](https://sdk.mystenlabs.com/dapp-kit/create-dapp)
- [@canton-network/dapp-sdk npm](https://www.npmjs.com/package/@canton-network/dapp-sdk)
- [CIP-0103 Specification](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md)
- [Canton Network Protocol](https://www.canton.network/protocol)
- [Canton Developer Resources](https://www.canton.network/developer-resources)
- [Web3 Authentication Guide 2025](https://medium.com/@joalavedra/the-ultimate-web3-authentication-guide-2025-wallet-sign-in-embedded-wallets-and-choosing-the-d4eace54f951)
- [dApp Architecture Patterns 2026](https://medium.com/@eugene.afonin/architecture-patterns-for-dapps-with-wallet-integration-ded007e662b8)
- [Web3 Development Stack 2025](https://www.syncrasytech.com/blogs/web3-development-stack-for-modern-dapps)
