# cantonctl Design Decisions

> Every decision here is justified by evidence from our research across 16 blockchain CLI toolchains, 7 AI documentation platforms, 5 critical infrastructure documentation standards, and the Canton developer ecosystem survey (n=41).

---

## Decision 1: TypeScript CLI with oclif Framework

**Choice:** TypeScript on oclif, not Go/Cobra, not Rust/Clap.

**Evidence:**

| Factor | oclif (TS) | Cobra (Go) | Clap (Rust) |
|--------|-----------|------------|-------------|
| Plugin system | Production-proven (npm-based, lazy loading, hooks) | None formal | None formal |
| Target audience match | 71% of Canton devs are EVM (JS/TS ecosystem) | Infra/DevOps audience | Performance-critical |
| Enterprise precedent | Salesforce CLI, Heroku, Twilio, Shopify | kubectl, terraform, docker | Railway CLI, ripgrep |
| Startup time | ~85ms (acceptable) | <5ms (fastest) | <5ms (fastest) |
| Extensibility | Best-in-class plugin marketplace | Requires embedding | Requires forking |

**Why not Go?** Go/Cobra is the obvious choice for infrastructure tooling (kubectl, terraform). But cantonctl's primary audience is DeFi developers from EVM, where TypeScript dominates. The plugin system is non-negotiable — Hardhat's HRE plugin architecture is the single biggest factor in its market dominance over Foundry, despite Foundry being faster. Only oclif provides a production-proven plugin system in the JS/TS ecosystem.

**Why not Rust?** Foundry proved Rust wins on raw speed. But Foundry also proved that without a plugin system, extensibility requires forking. Hardhat 3 responded by putting performance-critical paths in Rust (EDR) while keeping the plugin/DX layer in TypeScript. We follow the same hybrid pattern: TypeScript for the user-facing layer, with the option to write performance-critical operations (Daml compilation wrappers, file watching) as native addons or subprocesses.

**Counter-argument acknowledged:** 85ms startup is perceptible vs Go's <5ms. We accept this tradeoff because cantonctl is a development tool invoked dozens of times per day, not a system utility invoked thousands of times. kubectl at 100-200ms is considered fast.

**Lesson from failures:**
- Truffle (JS, no plugin flex) lost to Hardhat (JS, excellent plugins)
- Brownie (Python) died because the language was niche for its audience
- Foundry (Rust, no plugins) dominates audit/security but can't match Hardhat's ecosystem breadth

---

## Decision 2: Hardhat-Style Plugin Architecture (not monolithic)

**Choice:** oclif npm-based plugin system with a Hardhat-inspired runtime environment.

**Evidence from 16 toolchains:**
- Only 3 of 16 toolchains have any plugin system (Hardhat, Ignite, Taqueria)
- Hardhat's plugin ecosystem (hundreds of plugins) is its primary competitive moat
- Foundry proved monolithic can win on speed — but Canton needs community-contributed extensions for a niche ecosystem
- Ignite's App marketplace shows a lighter-weight approach that works for smaller communities

**Architecture:**

```
cantonctl runtime environment (CRE)
├── Core commands (init, dev, build, test, deploy, console)
├── Plugin hooks (beforeBuild, afterDeploy, onError, etc.)
├── Config resolution (project > user > global > env > flags)
└── Plugin discovery (npm packages matching @cantonctl/plugin-* or cantonctl-plugin-*)
```

**Why plugins matter for Canton specifically:**
1. Canton's ecosystem has fragmented community tools (ChainSafe MCP, Lighthouse MCP, CCView API, Tenzro DAML Studio). Plugins let them integrate without forking cantonctl.
2. Enterprise users will want custom deployment validators, compliance checks, and audit hooks. A plugin system lets them extend without modifying core.
3. Zenith EVM integration means EVM-specific tooling (Hardhat compatibility, Solidity support) should be a plugin, not core.

---

## Decision 3: YAML Configuration with JSON Schema Validation

**Choice:** `cantonctl.yaml` with JSON Schema, hierarchical resolution.

**Evidence:**
- YAML is the standard in Canton's ecosystem (canton config, daml.yaml, Docker Compose, Kubernetes)
- TOML would be technically cleaner (strict typing) but violates user expectations
- JSON Schema validation catches config errors at load time with actionable messages
- Hierarchical resolution follows the established pattern: `cantonctl.yaml` (project) > `~/.config/cantonctl/config.yaml` (user) > `CANTONCTL_*` env vars > CLI flags

**Config schema example:**

