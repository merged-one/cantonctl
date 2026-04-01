# cantonctl playground

A Remix-like browser IDE for Canton development. Opens a Monaco editor with Daml syntax highlighting, dynamic contract interaction forms, and live contract state — all running locally on your machine.

## Usage

```bash
cantonctl playground                   # Open at localhost:4000
cantonctl playground --port 8080       # Custom port
cantonctl playground --no-open         # Don't auto-open browser
cantonctl playground --no-sandbox      # Connect to existing sandbox
```

## What It Solves

Every feature maps to a pain point from the Q1 2026 Canton Developer Experience Survey:

| Survey Finding | Playground Solution |
|---|---|
| 41% cited environment setup as longest to get right | One command starts sandbox + IDE. Zero config. |
| Package ID discovery for JSON API described as opaque | Dynamic forms auto-generated from Daml source. No package IDs anywhere. |
| JWT authentication middleware — repeated friction | Auth handled invisibly. Tokens generated with correct `sub` + `userId`. |
| Developers struggle to read on-ledger data | Contracts display live in the UI, filtered by active party. |
| Web3.js equivalent and wallet connectors missing | `cantonctl serve` provides a documented REST + WebSocket API. |

## Features

### Dynamic Template Discovery

The playground parses your `.daml` source files and auto-generates typed forms for every template and choice. No hardcoded UIs.

- **Party fields** render as dropdowns populated from the sandbox
- **Text/Decimal fields** render as text inputs with type labels
- **Choices** render as expandable forms with typed argument inputs
- **Consuming choices** are color-coded orange, non-consuming blue

The parser (`src/lib/daml-parser.ts`) extracts template names, fields with types, choice signatures, signatories, and controllers using regex patterns verified against all 5 cantonctl scaffold templates.

### Multi-Party Split View

Side-by-side view showing two parties' perspectives simultaneously. Toggle between Editor and Multi-Party views in the header.

- Each column has an independent party selector
- Contracts visible to both parties show an eye icon (shared)
- Contracts visible to only one party show an eye-off icon (private)
- Stats bar shows shared vs private contract counts

This is Canton's differentiator made tangible — no other blockchain IDE can show party-scoped privacy.

### Monaco Editor with Daml Highlighting

Full VS Code editor experience with custom Daml syntax highlighting:

- Keywords: `template`, `with`, `where`, `choice`, `controller`, `signatory`, `do`, `create`, `exercise`
- Types: `Party`, `Text`, `Decimal`, `ContractId`, `Optional`, `Bool`
- Multi-tab editing with Ctrl+S save (triggers auto-rebuild)
- Line numbers, bracket matching, word wrap

### Build and Test

- **Build button** — compiles Daml, auto-uploads DAR to sandbox
- **Test button** — runs Daml Script tests, shows pass/fail
- **Auto-build on save** — editing a `.daml` file and saving triggers rebuild
- **WebSocket streaming** — build/test status appears in real-time terminal

## Architecture

```
Browser (React + Monaco)          cantonctl backend (Express + WS)
========================          ==================================
File Explorer            <--HTTP-> File tree + read/write
Monaco Editor            <--HTTP-> File operations (auto-build on .daml save)
Dynamic Create Form      <--HTTP-> /api/templates (Daml parser)
Contract List            <--HTTP-> /api/contracts (Canton V2 ACS query)
Choice Exercise          <--HTTP-> /api/commands (Canton V2 submit)
Party Selector           <--HTTP-> /api/parties
Terminal Output          <--WS---> Build/test/contract events
Split View               <--HTTP-> /api/contracts/multi
```

The browser is just the UI — all compilation, sandbox execution, and ledger interaction happens on the local machine via the existing Daml SDK.

### Canton IDE Protocol

The playground runs on top of `cantonctl serve`, a documented REST + WebSocket API. The same protocol supports:

- **Browser playground** (`cantonctl playground`) — serves React UI + API
- **Headless mode** (`cantonctl serve`) — API only, no UI
- **VS Code extension** (planned) — connects to a running serve instance
- **Any IDE client** — documented at [docs/reference/serve.md](serve.md)

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--port`, `-p` | 4000 | Playground server port |
| `--json-api-port` | 7575 | Canton JSON Ledger API port |
| `--sandbox-port` | 5001 | Canton sandbox port |
| `--no-open` | false | Don't auto-open browser |
| `--no-sandbox` | false | Connect to existing sandbox |

## Workflow

1. `cantonctl playground` — sandbox starts, browser opens
2. Click **Build** — Daml compiles, DAR uploads to sandbox
3. Select **party** — contract list activates for that party
4. Fill **create form** — dynamic fields from template metadata
5. Click **Create** — contract appears in contract list
6. Click **contract** — expand to see payload + exercise choices
7. Switch to **Multi-Party** — see two parties' views side by side

## Canton V2 API Compatibility

The playground handles all Canton V2 JSON Ledger API quirks internally:

- `userId: 'admin'` in submit-and-wait requests
- `sub` claim in JWT tokens via `.setSubject('admin')`
- `#packageName:Module:Template` format for template IDs
- `identifierFilter` with `WildcardFilter` nested format for active contracts
- `activeAtOffset` from `/v2/state/ledger-end` for ACS queries
- `JsActiveContract.createdEvent.createArgument` response normalization
