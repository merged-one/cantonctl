# cantonctl Roadmap

> From CLI tool to ecosystem platform — the path to making Canton the easiest institutional blockchain to build on.

## Current State: Feature-Complete CLI (March 2026)

cantonctl is a production-quality CLI with 14 commands, 24 foundation libraries, 5 project templates, and 490 tests at 98.18% coverage. Every command works, every error is structured, every output except `console` and `playground` supports `--json`. The core developer workflow — `init → dev → build → test → deploy` — works end-to-end.

| Metric | Value |
|--------|-------|
| Commands | 14 (init, dev, build, test, deploy, console, status, auth, clean, doctor, serve, playground) |
| Templates | 5 (basic, token, defi-amm, api-service, zenith-evm) |
| Tests | 490 (399 unit + 91 E2E), 100% pass rate |
| Coverage | 98.18% statements, 91.11% branches |
| Documentation | 24 docs (9 reference, 5 task guides, 4 concept docs, error index, llms.txt, JSON Schema) |
| ADRs | 14 architecture decision records |

---

## Phase 1: V1 Release (Weeks 1-2)

Ship the current codebase as v1.0.0 on npm.

| Task | Effort | Description |
|------|--------|-------------|
| CHANGELOG.md | 1 day | Release notes documenting all features |
| `--json` conformance audit | 1 day | Verify every command's JSON output matches documented schema |
| Version bump | 1 hour | 0.1.0 → 1.0.0 in package.json |
| npm publish | Done | `npm install -g cantonctl` works globally (v0.1.0 published) |
| `npx cantonctl` verification | 1 hour | Zero-install experience works |
| GitHub release | Done | GitHub Actions release workflow triggers on v* tags |

**Exit criteria:** `npm install -g cantonctl && cantonctl init my-app --template token && cd my-app && cantonctl dev` works on a clean machine with Node 18+ and Daml SDK installed.

---

## Phase 2: Distribution & Launch (Weeks 3-6)

Take cantonctl from "published" to "adopted." This is the marketing and distribution phase.

### 2.1 Distribution Channels

| Channel | Effort | Impact | Notes |
|---------|--------|--------|-------|
| npm registry | Done (v0.1.0) | High | Primary distribution |
| Homebrew tap | 3 days | Medium | `brew install cantonctl` — macOS/Linux native install |
| GitHub Releases (binaries) | 2 days | Medium | Pre-built binaries via oclif `pack` (no Node.js required) |
| Docker image | 1 day | Low | `docker run cantonctl init` for containerized workflows |
| GitHub Actions reusable workflow | 3 days | High | `uses: merged-one/cantonctl-action@v1` for CI pipelines |

### 2.2 Documentation Integration

| Task | Effort | Impact |
|------|--------|--------|
| Integration into official Canton docs | 2 days | Critical — must be recommended alongside cn-quickstart |
| "Getting Started with cantonctl" blog post | 2 days | High — first impression for most developers |
| Video tutorial: Quickstart (5 min) | 2 days | High — YouTube/Canton Academy |
| Video tutorial: DeFi template deep-dive (10 min) | 2 days | Medium |
| Video tutorial: Deploy to Canton Network (10 min) | 2 days | Medium |
| Canton community call presentation | 1 day | High — live demo of init → dev → deploy |

### 2.3 Developer Onboarding

| Task | Effort | Impact |
|------|--------|--------|
| Interactive `cantonctl doctor` command | 3 days | High — diagnoses environment issues (Java, Daml SDK, Docker) |
| `cantonctl upgrade` self-update | 2 days | Medium — keeps developers on latest version |
| Telemetry (opt-in, anonymous) | 3 days | Medium — usage analytics for prioritization |
| Error reporting integration | 2 days | Low — optional crash reporting |

**Phase 2 total: ~4 weeks**

---

## Phase 3: Developer Experience Polish (Weeks 7-12)

Close the gap between "works" and "delightful." These are the features that make developers choose cantonctl over raw `dpm` commands.

### 3.1 Advanced Local Development

