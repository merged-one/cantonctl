# cantonctl CLI — Demo Specification

## Demo Goal

Show a developer going from **zero to a running DeFi dApp on Canton in under 5 minutes**, using only the `cantonctl` CLI. The demo should make an EVM developer say: "That's what Hardhat is for Ethereum — I want that for Canton."

---

## Demo Flow (Live or Recorded, ~4 minutes)

### Scene 1: Install & Scaffold (30 seconds)

```bash
# Install globally
npm install -g cantonctl

# Scaffold a new DeFi project from the token template
cantonctl init my-token-app --template token

# Show what was generated
cd my-token-app && tree
```

**What the audience sees:**
- Clean CLI output with progress indicators
- Generated project structure printed as a tree
- Key files highlighted: `daml/Token.daml`, `test/Token.test.daml`, `cantonctl.yaml`, `frontend/`

### Scene 2: Local Dev Environment (60 seconds)

```bash
# Start local Canton node with hot-reload
cantonctl dev
```

**What the audience sees:**
- CLI spins up a lightweight Canton node (single participant)
- Auto-provisions parties from `cantonctl.yaml` (Alice, Bob, Admin)
- Displays: node URL, JSON API endpoint, provisioned parties
- Status dashboard in terminal showing node health

```
✓ Canton node running on localhost:5001
✓ JSON API on localhost:7575
✓ Parties provisioned: Alice, Bob, Admin
✓ Watching daml/ for changes...

Press [o] to open console  [s] to show status  [q] to quit
```

### Scene 3: Build & Test (45 seconds)

Open a second terminal:

```bash
# Compile Daml and generate TypeScript bindings
cantonctl build
```

**Output:**
```
✓ Compiled daml/Token.daml → .cantonctl/token-1.0.0.dar
✓ Package ID: abc123...def
✓ TypeScript bindings generated → frontend/src/generated/
```

```bash
# Run tests
cantonctl test
```

**Output:**
```
Running 4 tests from test/Token.test.daml...

  ✓ canMintTokens (0.3s)
  ✓ canTransferBetweenParties (0.4s)
  ✓ cannotTransferMoreThanBalance (0.2s)
  ✓ ownerCanBurn (0.3s)

4/4 passed in 1.2s
```

### Scene 4: Live Edit with Hot-Reload (45 seconds)

Edit `daml/Token.daml` — add a `Freeze` choice to the token contract.

**What the audience sees:**
- Save the file
- First terminal (running `cantonctl dev`) automatically detects the change:
  ```
  ⟳ Change detected in daml/Token.daml
  ✓ Recompiled → .cantonctl/token-1.0.0.dar
  ✓ Uploaded to local node
  ✓ TypeScript bindings regenerated
  ```
- No restart needed. The contract is live on the local node.

### Scene 5: Interactive Console (30 seconds)

```bash
cantonctl console
```

**What the audience sees:**
- REPL connected to the running local node
- Execute a transaction interactively:

```
canton> alice <- submit Alice do createCmd Token with owner = Alice, amount = 1000, symbol = "CTK"
Created contract: Token:abc123

canton> submit Alice do exerciseCmd @Token.Transfer alice with newOwner = Bob, transferAmount = 250
Exercised Transfer on Token:abc123 → new Token:def456 (Bob, 250 CTK)

canton> query @Token Bob
┌─────────┬───────┬────────┐
│ Owner   │ Amount│ Symbol │
├─────────┼───────┼────────┤
│ Bob     │ 250   │ CTK    │
└─────────┴───────┴────────┘
```

### Scene 6: Frontend (30 seconds)

```bash
# In the project directory, start the frontend
cd frontend && npm run dev
```

**What the audience sees:**
- React app running on localhost:3000
- Pre-wired `useCanton()` hook connected to the local JSON API
- UI shows Alice's token balance, a transfer form, and transaction history
- Execute a transfer through the UI — it hits the local Canton node in real-time

---

## What We Actually Build for the Demo

The demo requires building a **vertical slice** — not the full CLI, but enough to run this exact flow end-to-end. This is the Milestone 1 deliverable scoped to a demo-ready subset.

### Components to Build

