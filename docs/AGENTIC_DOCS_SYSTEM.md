# cantonctl Agentic Documentation System

> A documentation architecture designed for critical financial infrastructure, advancing beyond current state of the art by treating documentation as a living, testable, dual-audience system with autonomous maintenance agents.

---

## The Problem We're Solving

Canton is critical financial infrastructure ($6T+ tokenized assets, $350B+ daily volume). Documentation errors in this context can lead to:
- Misconfigured nodes exposing private transaction data
- Incorrect JWT setup allowing unauthorized ledger access
- Wrong deployment procedures causing package vetting failures
- Misunderstood privacy boundaries leaking party information

Current SOTA documentation systems (Mintlify, Swimm, GitBook) solve staleness detection and AI search, but none are designed for systems where **documentation correctness is a safety property**.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                   DOCUMENTATION LAYERS                    │
├──────────────┬───────────────┬──────────────┬────────────┤
│  Reference   │    Task       │  Concept     │ Trouble-   │
│  (generated) │  (curated)    │  (authored)  │ shooting   │
│              │               │              │ (indexed   │
│  from code   │  tested in CI │  reviewed    │  by error) │
├──────────────┴───────────────┴──────────────┴────────────┤
│                    QUALITY GATES (CI)                      │
│  Vale lint │ Doc tests │ Link check │ Staleness detect    │
├──────────────────────────────────────────────────────────┤
│                 AGENT LAYER (autonomous)                   │
│  Drift Agent │ Test Agent │ Translation Agent │ PR Agent  │
├──────────────────────────────────────────────────────────┤
│               DUAL-AUDIENCE DELIVERY                      │
│  Human: web/CLI │ AI: MCP server + llms.txt │ IDE: LSP   │
└──────────────────────────────────────────────────────────┘
```

---

## Layer 1: Content Taxonomy (from Kubernetes, adapted for CLI tools)

Every documentation page has exactly one type. This rigid taxonomy sets clear expectations for what each page contains and what it does NOT contain.

### Reference (Auto-Generated)

Generated directly from cantonctl source code. **Cannot drift from implementation.**

**How it works:**
- oclif commands define their own flags, arguments, and descriptions in TypeScript
- A build step extracts command metadata and generates Markdown reference pages
- Like Terraform's `terraform-plugin-docs`: the code IS the documentation source
- Generated on every commit via CI; human edits to reference docs are overwritten

**Example generation pipeline:**
```
src/commands/deploy.ts (oclif command definition)
  → extract: name, description, flags, args, examples, aliases
  → generate: docs/reference/deploy.md
  → validate: generated doc matches command --help output
```

**What this produces:**
```markdown
---
type: reference
generated: true
source: src/commands/deploy.ts
command: cantonctl deploy
---

# cantonctl deploy

Deploy a .dar package to a Canton network.

## Usage
cantonctl deploy [NETWORK] [--dar PATH] [--party PARTY]

## Arguments
| Argument | Description | Required | Default |
|----------|-------------|----------|---------|
| NETWORK  | Target network (local, devnet, testnet, mainnet) | No | local |