```yaml
# cantonctl.yaml
version: 1
project:
  name: my-defi-app
  sdk-version: "3.4.9"

parties:
  - name: Alice
    role: operator
  - name: Bob
    role: participant

networks:
  local:
    type: sandbox
    port: 5001
    json-api-port: 7575
  devnet:
    type: remote
    url: https://devnet.canton.network
    auth: jwt

plugins:
  - "@cantonctl/plugin-zenith"  # EVM integration
  - "@cantonctl/plugin-ccview"  # Block explorer integration
```

**Why not hardhat.config.ts (code-as-config)?** Hardhat uses executable TypeScript config. This is powerful but creates security risks for a tool managing critical infrastructure. YAML is declarative, auditable, and can't execute arbitrary code at load time. For dynamic needs, plugins provide the escape hatch.

---

## Decision 4: Lightweight Local Dev (Sandbox-First, Docker-Optional)

**Choice:** `cantonctl dev` wraps `dpm sandbox` for zero-Docker local development, with Docker as an opt-in for full multi-node topologies.

**Evidence:**

| Approach | Used By | Startup | Docker Required | Realism |
|----------|---------|---------|-----------------|---------|
| In-process simulation | Hardhat EDR | <1s | No | Medium |
| Standalone sandbox | dpm sandbox, Anvil | 2-5s | No | High |
| Docker orchestration | cn-quickstart, Aztec | 30-120s | Yes (8GB+ RAM) | Highest |
| Hot-reload chain | Ignite CLI | 5-10s | No | Medium-High |

**The cn-quickstart problem:** The survey's #1 pain point (41%) is that developers must become infrastructure engineers before building. cn-quickstart requires Docker Desktop with 8GB+ RAM, Nix, Gradle, and JDK 21. Aztec's Docker requirement is similarly cited as its main friction point.

**Our approach:**
1. **Default (`cantonctl dev`):** Wraps `dpm sandbox` — starts a single Canton participant with in-memory storage. No Docker. Starts in seconds.
2. **Full mode (`cantonctl dev --full`):** Orchestrates a multi-node setup via Docker Compose (similar to cn-quickstart but managed by cantonctl). For when you need realistic multi-party topology.
3. **Hot-reload:** File watcher (chokidar) detects Daml changes, recompiles, and uploads .dar to the running sandbox. Inspired by Ignite CLI's `chain serve`.

**Key insight from Foundry/Anvil:** Anvil starts a local Ethereum node in <1 second with zero config. That's the bar we're targeting for `cantonctl dev`.

---

## Decision 5: Template System with Community Registry

**Choice:** Bundled templates for common patterns + `--from <github-url>` for community templates.

**Evidence from scaffolding spectrum:**

| Tool | Scaffolding Level | Outcome |
|------|-------------------|---------|
| Ignite CLI | "Scaffold everything" | Powerful for onboarding, teams outgrow it |
| Anchor | Full workspace | Good balance |
| Foundry | Minimal (src/test/script) | Works because core tool is excellent |
| Pop CLI | Template marketplace | Growing adoption |
| Aptos | Package only | Too minimal for beginners |

**Our templates (bundled):**

| Template | Target | Content |
|----------|--------|---------|
| `basic` | First-time Canton developer | Minimal Daml contract + test + cantonctl.yaml |
| `token` | DeFi builder starting with tokens | Token contract with Mint/Transfer/Burn + React frontend |
| `defi-amm` | DeFi builder doing AMM | Liquidity pool + swap contracts + TypeScript SDK usage |
| `api-service` | Backend developer | Express.js service consuming Ledger API |
| `zenith-evm` | EVM developer via Zenith | Solidity contract deployed through Zenith + Hardhat config |

**Community registry:** `cantonctl init --from https://github.com/user/template` clones any repo with a `cantonctl-template.yaml` manifest. This follows Foundry's community template pattern but with a manifest file for validation.

**Why not a centralized registry?** Canton's developer community is small (41 survey respondents). A centralized npm-like registry would be premature. GitHub URLs with convention-over-configuration is sufficient. We can add a registry later when the community grows.

---

## Decision 6: Testing as Core Value Proposition

**Choice:** First-class testing with structured output, coverage, and Canton-specific test primitives.

**Evidence:** Every successful blockchain CLI makes testing excellent. It's the #1 feature developers evaluate.

| Tool | Testing Killer Feature |
|------|----------------------|
| Foundry | Fuzz testing + invariant testing + cheatcodes |
| Hardhat | Solidity stack traces + console.log in contracts |
| Anchor | IDL-generated TypeScript test clients |
| Aptos | Move Prover (formal verification) |
| Starknet Foundry | Fork testing against live state |

**cantonctl test features:**