| Feature | Effort | Hardhat Equivalent | Description |
|---------|--------|--------------------|-------------|
| `cantonctl dev --fork <network>` | 2 weeks | `hardhat node --fork` | Fork a remote Canton network locally (when Canton supports it) |
| Persistent storage mode | 1 week | — | Postgres backend for `dev --full` (state survives restarts) |
| Transaction explorer UI | 2 weeks | Hardhat console.log | Web-based contract event viewer at `localhost:8080` |
| `cantonctl exec` scripting | 1 week | `hardhat run` | Execute REPL commands from scripts (non-interactive) |
| Gas/resource profiling | 1 week | `hardhat-gas-reporter` | Daml interpretation cost reporting |

### 3.2 Testing Enhancements

| Feature | Effort | Hardhat Equivalent | Description |
|---------|--------|--------------------|-------------|
| Test coverage reporting | 1 week | `solidity-coverage` | Which Daml templates and choices are exercised |
| Snapshot testing | 3 days | — | Assert contract state matches expected JSON |
| Test fixtures | 3 days | `hardhat-deploy` fixtures | Pre-deploy contracts for test setup |
| Parallel test execution | 1 week | — | Run independent test scripts concurrently |
| Watch mode for tests | 3 days | — | `cantonctl test --watch` reruns on `.daml` changes |

### 3.3 Deployment Enhancements

| Feature | Effort | Hardhat Equivalent | Description |
|---------|--------|--------------------|-------------|
| Deployment tracking | 1 week | Hardhat Ignition | Track deployed packages per network, prevent duplicates |
| Multi-network deploy | 3 days | `hardhat-deploy` | `cantonctl deploy --network devnet,testnet` |
| DAR verification | 1 week | Etherscan verify | Verify deployed DAR matches source (when Canton supports it) |
| Upgrade safety checks | 1 week | OpenZeppelin Upgrades | Detect breaking template changes before deploy |

### 3.4 Build Enhancements

| Feature | Effort | Hardhat Equivalent | Description |
|---------|--------|--------------------|-------------|
| Multi-package builds | 1 week | Hardhat workspaces | Build multiple DAR packages in a monorepo |
| Incremental compilation | 3 days | Hardhat cache | Only recompile changed `.daml` files |
| Build profiles | 3 days | — | `cantonctl build --profile production` (strip debug info) |

**Phase 3 total: ~6 weeks (selective — not all features ship simultaneously)**

---

## Phase 4: Plugin Ecosystem (Weeks 13-20)

The plugin ecosystem is what transforms a CLI tool into a platform. Hardhat's 190+ plugins are its primary competitive moat.

### 4.1 Plugin Infrastructure

| Task | Effort | Description |
|------|--------|-------------|
| Plugin template generator | 3 days | `cantonctl plugin init my-plugin` scaffolds a new plugin |
| Plugin testing harness | 1 week | Test utilities for plugin authors (mock cantonctl context) |
| Plugin documentation site | 1 week | Auto-generated from plugin manifests |
| Plugin registry (GitHub-based) | 1 week | Searchable catalog at `cantonctl plugin search` |
| Plugin marketplace page | 3 days | Web page listing all community plugins |

### 4.2 First-Party Plugins

| Plugin | Effort | Hardhat Equivalent | Description |
|--------|--------|--------------------|-------------|
| `@cantonctl/plugin-zenith` | 2 weeks | `hardhat-ethers` | Zenith EVM bridge integration (deploy Solidity + Daml) |
| `@cantonctl/plugin-explorer` | 2 weeks | — | Local web UI for inspecting ledger state |
| `@cantonctl/plugin-codegen` | 1 week | `hardhat-typechain` | TypeScript/Python/Java binding generation |
| `@cantonctl/plugin-profiler` | 1 week | `hardhat-gas-reporter` | Daml interpretation cost analysis |
| `@cantonctl/plugin-coverage` | 1 week | `solidity-coverage` | Template and choice coverage reporting |
| `@cantonctl/plugin-docker` | 1 week | — | Advanced Docker topology configurations |
| `@cantonctl/plugin-observability` | 1 week | — | Prometheus metrics + Grafana dashboards for local dev |

