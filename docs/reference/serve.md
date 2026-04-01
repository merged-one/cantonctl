# cantonctl serve

Starts the Canton IDE Protocol server, a headless REST + WebSocket API that any IDE client can connect to.

## Usage

```bash
cantonctl serve                     # Start at localhost:4000
cantonctl serve --port 8080         # Custom port
cantonctl serve --no-sandbox        # Connect to existing sandbox
cantonctl serve --json              # Output connection info as JSON
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--port`, `-p` | 4000 | Server port |
| `--json-api-port` | 7575 | Canton JSON Ledger API port |
| `--sandbox-port` | 5001 | Canton sandbox port |
| `--no-sandbox` | false | Connect to an existing sandbox |
| `--json` | false | Output connection info as JSON |

## Clients

| Client | Command | Description |
|--------|---------|-------------|
| Browser playground | `cantonctl playground` | Serves the React UI on top of this server |
| Headless | `cantonctl serve` | API only, no UI |
| VS Code extension | _(planned)_ | Connects to a running serve instance |

## REST API

All endpoints return JSON. Base URL: `http://localhost:{port}`.

### Health

```
GET /api/health
```

Returns sandbox health and Canton version.

```json
{"healthy": true, "version": "3.4.9"}
```

### Files

```
GET /api/files
```

Returns the project file tree.

```json
[
  {"name": "cantonctl.yaml", "path": "cantonctl.yaml", "type": "file"},
  {"name": "daml", "path": "daml", "type": "directory", "children": [
    {"name": "Main.daml", "path": "daml/Main.daml", "type": "file"}
  ]}
]
```

```
GET /api/files/{path}
```

Returns file content.

```json
{"content": "module Main where\n...", "path": "daml/Main.daml"}
```

```
PUT /api/files/{path}
Content-Type: application/json

{"content": "module Main where\n..."}
```

Writes file content. If the file is a `.daml` file, triggers an automatic rebuild, uploads the DAR to the sandbox, and emits `build:start` / `build:success` / `dar:uploaded` / `build:error` WebSocket events.

### Project

```
GET /api/project
```

Returns project metadata from `daml.yaml`. Used by the frontend to construct package-name-qualified template IDs.

```json
{"name": "my-app", "version": "1.0.0", "projectDir": "/path/to/project"}
```

### Templates

```
GET /api/templates
```

Returns all Daml templates parsed from `.daml` source files in the `daml/` directory.

```json
{
  "templates": [{
    "name": "Token",
    "module": "Main",
    "fields": [
      {"name": "owner", "type": "Party"},
      {"name": "symbol", "type": "Text"},
      {"name": "amount", "type": "Decimal"}
    ],
    "choices": [
      {"name": "Transfer", "returnType": "(ContractId Token, ContractId Token)", "args": [{"name": "newOwner", "type": "Party"}, {"name": "transferAmount", "type": "Decimal"}], "controller": "owner", "consuming": true},
      {"name": "Burn", "returnType": "()", "args": [], "controller": "owner", "consuming": true},
      {"name": "Mint", "returnType": "ContractId Token", "args": [{"name": "mintAmount", "type": "Decimal"}], "controller": "owner", "consuming": true}
    ],
    "signatory": "owner"
  }]
}
```

```
GET /api/templates/{name}
```

Returns a single template by name. Returns 404 if not found.

### Parties

```
GET /api/parties
```

Returns all parties on the sandbox.

```json
{"partyDetails": [{"party": "sandbox::1220abc...", "isLocal": true}]}
```

```
POST /api/parties
Content-Type: application/json

{"displayName": "Alice", "identifierHint": "Alice"}
```

Allocates a new party.

### Contracts

```
GET /api/contracts?party={partyId}&templateId={optional}
```

Returns active contracts visible to the specified party.

```json
{
  "activeContracts": [
    {
      "contractId": "c-abc123",
      "templateId": "Main:Token",
      "payload": {"owner": "sandbox::1220abc...", "symbol": "CTK", "amount": "1000.0"}
    }
  ]
}
```

### Multi-Party Contracts

```
GET /api/contracts/multi?parties={partyId1},{partyId2}
```

Returns active contracts for multiple parties in a single request. Used by the split view.

```json
{
  "contracts": {
    "sandbox::1220abc...": [{"contractId": "c-1", "templateId": "Main:Token", "payload": {...}}],
    "sandbox::1220def...": []
  }
}
```

### Commands

```
POST /api/commands
Content-Type: application/json

{
  "actAs": ["sandbox::1220abc..."],
  "commands": [
    {
      "CreateCommand": {
        "templateId": "Main:Token",
        "createArguments": {"owner": "sandbox::1220abc...", "symbol": "CTK", "amount": "1000"}
      }
    }
  ]
}
```

Submits a command to the Canton ledger and waits for the result. Supports `CreateCommand` and `ExerciseCommand`.

### Build

```
POST /api/build
```

Triggers a manual Daml build. Returns build result.

```json
{"darPath": ".daml/dist/my-app-1.0.0.dar", "durationMs": 1830, "cached": false}
```

### Test

```
POST /api/test
```

Runs Daml Script tests. Returns test result.

```json
{"passed": true, "output": "Test Summary\n...", "durationMs": 1500}
```

## WebSocket Protocol

Connect to `ws://localhost:{port}`. Messages are JSON objects with a `type` field.

### Server to Client Events

| Event | Fields | Description |
|-------|--------|-------------|
| `connected` | | Initial connection established |
| `build:start` | | Daml build started |
| `build:success` | `dar`, `durationMs` | Build completed successfully |
| `build:cached` | `dar`, `durationMs` | Build skipped (up to date) |
| `build:error` | `output` | Build failed |
| `test:start` | | Test execution started |
| `test:result` | `passed`, `output` | Test completed |
| `contracts:update` | | Contract state changed (after command submission) |
| `dar:uploaded` | `dar` | DAR successfully uploaded to sandbox after build |
| `file:change` | `path` | File changed on disk |
| `log` | `message` | General log message |

### Example

```javascript
const ws = new WebSocket('ws://localhost:4000')
ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  switch (data.type) {
    case 'build:success':
      console.log(`Build done in ${data.durationMs}ms`)
      break
    case 'test:result':
      console.log(data.passed ? 'Tests passed' : 'Tests failed')
      break
  }
}
```

## Error Codes

| Code | Meaning |
|------|---------|
| E1001 | Not in a cantonctl project (cantonctl.yaml not found) |
| E3002 | Port already in use |

## JSON Output

```bash
cantonctl serve --json
```

```json
{
  "data": {
    "port": 4000,
    "ledgerUrl": "http://localhost:7575",
    "websocket": "ws://localhost:4000",
    "projectDir": "/path/to/project",
    "protocol": "canton-ide-protocol/v1"
  },
  "success": true
}
```