1. **Structured output:** Pass/fail with timing, formatted for both humans and CI (`--json` flag)
2. **Canton cheatcodes:** Test-only primitives like `advanceTime`, `impersonateParty`, `setContractState` — inspired by Foundry's `vm.*` cheatcodes
3. **Multi-party test scenarios:** First-class support for testing privacy boundaries (can Alice see Bob's contract?)
4. **Coverage reporting:** Which Daml templates and choices are exercised by tests
5. **Snapshot testing:** Gas/resource usage snapshots that break CI when costs change unexpectedly (from Foundry's `forge snapshot`)

**Why not fuzz testing initially?** Daml's strong type system and the party-based authorization model make certain classes of bugs (overflow, reentrancy) structurally impossible. Fuzz testing is less critical than in EVM. We'll add property-based testing in a later milestone.

---

## Decision 7: Dual-Interface Console (REPL + Scripting)

**Choice:** Interactive REPL for exploration + scripting mode for automation, inspired by Foundry's Chisel + Cast split.

**Evidence:**
- Foundry splits interactive (Chisel REPL) from scripted (Cast CLI) interaction
- Hardhat provides `npx hardhat console` with full HRE access
- Canton console already exists but is Scala-based and requires JVM knowledge

**cantonctl console:**
```
canton> parties
┌────────┬──────────────────────────────┐
│ Name   │ ID                           │
├────────┼──────────────────────────────┤
│ Alice  │ Alice::12345...              │
│ Bob    │ Bob::67890...                │
└────────┴──────────────────────────────┘

canton> submit Alice createCmd Token with owner = Alice, amount = 1000
Created: Token#abc123

canton> query Token --party Bob
(empty — Bob has no Token contracts)
```

**cantonctl exec (scripting):**
```bash
# CI/automation usage
cantonctl exec --party Alice "createCmd Token with owner = Alice, amount = 1000"
cantonctl exec --party Alice "exerciseCmd Token#abc123 Transfer with newOwner = Bob, amount = 250"
```

---

## Decision 8: Environment-Aware Deploy Pipeline

**Choice:** `cantonctl deploy <network>` with guided authentication, network-specific config, and pre-deployment validation.

**Evidence from Canton ecosystem research:**
- 5 environment tiers (LocalNet -> ScratchNet -> DevNet -> TestNet -> MainNet) each with different access patterns
- JWT authentication is a known pain point (multiple token types, signing algorithms)
- Package ID management is opaque (content-hash based, version resolution is complex)
- DevNet requires IP whitelisting with 2-7 day wait

**Deploy pipeline:**
```
cantonctl deploy devnet
  ├── 1. Validate: cantonctl.yaml config matches target network
  ├── 2. Build: Compile Daml, generate .dar
  ├── 3. Auth: Guide through JWT setup (or use saved credentials)
  ├── 4. Pre-flight: Check package compatibility, estimate resources
  ├── 5. Upload: Upload .dar to participant node(s)
  ├── 6. Vet: Trigger package vetting
  └── 7. Verify: Confirm deployment via status query
```

**Why guided auth?** The survey explicitly cited JWT authentication as a friction point. cantonctl should handle the common cases (generate a dev JWT for local, guide through IdP setup for remote) and store credentials securely in the OS keychain (following NEAR CLI's pattern).

---

## Decision 9: Multi-Channel Distribution

**Choice:** npm (primary) + Homebrew + standalone binary.

**Evidence:**
- Foundry's `foundryup` and Starknet's `starkup` prove single-command install is critical
- npm reach covers the 71% EVM developer audience
- Homebrew covers macOS developers (Canton's likely primary platform for dev)
- Standalone binary (via oclif packaging) serves CI/CD and non-Node environments

**Distribution plan:**

```bash
# Primary: npm
npm install -g cantonctl
# or for one-off use:
npx cantonctl init my-app

# macOS:
brew install merged-one/tap/cantonctl

# Standalone (CI/Docker):
curl -fsSL https://get.cantonctl.dev | bash
```

---

## Decision 10: Hybrid Architecture for Performance

**Choice:** TypeScript CLI shell with native subprocesses for heavy operations.

**Evidence:** Hardhat 3 proved the pattern — rewrote the Ethereum Development Runtime (EDR) in Rust while keeping the plugin/DX layer in TypeScript. This gives the best of both worlds.

**cantonctl performance architecture:**
- **TypeScript:** Command parsing, config resolution, plugin system, output formatting, interactive prompts, file watching
- **Native subprocess:** `dpm build` (Daml compilation), `dpm test` (test execution), Canton sandbox process, Docker orchestration
- **Future native addon (optional):** If hot-reload latency becomes a bottleneck, the file watcher + Daml compile trigger can be moved to a native addon

**Key principle:** Never rewrite what `dpm` already does well. cantonctl orchestrates and extends, it doesn't replace the Daml SDK.