### 4.3 Community Plugin Enablement

| Task | Effort | Description |
|------|--------|-------------|
| Plugin authoring guide (comprehensive) | 3 days | Step-by-step tutorial with examples |
| Plugin API stability guarantees | 2 days | Semantic versioning policy for hook APIs |
| Community plugin bounty program | Ongoing | Incentivize community contributions |
| Monthly plugin spotlight blog | Ongoing | Feature community plugins |

**Phase 4 total: ~8 weeks**

---

## Phase 5: IDE Integration (Weeks 21-26)

### 5.1 VS Code Extension

| Feature | Effort | Hardhat Equivalent | Description |
|---------|--------|--------------------|-------------|
| Syntax highlighting for `cantonctl.yaml` | 3 days | — | JSON Schema-backed autocomplete |
| Inline error display | 1 week | Hardhat VSCode | Show `cantonctl build` errors inline |
| Task runner integration | 3 days | — | Run cantonctl commands from VS Code tasks |
| Test explorer integration | 1 week | — | Visual test runner with pass/fail indicators |
| Debug configuration | 1 week | — | Launch `cantonctl dev` from VS Code debug |
| Status bar widget | 3 days | — | Show sandbox status, active network |
| CodeLens for Daml templates | 1 week | — | "Deploy" / "Test" actions above template definitions |

### 5.2 Other IDE Support

| IDE | Effort | Description |
|-----|--------|-------------|
| IntelliJ / Daml Studio | 1 week | Plugin for JetBrains IDEs |
| Neovim / LSP integration | 3 days | LSP server for cantonctl diagnostics |

**Phase 5 total: ~6 weeks**

---

## Phase 6: Documentation Platform (Weeks 27-32)

### 6.1 Documentation Website

| Task | Effort | Hardhat Equivalent | Description |
|------|--------|-------|-------------|
| Documentation site (Docusaurus/Mintlify) | 2 weeks | hardhat.org | Searchable, versioned documentation |
| API reference (auto-generated) | 1 week | Hardhat API docs | Generated from TypeScript types |
| Interactive playground | 2 weeks | — | Hosted Canton sandbox with browser frontend (JVM precludes in-browser execution) |
| Tutorial series (10+ articles) | 2 weeks | Hardhat tutorials | Progressive complexity from "Hello World" to DeFi |
| Cookbook (recipes) | 1 week | — | Common patterns: multi-party, upgrades, testing |
| Multilingual docs (i18n) | 2 weeks | — | Chinese, Korean, Japanese (key DeFi markets) |

### 6.2 Agentic Documentation (Layers 2-5)

| Layer | Effort | Description |
|-------|--------|-------------|
| Layer 2: CI quality gates | 1 week | Docs tested in CI (broken link detection, example validation) |
| Layer 3: Autonomous agents | 2 weeks | AI agents that answer cantonctl questions via MCP |
| Layer 4: MCP server | 2 weeks | Machine-readable API for AI assistants (Claude, Cursor, Copilot) |
| Layer 5: Self-healing docs | 1 week | Docs auto-update when code changes |

**Phase 6 total: ~6 weeks**

---

## Phase 7: Ecosystem & Community (Ongoing)

### 7.1 Community Building

| Activity | Effort | Hardhat Equivalent | Description |
|----------|--------|--------------------|-------------|
| Discord/Telegram channel | Ongoing | Hardhat Discord | Developer support community |
| Monthly office hours | Ongoing | — | Live Q&A with cantonctl team |
| Contributor guide + first-issue labels | 1 week | — | Lower barrier to contribution |
| Annual developer survey | Yearly | Hardhat survey | Track satisfaction and prioritize features |
| Conference talks | Ongoing | ETHGlobal, Devcon | Present at Canton/blockchain conferences |
| Hackathon sponsorship | Ongoing | ETHGlobal | Sponsor Canton hackathons with cantonctl track |