## Flags
| Flag | Description | Type | Default |
|------|-------------|------|---------|
| --dar | Path to .dar file | string | .cantonctl/dist/*.dar |
| --party | Deploying party | string | from cantonctl.yaml |
| --dry-run | Simulate without deploying | boolean | false |

## Examples
$ cantonctl deploy devnet
$ cantonctl deploy testnet --dar ./my-app.dar --party Alice
```

### Task (Curated, Tested)

Short, focused procedures for accomplishing a single goal. Each task is **executable as a test.**

**Key rule:** Tasks contain commands and expected outcomes. These are extracted and run as integration tests in CI. If the task fails, the docs are broken.

```markdown
---
type: task
title: Transfer tokens between parties
prerequisites: [concepts/parties, concepts/tokens]
tested: true
test-env: sandbox
---

# Transfer tokens between parties

## Prerequisites
- A running local environment (`cantonctl dev`)
- A project with the `token` template

## Steps

<!-- doctest:begin -->
1. Create a token for Alice:
   ```bash
   cantonctl exec --party Alice "createCmd Token with owner = Alice, amount = 1000, symbol = CTK"
   ```
   Expected output: `Created: Token#<id>`

2. Transfer 250 tokens to Bob:
   ```bash
   cantonctl exec --party Alice "exerciseCmd Token#<id> Transfer with newOwner = Bob, transferAmount = 250"
   ```
   Expected output: `Exercised Transfer`

3. Verify Bob received tokens:
   ```bash
   cantonctl exec --party Bob "query Token"
   ```
   Expected output contains: `amount = 250`
<!-- doctest:end -->
```

**The `doctest` blocks are extracted and run as integration tests.** This is the "docs-as-tests" pattern from Doc Detective, applied to CLI documentation. If a cantonctl update changes the output format, the doc test fails, and the PR is blocked.

### Concept (Authored, Reviewed)

Explanations of Canton concepts for developers transitioning from other ecosystems. No commands, no step-by-step instructions — only understanding.

```markdown
---
type: concept
title: Canton's Party-Based Privacy Model
audience: [evm-developer, new-to-canton]
related: [concepts/sync-domains, concepts/ledger-api]
---

# Canton's Party-Based Privacy Model

If you're coming from Ethereum, the biggest shift is this: on Ethereum,
everyone sees everything. On Canton, nobody sees anything unless they're
a stakeholder in that specific contract.

## EVM vs Canton Mental Model

| What you know from EVM | How Canton differs |
|------------------------|--------------------|
| Global state, all nodes see all data | Need-to-know: only stakeholders see their data |
| Pseudonymous addresses | Named parties with legal identity |
| All validators execute all transactions | Only involved parties validate |
...
```

### Troubleshooting (Error-Indexed)

Every cantonctl error code maps to a troubleshooting page. When a user hits an error, the CLI prints a link to the exact resolution page.

```markdown
---
type: troubleshooting
error-code: CANTONCTL_E1042
error-message: "Package vetting failed: KNOWN_DAR_VERSION"
severity: blocking
---

# CANTONCTL_E1042: Package vetting failed

## What happened
You tried to upload a .dar with a package name and version that already
exists on the target participant node. Canton enforces unique
name/version pairs.

## How to fix
1. Increment the version in `daml.yaml`:
   ```yaml
   version: 1.0.1  # was 1.0.0
   ```
2. Rebuild and redeploy:
   ```bash
   cantonctl build && cantonctl deploy
   ```

## Why this exists
Canton's Smart Contract Upgrades (SCU) require version monotonicity...
```

**CLI integration:**
```
$ cantonctl deploy devnet
Error CANTONCTL_E1042: Package vetting failed: KNOWN_DAR_VERSION
  → https://docs.cantonctl.dev/troubleshooting/E1042
  → Quick fix: increment version in daml.yaml, then rebuild
```

---

## Layer 2: Quality Gates (CI Pipeline)

Documentation changes go through the same rigor as code changes. This is inspired by Kubernetes SIG Docs and Stripe's "docs = done" culture.

### Gate 1: Prose Linting (Vale)

Custom Vale style rules for critical infrastructure documentation:

```yaml
# .vale/styles/cantonctl/SecurityWarning.yml
extends: existence
message: "Security-sensitive operation '%s' must include a warning callout"
level: error
scope: raw
tokens:
  - "private key"
  - "JWT token"
  - "authentication"
  - "--insecure"
```

```yaml
# .vale/styles/cantonctl/PartyPrivacy.yml
extends: existence
message: "Documentation mentioning '%s' must clarify privacy implications"
level: warning
scope: raw
tokens:
  - "all parties"
  - "broadcast"
  - "public"
```

### Gate 2: Doc Tests (Executable Documentation)

```yaml
# .github/workflows/doc-tests.yml
doc-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm install -g cantonctl
    - run: cantonctl dev --background
    - run: npx doctest-runner docs/**/*.md
    - run: cantonctl dev --stop
```

The `doctest-runner` extracts `<!-- doctest:begin -->` blocks from Markdown, executes commands, and validates expected outputs. If any documented procedure doesn't work against the current cantonctl version, CI fails.

### Gate 3: Reference Drift Detection

```yaml
# .github/workflows/reference-drift.yml
reference-check:
  runs-on: ubuntu-latest
  steps:
    - run: npm run generate-docs
    - run: git diff --exit-code docs/reference/
    # If generated docs differ from committed docs, fail.
    # This catches: new flags added without doc regeneration,
    # flag descriptions changed in code but not in docs, etc.
