# cantonctl token

Use stable public token-standard surfaces for holdings and transfers.

## Subcommands

### `token holdings`

List token holdings through the stable holding Daml interface exposed by the public JSON Ledger API.

```bash
cantonctl token holdings --profile splice-devnet --party Alice --token eyJ...
cantonctl token holdings --ledger-url https://ledger.example.com --party Alice --instrument-admin Registry --instrument-id USD --token eyJ... --json
```

**Flags**

| Flag | Default | Description |
|------|---------|-------------|
| `--profile <name>` | — | Resolved runtime profile that exposes `ledger` |
| `--ledger-url <url>` | — | Explicit ledger JSON API base URL override |
| `--party <party>` | — | Party whose visible holdings should be queried |
| `--instrument-admin <party>` | — | Optional instrument admin filter |
| `--instrument-id <id>` | — | Optional instrument id filter |
| `--token <jwt>` | — | JWT bearer token for the ledger query |
| `--json` | `false` | Output as JSON |

Behavior:
- Reads the ledger end, then queries active contracts filtered by the stable `Holding` interface id.
- Normalizes interface views into owner, amount, instrument, synchronizer, and template fields.

### `token transfer`

Transfer tokens through the stable token-standard transfer factory flow.

```bash
cantonctl token transfer --profile splice-devnet --sender Alice --receiver Bob --amount 10.0 --instrument-admin Registry --instrument-id USD --token eyJ...
cantonctl token transfer --ledger-url https://ledger.example.com --token-standard-url https://tokens.example.com --sender Alice --receiver Bob --amount 10.0 --instrument-admin Registry --instrument-id USD --token eyJ... --json
```

**Flags**

| Flag | Default | Description |
|------|---------|-------------|
| `--profile <name>` | — | Resolved runtime profile that exposes `ledger` and `tokenStandard` |
| `--ledger-url <url>` | — | Explicit ledger JSON API base URL override |
| `--token-standard-url <url>` | — | Explicit token-standard base URL override |
| `--sender <party>` | — | Sender party |
| `--receiver <party>` | — | Receiver party |
| `--amount <decimal>` | — | Decimal token amount to transfer |
| `--instrument-admin <party>` | — | Instrument admin party |
| `--instrument-id <id>` | — | Instrument identifier |
| `--requested-at <iso>` | current time | Optional request timestamp |
| `--execute-before <iso>` | current time + 15 minutes | Optional execution deadline |
| `--input-holding-cid <cid>` | — | Optional holding contract ids to use as explicit transfer inputs. Repeatable. |
| `--token <jwt>` | — | JWT bearer token for token-standard and ledger calls |
| `--json` | `false` | Output as JSON |

Behavior:
- Calls the stable token-standard `transfer-factory` surface to obtain choice context and disclosed contracts.
- Submits the corresponding ledger interface-choice exercise through the public JSON Ledger API.
- Does not default to deprecated transfer-offer workflows.

## Related Stable Commands

These commands ship in the same stable public Splice surface set:

```bash
cantonctl ans list --profile splice-devnet --token eyJ...
cantonctl ans create --profile splice-devnet --name alice.unverified.ans --description "Alice profile" --url https://alice.example.com --token eyJ...
cantonctl validator traffic-buy --profile splice-devnet --receiving-validator-party-id AliceValidator --domain-id domain::1 --traffic-amount 4096 --token eyJ...
cantonctl validator traffic-status --profile splice-devnet --tracking-id traffic-123 --token eyJ...
```

- `ans list` reads from stable ANS, Scan, or scan-proxy surfaces.
- `ans create` writes through the stable external ANS service.
- `validator traffic-buy` and `validator traffic-status` use the stable wallet-backed validator-user endpoints.

## JSON Output

```json
{
  "success": true,
  "data": {
    "endpoint": {
      "ledger": "https://ledger.example.com",
      "tokenStandard": "https://tokens.example.com"
    },
    "factoryId": "factory-1",
    "transferKind": "direct",
    "transaction": {
      "updateId": "tx-1"
    }
  }
}
```

## Source

- Commands: [`src/commands/token/`](../../src/commands/token/)
- Related commands: [`src/commands/ans/`](../../src/commands/ans/), [`src/commands/validator/`](../../src/commands/validator/)
- Logic: [`src/lib/splice-public.ts`](../../src/lib/splice-public.ts)
- Adapters: [`src/lib/adapters/token-standard.ts`](../../src/lib/adapters/token-standard.ts), [`src/lib/adapters/validator-user.ts`](../../src/lib/adapters/validator-user.ts)
