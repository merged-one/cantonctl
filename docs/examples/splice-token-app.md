# Splice Token App Example

Create the scaffold:

```bash
cantonctl init my-token-app --template splice-token-app
```

What it generates:

- A profile-based `cantonctl.yaml` with both `sandbox` and `splice-devnet` profiles
- `daml/Main.daml` with a local `TokenWatchlist` contract you can build and test immediately
- `frontend/src/token-client.ts` with starter calls for holdings and transfer-instruction flows

Stable-surface policy:

- Reads holdings through the public JSON Ledger API and the stable `Holding` interface id
- Starts transfers from the stable token-standard transfer-instruction family
- Does not wire validator-internal flows into the default scaffold
- Does not treat burn/mint as part of the base token-standard starter

Suggested next steps:

```bash
cd my-token-app
cantonctl build
cantonctl test
cantonctl token holdings --profile splice-devnet --party Alice --token "$BEARER_TOKEN"
cd frontend && npm install && npm run demo:holdings
```
