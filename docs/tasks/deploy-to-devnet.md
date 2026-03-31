# Deploy to DevNet

This guide walks through deploying a Daml application to a remote Canton network.

## Prerequisites

- A cantonctl project with `cantonctl.yaml` configured
- A remote Canton participant with JSON Ledger API enabled
- A JWT token with admin and actAs claims for the target network

## Steps

### 1. Configure the network in cantonctl.yaml

```yaml
networks:
  local:
    type: sandbox
    port: 5001
    json-api-port: 7575
  devnet:
    type: remote
    url: https://devnet.example.com:7575
```

### 2. Store your credentials

```bash
cantonctl auth login devnet --token eyJhbGciOiJIUzI1NiIs...
```

This stores the JWT in your OS keychain. Verify with:

```bash
cantonctl auth status
```

For CI pipelines, use an environment variable instead:

```bash
export CANTONCTL_JWT_DEVNET=eyJhbGciOiJIUzI1NiIs...
```

### 3. Verify connectivity

```bash
cantonctl status --network devnet
```

You should see the node version and health status.

### 4. Test locally first

```bash
cantonctl dev       # Start local sandbox
cantonctl build     # Compile Daml
cantonctl test      # Run tests
cantonctl deploy    # Deploy to local sandbox
```

### 5. Deploy to devnet

```bash
cantonctl deploy devnet
```

The 6-step pipeline runs: validate → build → auth → pre-flight → upload → verify.

### 6. Verify deployment

The deploy command outputs the `mainPackageId` on success. You can also verify with:

```bash
cantonctl status --network devnet
```

## Dry Run

To validate without uploading:

```bash
cantonctl deploy devnet --dry-run
```

This runs steps 1-4 (validate, build, auth, pre-flight) and reports what would happen.

## Troubleshooting

| Error | Resolution |
|-------|-----------|
| E6001 (auth failed) | Re-run `cantonctl auth login devnet` with a fresh token |
| E6002 (unreachable) | Check the URL in cantonctl.yaml and network connectivity |
| E6003 (upload failed) | Check participant logs for package validation errors |
| E6004 (package exists) | Increment the version in `daml.yaml` and rebuild |

## Related

- [Reference: deploy command](../reference/deploy.md)
- [Concept: authentication](../concepts/authentication.md)
