# CI Gates

Use `cantonctl canary stable-public` when you want a JSON-friendly release or promotion gate over stable/public surfaces.

## Example

```bash
cantonctl canary stable-public --profile splice-testnet --json
```

This gate covers scan, ANS, token-standard, and validator-user flows only. It does not normalize unstable internal APIs into the default path.

