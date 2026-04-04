# `cantonctl export sdk-config`

Export resolved profile data for official SDK consumers.

## Usage

```bash
cantonctl export sdk-config --profile splice-devnet --target dapp-sdk --format json
cantonctl export sdk-config --profile splice-devnet --target wallet-sdk --format env
```

## Scope

- emits resolved endpoints and auth placeholders
- uses the canonical `CIP-0103` name
- complements the official dApp SDK, dApp API, and Wallet SDK
- does not generate replacement clients or runtime logic