### 7.2 Template Ecosystem

| Task | Effort | Description |
|------|--------|-------------|
| Template registry website | 1 week | Searchable catalog of community templates |
| 10+ community templates | Ongoing | Incentivize via bounties |
| Enterprise templates | 2 weeks | Multi-org, regulatory compliance, audit trail |
| Template versioning | 1 week | Templates track SDK version compatibility |

### 7.3 Integration Ecosystem

| Integration | Effort | Description |
|-------------|--------|-------------|
| GitHub Copilot integration | 1 week | Custom instructions for Daml + cantonctl |
| Cursor/Claude integration | 1 week | MCP server for AI-assisted development |
| Vercel/Netlify deploy hooks | 1 week | Auto-deploy frontend when DAR changes |
| Terraform provider | 2 weeks | Infrastructure-as-code for Canton networks |
| Kubernetes operator | 3 weeks | Production Canton deployment automation |

---

## Timeline Summary

| Phase | Timeline | Focus | Key Deliverable |
|-------|----------|-------|-----------------|
| **Phase 1** | Weeks 1-2 | V1 Release | `npm install -g cantonctl` works |
| **Phase 2** | Weeks 3-6 | Distribution & Launch | Homebrew, docs integration, video tutorials |
| **Phase 3** | Weeks 7-12 | DX Polish | exec, explorer, deployment tracking, test coverage |
| **Phase 4** | Weeks 13-20 | Plugin Ecosystem | 7+ first-party plugins, plugin registry, community |
| **Phase 5** | Weeks 21-26 | IDE Integration | VS Code extension with inline errors, test explorer |
| **Phase 6** | Weeks 27-32 | Docs Platform | Documentation website, interactive playground, MCP |
| **Phase 7** | Ongoing | Ecosystem | Community, templates, integrations, conferences |

---

## Hardhat Parity Analysis

What Hardhat has that cantonctl needs to match or exceed:

| Capability | Hardhat | cantonctl Status | Gap |
|-----------|---------|------------------|-----|
| Core CLI (init, compile, test, deploy) | Yes | **Complete** | None |
| Local network with hot-reload | Hardhat Network | **Complete** (sandbox + Docker multi-node) | None |
| Project templates | Yes (3) | **Complete** (5 templates) | None — we have more |
| Plugin system | 190+ plugins | **Framework complete**, 0 published plugins | Critical gap |
| VS Code extension | Yes | Not started | Major gap |
| Documentation website | hardhat.org | Markdown docs only | Major gap |
| Interactive playground | No | Not started | Opportunity to lead |
| npm weekly downloads | ~218K | Published (v0.1.0) | Early — just launched |
| GitHub stars | 8,300+ | New repo | Expected |
| Deployment system | Ignition | **6-step pipeline complete** | Feature parity |
| Console/REPL | `hardhat console` | **Complete** with tab completion | Feature parity |
| Fork mode | `--fork` | Not applicable (Canton architecture) | N/A |
| Gas reporting | `hardhat-gas-reporter` | Planned (Phase 3) | Minor gap |
| Test coverage | `solidity-coverage` | Planned (Phase 3) | Minor gap |
| TypeScript codegen | `hardhat-typechain` | **Built-in** (`build --codegen`) | We're ahead |
| Error messages | Structured | **Structured** (24 codes with suggestions) | Feature parity |
| JSON output | Partial | **Every command** | We're ahead |
| AI/LLM documentation | No | **llms.txt + MCP planned** | We're ahead |
| Multi-node topology | No (single network) | **Complete** (`dev --full`) | We're ahead |

**Key insight:** cantonctl's core CLI is at feature parity with Hardhat. The gaps are in ecosystem (plugins, extensions, community) and distribution (website, marketing, adoption). These are the focus of Phases 4-7.

---

## Success Metrics

### 6-Month Targets (Post-Launch)