```

### Gate 4: Mandatory Docs for CLI Changes

```yaml
# .github/workflows/docs-required.yml
docs-required:
  if: contains(github.event.pull_request.changed_files, 'src/commands/')
  steps:
    - run: |
        # If any command file changed, docs/ must also have changes
        if ! echo "${{ github.event.pull_request.changed_files }}" | grep -q "docs/"; then
          echo "::error::CLI command changes require documentation updates"
          exit 1
        fi
```

---

## Layer 3: Autonomous Agent Pipeline

This is where we advance beyond current SOTA. Mintlify Autopilot and GitBook Agent detect drift and propose updates. We go further: agents that **test** their own proposals before submitting them.

### Agent 1: Drift Detector

**Trigger:** Any commit that modifies `src/commands/`, `src/config/`, or `cantonctl.yaml` schema.

**Behavior:**
1. Regenerate reference docs from source
2. Run semantic diff against current docs (not just text diff — understand if meaning changed)
3. For each affected doc page, check if any Task docs reference the changed functionality
4. Create a GitHub issue listing all docs that need human review
5. Auto-fix reference docs (they're generated anyway)
6. For Task/Concept docs, create a draft PR with suggested updates

**Beyond SOTA:** Current tools (Mintlify, Swimm) detect drift via code monitoring. Our agent also runs the doc tests after proposing changes, ensuring suggestions are correct before requesting human review.

### Agent 2: Doc Test Runner (Self-Healing)

**Trigger:** Nightly, or on any PR that touches `src/`.

**Behavior:**
1. Extract all `doctest` blocks from documentation
2. Spin up a cantonctl sandbox
3. Execute each doctest block
4. If a test fails:
   a. Analyze the error (expected output changed? command syntax changed? new flag required?)
   b. Attempt to fix the documentation (update expected output, add new required flags)
   c. Re-run the test with the fix
   d. If the fix passes, open a PR with the correction
   e. If the fix fails, open an issue flagging the docs as broken

**Beyond SOTA:** Current tools flag stale docs. Our agent fixes them and validates the fix before requesting review. This is the "self-healing CI" pattern from Nx Cloud, applied to documentation.

### Agent 3: Error-to-Doc Agent

**Trigger:** New error code added to cantonctl source, OR error reported in GitHub Issues without a troubleshooting page.

**Behavior:**
1. Detect new error codes in source that don't have corresponding troubleshooting pages
2. Analyze the error context (what triggers it, what the user was trying to do)
3. Generate a draft troubleshooting page with: what happened, how to fix it, why it exists
4. Open a PR for review

**Beyond SOTA:** No current documentation tool automatically generates troubleshooting pages from error codes. This inverts the typical flow: instead of users searching for help after hitting an error, the documentation is pre-written before any user encounters it.

### Agent 4: Audience Adapter

**Trigger:** On documentation build, or on-demand via MCP query.

**Behavior:**
- Concept pages tagged with `audience: [evm-developer]` get EVM comparison tables auto-generated
- Task pages get difficulty ratings based on prerequisite chain depth
- Troubleshooting pages get frequency ratings based on GitHub Issue volume

**Beyond SOTA:** Current tools serve one version of docs to everyone. This agent enriches docs with audience-specific context without maintaining separate doc versions.

---

## Layer 4: Dual-Audience Delivery

Documentation is consumed by two audiences: humans and AI agents. Both must be first-class.

### Human Delivery

**Web (docs.cantonctl.dev):**
- Built with a docs framework (Mintlify, Docusaurus, or Starlight)
- Kubernetes-style taxonomy: left nav organized by type (Concepts, Tasks, Reference, Troubleshooting)
- Search powered by the docs framework's AI search
- Version selector tied to cantonctl releases

**CLI (`cantonctl docs`):**
- `cantonctl docs deploy` opens the deploy reference page in browser
- `cantonctl docs search "transfer tokens"` searches docs from terminal
- Error messages include direct links to troubleshooting pages
- `--help` output is generated from the same source as web reference docs (single source of truth)

### AI Agent Delivery

**MCP Server (`@cantonctl/mcp-docs`):**

```typescript
// Tools exposed via MCP
{
  "cantonctl_lookup": {
    description: "Search cantonctl documentation by topic",
    parameters: { query: string, type?: "concept" | "task" | "reference" | "troubleshooting" }
  },
  "cantonctl_error_help": {
    description: "Get troubleshooting help for a cantonctl error code",
    parameters: { errorCode: string }
  },
  "cantonctl_evm_compare": {
    description: "Compare an EVM concept to its Canton equivalent",
    parameters: { evmConcept: string }
  },
  "cantonctl_task_steps": {
    description: "Get step-by-step instructions for a cantonctl task",
    parameters: { taskName: string }
  }
}
```

This builds on the Build-on-Canton MCP pattern but is specific to cantonctl and auto-synced with the documentation source.

**llms.txt:**
```
# cantonctl
> Institutional-grade CLI for building on Canton Network

