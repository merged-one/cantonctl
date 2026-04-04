# `cantonctl canary stable-public`

Run stable/public canaries against a resolved profile.

## Usage

```bash
cantonctl canary stable-public --profile splice-devnet
cantonctl canary stable-public --profile splice-devnet --suite scan --json
```

## Default suites

- `scan`
- `ans`
- `token-standard`
- `validator-user`

The default path intentionally excludes unstable or internal surfaces.

