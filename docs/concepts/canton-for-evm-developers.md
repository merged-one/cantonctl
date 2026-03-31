# Canton for EVM Developers

If you're coming from Ethereum/EVM development with Hardhat or Foundry, this guide maps Canton concepts to what you already know.

## Concept Mapping

| EVM Concept | Canton Equivalent | Key Difference |
|-------------|-------------------|----------------|
| `msg.sender` | **Party** (signatory/controller) | Canton parties are named identities, not hex addresses |
| Smart contract | **Daml template** | Templates define data + choices (like functions), not deployed bytecode |
| Contract deployment | **DAR upload** | Upload compiled `.dar` archive; templates become available to create instances |
| Transaction | **Command submission** | Commands create contracts or exercise choices on existing contracts |
| `view` function | **Contract query** | Query active contracts filtered by party and template |
| ERC-20 token | **Daml template with Transfer choice** | Privacy-preserving: only signatories/observers see the contract |
| Hardhat Network | **Canton sandbox** (`cantonctl dev`) | Local single-participant node, in-memory, no Docker |
| Anvil | **`dpm sandbox`** | Similar concept: fast local node for development |
| `hardhat.config.ts` | **`cantonctl.yaml`** | Declarative YAML config instead of executable TypeScript |
| Hardhat plugins | **cantonctl plugins** | npm-based, auto-discovered from `@cantonctl/plugin-*` |
| ethers.js / viem | **Canton JSON Ledger API** | REST API at port 7575, not JSON-RPC |
| Gas | **No gas on Canton** | No transaction fees on Canton Network (fees are at the infrastructure level) |
| Block explorer | **Canton scan** | https://cantonscan.com for network visibility |
| Nonce | **Command ID** | Idempotency key for command deduplication |

## Privacy: The Fundamental Difference

In EVM, all state is public. Every node sees every contract's storage.

In Canton, **privacy is structural**:
- Only **signatories** and **observers** can see a contract
- A `Transfer` choice between Alice and Bob is invisible to Charlie
- This is enforced at the protocol level, not by application logic

This means your mental model shifts from "everything is public, hide sensitive data" to "nothing is visible by default, explicitly grant visibility."

## Authorization Model

**EVM:** `require(msg.sender == owner)` — runtime check against transaction sender address.

**Canton:** Authorization is declared in the template:

```daml
template Token
  with
    owner : Party    -- who "owns" this data
  where
    signatory owner  -- owner must authorize creation and archival

    choice Transfer : ContractId Token
      with
        newOwner : Party
      controller owner  -- only owner can exercise this choice
      do ...
```

The `signatory` and `controller` keywords replace `require(msg.sender == ...)`. Authorization is checked by the ledger, not by your code.

## Development Workflow Comparison

### Hardhat
```bash
npx hardhat init
npx hardhat node          # Start local network
npx hardhat compile       # Compile Solidity
npx hardhat test          # Run tests
npx hardhat run scripts/deploy.ts --network goerli
```

### cantonctl
```bash
cantonctl init my-app --template token
cantonctl dev             # Start local sandbox + hot-reload
cantonctl build           # Compile Daml
cantonctl test            # Run Daml Script tests
cantonctl deploy devnet   # Deploy to DevNet
```

## Zenith: EVM on Canton

If you want to write Solidity but deploy on Canton Network, use Zenith:

```bash
cantonctl init my-app --template zenith-evm
```

This gives you a Hardhat project structure with a Zenith network configuration. Your Solidity contracts run on the Zenith EVM execution layer, which bridges to Canton's privacy-preserving ledger.

## JSON Ledger API vs JSON-RPC

Instead of `eth_call` and `eth_sendTransaction`, Canton uses REST endpoints:

| EVM (JSON-RPC) | Canton (Ledger API V2) |
|-----------------|------------------------|
| `eth_call` | `POST /v2/state/active-contracts` |
| `eth_sendTransaction` | `POST /v2/commands/submit-and-wait` |
| Contract deployment | `POST /v2/dars` (upload DAR) |
| `eth_getBalance` | Query contracts with template filter |
| Account management | `POST /v2/parties/allocate` |
| Chain ID | `GET /v2/version` |

All requests require a JWT Bearer token. For local development, `cantonctl dev` generates one automatically.