| Metric | Target | Measurement |
|--------|--------|-------------|
| npm weekly downloads | 500+ | npm stats |
| GitHub stars | 200+ | GitHub |
| Active projects using cantonctl | 50+ | Telemetry (opt-in) |
| Community templates | 5+ | Template registry |
| Community plugins | 3+ | Plugin registry |
| Developer satisfaction | >70% recommend | Survey |
| Time-to-first-transaction | <5 minutes | User testing |
| Canton Forum mentions | 20+ threads | Forum search |

### 12-Month Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| npm weekly downloads | 2,000+ | npm stats |
| GitHub stars | 1,000+ | GitHub |
| Active projects | 200+ | Telemetry |
| Community templates | 20+ | Registry |
| Community plugins | 10+ | Registry |
| VS Code extension installs | 500+ | VS Code Marketplace |
| Conference talks | 5+ | Event listings |
| Documentation site monthly visitors | 5,000+ | Analytics |

### 24-Month Targets (Hardhat-Scale Ambition)

| Metric | Target | Measurement |
|--------|--------|-------------|
| npm weekly downloads | 10,000+ | npm stats |
| GitHub stars | 3,000+ | GitHub |
| Plugins | 30+ | Registry |
| "Default tool" for Canton development | >50% of new projects | Survey |

---

## Resource Requirements

### Team

| Role | Phase 1-2 | Phase 3-4 | Phase 5-7 |
|------|-----------|-----------|-----------|
| Core developer (CLI + libraries) | 1 FTE | 1 FTE | 1 FTE |
| Plugin developer | — | 1 FTE | 0.5 FTE |
| Frontend developer (docs site, explorer, VS Code) | — | 0.5 FTE | 1 FTE |
| DevRel / community | 0.5 FTE | 0.5 FTE | 1 FTE |
| Designer (brand, website, marketing) | 0.25 FTE | 0.25 FTE | 0.25 FTE |
| **Total** | **1.75 FTE** | **3.25 FTE** | **3.75 FTE** |

### Infrastructure

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| npm registry | Free | Open-source package |
| GitHub Actions CI | Free | Open-source repo |
| Documentation hosting | $50-200 | Mintlify/Docusaurus + Vercel |
| Plugin registry hosting | $50-100 | Static site + API |
| Telemetry backend | $100-200 | Anonymous usage analytics |
| Domain + CDN | $50 | cantonctl.dev or similar |

---

## Risk Factors

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Canton SDK breaking changes | Medium | High | Pin SDK versions, maintain compatibility matrix |
| Low initial adoption | Medium | Medium | Co-marketing with Canton Foundation, video content |
| Plugin ecosystem doesn't take off | Medium | High | Ship 7+ first-party plugins to seed the ecosystem |
| Competing tool emerges | Low | Medium | First-mover advantage + plugin moat + community |
| Canton Network growth slower than expected | Medium | High | Tool also works for private Canton deployments |
| Key developer leaves | Low | High | Comprehensive docs, DI architecture, 98% test coverage make onboarding fast |

---

## Comparison: Where We Stand vs. Major Dev Tools

| Tool | Org | Funding | Team | Weekly Downloads | Plugins | Years |
|------|-----|---------|------|-----------------|---------|-------|
| Hardhat | Nomic Foundation | $15M+ confirmed ($30M target) | 15-25 | ~292K | 190+ | 5 |
| Foundry | Paradigm | $5-15M+ (internal) | 466 contributors | N/A (binary) | 20+ | 3 |
| Anchor | Coral (Jump Crypto) | $20M strategic round | Small team | ~15K | 10+ | 3 |
| Truffle | ConsenSys | $15-30M est. (of $725M+) | 10-20 est. | Sunset | Was 50+ | 7 (sunset) |
| **cantonctl** | **Merged One** | **Proposal pending** | **1** | **Published (v0.1.0)** | **Framework ready** | **0.5** |

**The opportunity:** Canton Network manages $6T+ in tokenized assets but has no developer CLI toolchain. cantonctl fills this gap with a codebase that's already at feature parity with tools that received $15-30M in funding. The investment required to reach ecosystem maturity is a fraction of what comparable tools cost because the core is already built.