## Docs
- [Getting Started](https://docs.cantonctl.dev/tasks/getting-started): Install cantonctl and create your first project
- [Command Reference](https://docs.cantonctl.dev/reference): Complete CLI reference
- [Canton for EVM Devs](https://docs.cantonctl.dev/concepts/evm-comparison): Canton concepts mapped to EVM equivalents
- [Troubleshooting](https://docs.cantonctl.dev/troubleshooting): Error codes and resolutions

## API
- [Plugin API](https://docs.cantonctl.dev/reference/plugin-api): How to extend cantonctl
- [Config Schema](https://docs.cantonctl.dev/reference/config-schema): cantonctl.yaml specification
```

**Content Negotiation (from Cloudflare Workers pattern):**
- `Accept: text/markdown` returns raw Markdown (for AI agents)
- `Accept: text/html` returns rendered page (for humans/browsers)
- `/docs/reference/deploy.md` serves Markdown directly (for LLM context windows)

### IDE Delivery

**VS Code / IDE integration:**
- cantonctl.yaml provides a JSON Schema that IDEs consume for autocomplete and validation
- Error diagnostics in Daml files link to cantonctl troubleshooting pages
- Hover documentation for cantonctl.yaml fields shows concept explanations

---

## Layer 5: Documentation-Driven Development Process

This is the cultural/process layer, inspired by Stripe's "docs = done" philosophy.

### The Rule

**A cantonctl feature is not shipped until:**
1. Reference docs are auto-generated and pass drift detection
2. At least one Task doc demonstrates the feature with a working doctest
3. Any new error codes have troubleshooting pages
4. If the feature affects Canton concepts (privacy, parties, sync domains), a Concept doc is updated or created
5. All quality gates pass in CI

### The Workflow

```
1. Developer writes feature code
2. Developer writes/updates docs alongside code
3. CI validates:
   - Reference docs regenerated and match code
   - Doc tests pass against new feature
   - Vale linting passes
   - Links valid
   - Docs-required check passes
4. Agents run:
   - Drift detector confirms no stale pages
   - Doc test runner verifies all existing doctests still pass
   - Error-to-doc agent generates any missing troubleshooting pages
5. Human reviewer approves code + docs together
6. Merge
```

### Why This Matters for Critical Infrastructure

In traditional software, stale docs are annoying. In financial infrastructure:
- A stale deploy guide could cause a production outage
- An incorrect JWT setup doc could create a security vulnerability
- A wrong privacy explanation could lead to regulatory non-compliance

Documentation-driven development ensures that the documentation IS the specification. If the CLI doesn't match the docs, the CLI has a bug — not the docs.

---

## What Makes This Beyond State of the Art

| Capability | Current SOTA | cantonctl Docs System |
|-----------|-------------|----------------------|
| **Drift detection** | Mintlify Autopilot monitors repos | + Agents run doc tests to validate fixes before PR |
| **Code coupling** | Swimm smart tokens link to code entities | + Reference docs generated FROM code, cannot drift |
| **AI delivery** | MCP servers auto-generated by Mintlify/GitBook | + Structured by content type, error-indexed, audience-tagged |
| **Quality gates** | Vale linting, link checking | + Executable doc tests, mandatory docs for CLI changes, drift blocking |
| **Self-healing** | Nx Cloud fixes CI failures | + Doc test runner auto-fixes docs and validates the fix |
| **Error documentation** | Manual per-error pages | + Agent auto-generates troubleshooting from error codes in source |
| **Audience adaptation** | Different doc versions | + Same doc, enriched with audience-specific context (EVM comparisons) |
| **Critical infra safety** | Versioned docs per release | + Documentation correctness as a CI-blocking safety property |
| **Documentation testing** | Doc Detective runs documented procedures | + Integrated into content taxonomy (Task docs ARE tests) |

The fundamental advance: **documentation is not a byproduct of development — it is a testable, verifiable safety property of the system.**
