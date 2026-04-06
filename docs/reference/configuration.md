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

`cantonctl profiles show --json` exposes the derived control-plane model for a resolved profile. Those fields are inspection output, not YAML keys:

| Field | Meaning |
|---|---|
| `profile.definitionSource` | whether the profile came from explicit `profiles:` config or a legacy `networks:` compatibility shim |
| `services[].sourceIds` | manifest entries that anchor the service contract |
| `services[].stability` | manifest-derived stability class |
| `services[].controlPlane.lifecycleOwner` | which official runtime or companion layer owns the implementation |
| `services[].controlPlane.managementClass` | whether `cantonctl` treats the service as `read-only`, `plan-only`, or `apply-capable` |
| `services[].controlPlane.mutationScope` | whether the service is managed, merely observed, or out of scope for mutation |
| `services[].controlPlane.operatorSurface` | whether the service depends on an operator-only upstream surface |
| `services[].controlPlane.endpointProvenance` | whether the endpoint was declared directly, inherited from legacy `networks:`, or derived from a local default |
| `capabilities[]` | runtime-adjacent capabilities that belong to official SDK packages instead of direct control-plane mutation |

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
    ledger:
      url: http://canton.localhost:4000/v2
    scan:
      url: http://scan.localhost:4000/api/scan
    validator:
      url: http://wallet.localhost:4000/api/validator
    localnet:
      distribution: splice-localnet
      version: "0.5.3"

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
  localnet:
    profile: splice-local
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

## Control-Plane Interpretation

- `sandbox` and `canton-multi` are local runtime surfaces. Ledger and local auth resolution are companion-managed.
- `splice-localnet` wraps the official LocalNet workspace. The `localnet` service is apply-capable; the runtime endpoints behind it remain official local-runtime surfaces.
- `remote-validator` and `remote-sv-network` keep remote runtimes as the implementation owners. `cantonctl` still classifies which services are in management scope for current plan/apply surfaces such as `deploy` versus read-only observation.
- Wallet-connected integrations stay out of direct control-plane mutation. They are surfaced as SDK-backed capabilities anchored to the official dApp and Wallet SDK packages.

## Related

- [`profiles list/show/validate`](../../src/commands/profiles)
- [LocalNet](localnet.md)
- [Auth](auth.md)
- [Compatibility](compatibility.md)
- [Preflight](preflight.md)
- [Readiness](readiness.md)