#### 1. CLI Skeleton (`cantonctl` binary)
- **Tech:** TypeScript + [oclif](https://oclif.io/) (Salesforce's CLI framework, same as Heroku CLI)
- **Commands for demo:** `init`, `dev`, `build`, `test`, `console`
- **Scope:** Command routing, argument parsing, config loading from `cantonctl.yaml`

#### 2. `init` Command + Token Template
- Copies template files from bundled templates directory
- Substitutes project name in `cantonctl.yaml` and `daml.yaml`
- Runs `npm install` in frontend directory if template includes one
- **Template content to author:**
  - `Token.daml` — Daml contract with Mint, Transfer, Burn choices
  - `Token.test.daml` — 4 Daml Script tests
  - `cantonctl.yaml` — Config file (parties, network settings)
  - React frontend with `useCanton.ts` hook

#### 3. `dev` Command — Local Canton Node
- **Approach:** Wrap a Canton participant JAR or Docker image with a thin orchestration layer
- Starts single Canton participant node with in-memory storage
- Auto-provisions parties listed in `cantonctl.yaml` via Admin API
- Starts JSON API server
- Runs `chokidar` file watcher on `daml/` directory
- On change: recompile Daml, upload .dar via Admin API
- **Key decision:** Docker vs native binary
  - Docker is simpler to ship but adds startup time
  - Native binary (via dpm or bundled) is faster but platform-specific
  - **Recommendation for demo:** Docker with pre-pulled image; long-term support both

#### 4. `build` Command
- Shells out to `daml build` to compile .dar
- Extracts package ID from .dar metadata
- Runs `daml codegen js` to produce TypeScript bindings
- Copies bindings to `frontend/src/generated/`

#### 5. `test` Command
- Shells out to `daml test`
- Parses output and formats as structured pass/fail with timing
- Exit code 0/1 for CI compatibility

#### 6. `console` Command
- Lightweight REPL built on Node.js readline
- Translates shorthand commands to Ledger API gRPC calls
- `submit`, `query`, `parties` as built-in commands
- Table-formatted output using `cli-table3`

#### 7. Token Template Content

**Token.daml:**
```daml
module Token where

template Token
  with
    owner : Party
    symbol : Text
    amount : Decimal
  where
    signatory owner

    choice Transfer : (ContractId Token, ContractId Token)
      with
        newOwner : Party
        transferAmount : Decimal
      controller owner
      do
        assert (transferAmount > 0.0)
        assert (transferAmount <= amount)
        remaining <- create this with amount = amount - transferAmount
        transferred <- create Token with owner = newOwner, symbol, amount = transferAmount
        return (remaining, transferred)

    choice Burn : ()
      controller owner
      do return ()

    choice Mint : ContractId Token
      with
        mintAmount : Decimal
      controller owner
      do
        create this with amount = amount + mintAmount
```

**React useCanton hook (simplified):**
```typescript
import { useMemo, useState, useEffect } from 'react';

const LEDGER_URL = 'http://localhost:7575';

export function useCanton(party: string) {
  // Connect to JSON API, provide:
  // - query(templateId) -> contracts
  // - submit(command) -> result
  // - stream(templateId) -> live updates
}
```

---

## Demo Environment Requirements

| Component | Requirement |
|-----------|-------------|
| Node.js | >= 18 |
| Docker | For local Canton node |
| Daml SDK | Bundled or auto-installed by cantonctl |
| Browser | For frontend demo scene |
| Terminal | With color support (iTerm2 / Warp recommended for recording) |

---

## Success Criteria for the Demo

1. **End-to-end works:** `init` → `dev` → `build` → `test` → `console` → frontend — all run without errors
2. **Under 5 minutes:** The entire flow from `npm install -g cantonctl` to a transaction on the local node completes in under 5 minutes (ideally under 3, excluding Docker image pull)
3. **Zero manual config:** No editing of Docker files, no manual party provisioning, no auth setup
4. **Hot-reload works:** Edit a .daml file → see recompilation and re-upload without restarting
5. **EVM devs nod:** The workflow feels immediately familiar to someone who has used Hardhat or Foundry

---

## Estimated Demo Build Timeline

| Week | Focus |
|------|-------|
| 1 | CLI skeleton (oclif), `init` command, Token.daml template |
| 2 | `dev` command — Canton node orchestration, party provisioning, file watcher |
| 3 | `build` command (Daml compilation + codegen), `test` command (structured output) |
| 4 | `console` REPL, React frontend template with `useCanton` hook |
| 5 | Integration testing, polish CLI output, record demo video |
| 6 | Buffer / documentation / edge cases |

---

## Open Questions

1. **Canton binary distribution:** Can we bundle the Canton participant as a native binary (via dpm), or must we require Docker? This significantly affects cold-start time.
2. **Daml SDK dependency:** Should cantonctl auto-install the Daml SDK if missing, or require it as a prerequisite? Auto-install is better DX but adds complexity.
3. **JSON API vs gRPC:** The frontend template uses JSON API for simplicity. Should the console use gRPC directly for richer functionality?
4. **Template registry:** For the demo we bundle templates. For Milestone 3, should templates live in a separate repo (like `create-react-app` templates) or in-repo?
5. **Relationship to cn-quickstart:** Should `cantonctl dev --full` delegate to cn-quickstart for multi-node setups? Or keep them fully separate tools?
