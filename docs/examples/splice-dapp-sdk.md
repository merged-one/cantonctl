# Splice dApp SDK Example

Create the scaffold:

```bash
cantonctl init my-wallet-app --template splice-dapp-sdk
```

What it generates:

- A profile-based `cantonctl.yaml` with `sandbox` and `splice-devnet`
- `daml/Main.daml` with a `WalletConnection` contract for local workflows
- `frontend/package.json` pinned to the public `@canton-network/dapp-sdk` and `@canton-network/wallet-sdk` package versions from the upstream manifest
- `frontend/src/wallet.ts` that discovers the public SDK entrypoints without depending on internal app APIs

Stable-surface policy:

- Uses published SDK package names instead of repo-internal workspace imports
- Keeps validator-internal and wallet-internal flows out of the default starter
- Leaves room to add provider-specific wallet UI after the public SDKs are installed

Config export:

- `cantonctl export sdk-config --profile splice-devnet --target dapp-sdk --format json` emits resolved profile wiring for the official SDK without replacing it

Suggested next steps:

```bash
cd my-wallet-app
cantonctl build
cantonctl test
cd frontend && npm install && npm run demo:wallet
```
