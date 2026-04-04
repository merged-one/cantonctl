# Configuration

`cantonctl.yaml` is profile-first.

The intended progression is:

1. `sandbox`
2. `canton-multi`
3. `splice-localnet`
4. `remote-validator` or `remote-sv-network`

Legacy `networks:` entries are still accepted, but new work should use `profiles:` as the primary runtime model.

## Why Profiles Come First

Official tooling already owns build, test, sandbox, Studio, and the reference-app path. `cantonctl` adds value once a project needs repeatable environment control across multiple services and multiple stages.

Profiles are the control plane for that layer.

## Example

```yaml
version: 1

project:
  name: my-splice-app
  sdk-version: "3.4.11"
  template: splice-dapp-sdk

default-profile: sandbox

profiles:
  sandbox:
    kind: sandbox
    ledger:
      port: 5001
      json-api-port: 7575

  splice-local:
    kind: splice-localnet
    localnet:
      distribution: splice-localnet
      workspace: ../quickstart

  splice-devnet:
    kind: remote-validator
    ledger:
      url: https://ledger.example.com
    scan:
      url: https://scan.example.com
    validator:
      url: https://validator.example.com
    tokenStandard:
      url: https://tokens.example.com
    ans:
      url: https://ans.example.com
    auth:
      kind: oidc
      issuer: https://login.example.com

networks:
  local:
    profile: sandbox
  devnet:
    profile: splice-devnet
```

## Profile Kinds

| Kind | Use |
|---|---|
| `sandbox` | Local contract iteration |
| `canton-multi` | Canton-only multi-node realism |
| `splice-localnet` | Official LocalNet workspace wrapper |
| `remote-validator` | Validator-backed remote target |
| `remote-sv-network` | Scan/SV-oriented remote target |

## Related

- [`profiles list/show/validate`](../../src/commands/profiles)
- [LocalNet](localnet.md)
- [Auth](auth.md)
- [Compatibility](compatibility.md)
- [Preflight](preflight.md)
