# Deploy to DevNet

This guide walks through rolling out a built DAR to a remote validator-backed profile.

## Prerequisites

- A cantonctl project with `cantonctl.yaml` configured
- A resolved remote profile with an apply-capable ledger endpoint
- App auth material for readiness and read checks
- Operator auth material for the remote DAR rollout

## Steps

### 1. Configure the remote profile in `cantonctl.yaml`

```yaml
networkProfiles:
  devnet: splice-devnet

profiles:
  splice-devnet:
    experimental: false
    kind: remote-validator
    name: splice-devnet
    services:
      auth:
        kind: jwt
        issuer: https://login.example.com
        audience: https://wallet.devnet.example.com
      ledger:
        url: https://ledger.devnet.example.com
      validator:
        url: https://validator.devnet.example.com
```

### 2. Store your credentials

```bash
cantonctl auth login devnet --scope app --token eyJhbGciOiJIUzI1NiIs...
cantonctl auth login devnet --scope operator --token eyJhbGciOiJIUzI1NiIs...
```

This stores the app and operator credentials in separate keychain slots. Verify with:

```bash
cantonctl auth status
```

For CI pipelines, use an environment variable instead:

```bash
export CANTONCTL_JWT_DEVNET=eyJhbGciOiJIUzI1NiIs...
export CANTONCTL_OPERATOR_TOKEN_DEVNET=eyJhbGciOiJIUzI1NiIs...
```

### 3. Verify connectivity

```bash
cantonctl status --profile splice-devnet
```

You should see the node version and health status.

### 4. Test locally first

```bash
cantonctl dev       # Start local sandbox
cantonctl build     # Compile Daml
cantonctl test      # Run tests
cantonctl deploy --profile sandbox
```

### 5. Deploy to devnet

```bash
cantonctl build
cantonctl deploy --profile splice-devnet
```

`deploy` consumes the built DAR from `.daml/dist`, runs profile-aware preflight, uploads on apply, and reports the selected artifact, target fan-out, and post-deploy checks. The positional `devnet` alias still works, but `--profile splice-devnet` is the preferred form.

### 6. Verify deployment

`deploy --json` reports the package ID and per-step results on success. You can also verify with:

```bash
cantonctl status --profile splice-devnet
```

## Plan And Dry Run

Use `--plan` when you want the resolved rollout shape without contacting the runtime:

```bash
cantonctl deploy --profile splice-devnet --plan --json
```

Use `--dry-run` when you want artifact resolution plus read-only preflight against the live runtime:

```bash
cantonctl deploy --profile splice-devnet --dry-run
```

## Troubleshooting

| Error | Resolution |
|-------|-----------|
| E6001 (auth failed) | Re-run `cantonctl auth login devnet --scope operator` with a fresh token or set `CANTONCTL_OPERATOR_TOKEN_DEVNET` |
| E6002 (unreachable) | Check the URL in cantonctl.yaml and network connectivity |
| E6003 (upload failed) | Check participant logs for package validation errors |
| E6004 (package exists) | Increment the version in `daml.yaml` and rebuild |

## Related

- [Reference: deploy command](../reference/deploy.md)
- [Concept: authentication](../concepts/authentication.md)
