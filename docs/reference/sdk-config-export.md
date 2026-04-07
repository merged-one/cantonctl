# `cantonctl export sdk-config`

Export resolved profile data for official SDK consumers.

## Usage

```bash
cantonctl export sdk-config --profile splice-devnet --target dapp-sdk --format json
cantonctl export sdk-config --profile splice-devnet --target wallet-sdk --format env
```

## Flags

| Flag | Description |
|---|---|
| `--profile <name>` | Resolve config from the selected profile instead of `default-profile` |
| `--target dapp-sdk|wallet-sdk|dapp-api` | Select the official SDK consumer shape |
| `--format json|env` | Render raw JSON or `.env`-style output |
| `--json` | Wrap the rendered export in `cantonctl` JSON output |

Without `--json`, the command writes the rendered config directly to stdout. With `--json`, it returns the rendered text plus the structured exported config object.

## Target Behavior

- emits resolved endpoints and auth placeholders
- uses the canonical `CIP-0103` name
- complements the official dApp SDK, dApp API, and Wallet SDK
- does not generate replacement clients or runtime logic

Target-specific endpoint mapping:

| Target | Exported endpoint focus |
|---|---|
| `dapp-sdk` | scan, ledger, auth, token-standard, `CIP_0103_DAPP_API_URL`, and `CIP_0103_WALLET_GATEWAY_URL` |
| `dapp-api` | scan, ledger, auth, token-standard, and `CIP_0103_DAPP_API_URL` |
| `wallet-sdk` | scan, ledger, auth, token-standard, and `SPLICE_VALIDATOR_URL` |

Current implementation derives `CIP_0103_DAPP_API_URL`, `CIP_0103_WALLET_GATEWAY_URL`, and `SPLICE_VALIDATOR_URL` from the resolved validator service URL when those targets need them. Replace those placeholders if your deployment exposes dedicated gateway endpoints.

## Env Output

`--format env` emits `CANTONCTL_PROFILE`, `CANTONCTL_NETWORK`, `CANTONCTL_SDK_TARGET`, `CANTONCTL_CIP_STANDARD`, the resolved service URLs, and auth placeholder variables such as `SPLICE_AUTH_TOKEN_ENV` and `SPLICE_AUTH_TOKEN_PLACEHOLDER`.
