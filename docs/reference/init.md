# cantonctl init

Scaffold a new Canton project from a template.

## Usage

```bash
cantonctl init <name> [flags]
```

## Arguments

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | Project name (used as directory name and in config) | Yes |

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--template` | `-t` | `basic` | Project template: `basic`, `token`, `defi-amm`, `api-service`, `zenith-evm`, `splice-token-app`, `splice-scan-reader`, `splice-dapp-sdk` |
| `--from` | `-f` | — | Create from a community template (GitHub URL). Mutually exclusive with `--template`. |
| `--json` | — | `false` | Output result as JSON |

## Templates

### `basic`
Minimal project for first-time Canton developers.

**Generated files:**
- `cantonctl.yaml` — Profile-based project configuration
- `daml.yaml` — Daml SDK configuration
- `daml/Main.daml` — Hello contract with `UpdateMessage` choice
- `test/Main.test.daml` — `testCreate` and `testUpdate` scripts
- `.gitignore`

### `token`
Token contract targeting DeFi builders.

**Generated files:** Same as basic, plus:
- `frontend/src/` — Frontend starter directories
- `daml/Main.daml` — Token contract with `Transfer`, `Burn`, `Mint` choices
- `test/Main.test.daml` — `testMint`, `testTransfer`, `testCannotOverTransfer`, `testBurn`

### `defi-amm`
AMM liquidity pool contract.

**Generated files:** Same as basic, plus frontend scaffold.
- `daml/Main.daml` — LiquidityPool with `AddLiquidity`, `Swap` choices
- `test/Main.test.daml` — `testAddLiquidity`, `testSwap`

### `api-service`
Express.js backend consuming the Canton Ledger API.

**Generated files:** Same as basic, plus:
- `server/package.json` — Express.js dependencies
- `server/src/server.ts` — REST API with `/health`, `/api/contracts`, `/api/commands`, `/api/parties`
- `server/tsconfig.json` — TypeScript config

### `zenith-evm`
Solidity + Hardhat project for EVM developers building via Zenith.

**Generated files:** Same as basic, plus:
- `contracts/Token.sol` — ERC-20-like Solidity token
- `hardhat.config.ts` — Hardhat config with Zenith network
- `package.json` — Hardhat + ethers dependencies
- `daml/Main.daml` — EvmBridgeRecord contract for Canton-side state mirroring

### `splice-token-app`
Stable token-standard starter for Splice-aware applications.

**Generated files:** Same as basic, plus:
- `frontend/package.json` — TypeScript starter scripts
- `frontend/src/token-client.ts` — Holdings and transfer-instruction example client
- `cantonctl.yaml` — Adds a `splice-devnet` remote-validator profile with stable public service blocks

### `splice-scan-reader`
Stable Scan ingestion starter.

**Generated files:** Same as basic, plus:
- `scripts/read-scan-updates.mjs` — Reads the stable `POST /v2/updates` Scan surface
- `cantonctl.yaml` — Adds a `splice-devnet` remote-validator profile for direct Scan access

### `splice-dapp-sdk`
Public Canton Network dApp SDK starter.

**Generated files:** Same as basic, plus:
- `frontend/package.json` — Pinned public `@canton-network/dapp-sdk` and `@canton-network/wallet-sdk` dependencies
- `frontend/src/wallet.ts` — Public SDK discovery starter
- `cantonctl.yaml` — Adds a `splice-devnet` remote-validator profile with stable public service blocks

## Community Templates

```bash
cantonctl init my-app --from https://github.com/user/my-template
```

The repository must contain a `cantonctl-template.yaml` manifest in the root. The repo is cloned with `--depth 1` and a 60-second timeout.

## Examples

```bash
# Create a basic project
cantonctl init my-app

# Create a token project
cantonctl init my-defi-app --template token

# Create a stable Splice token starter
cantonctl init my-token-app --template splice-token-app

# Create from a community template
cantonctl init my-app --from https://github.com/user/canton-template

# JSON output for CI
cantonctl init my-app --json
```

## JSON Output

```json
{
  "success": true,
  "data": {
    "projectDir": "/absolute/path/to/my-app",
    "template": "token",
    "files": ["cantonctl.yaml", "daml.yaml", "daml/Main.daml", "..."]
  }
}
```

## Error Codes

| Code | Error | Resolution |
|------|-------|------------|
| E1004 | Directory already exists | Choose a different name or remove the existing directory |
| E2003 | Git clone failed (--from) | Check the URL and your network connection |
| E1003 | Missing cantonctl-template.yaml (--from) | Community templates must include this manifest file |

## Source

- Command: [`src/commands/init.ts`](../../src/commands/init.ts)
- Logic: [`src/lib/scaffold.ts`](../../src/lib/scaffold.ts)
