# Configuration

`cantonctl.yaml` supports two shapes during the migration to profile-based runtime support:

- Legacy `networks` entries, which remain valid and unchanged.
- Profile-based `profiles` plus optional `networks` references.

Legacy configs are normalized into the canonical internal profile model automatically.
New `cantonctl init` scaffolds now emit the profile-based shape by default.

## Legacy Shape

This is still accepted exactly as before:

```yaml
version: 1

project:
  name: my-app
  sdk-version: "3.4.11"

parties:
  - name: Alice
    role: operator
  - name: Bob
    role: participant

networks:
  local:
    type: sandbox
    port: 5001
    json-api-port: 7575
  devnet:
    type: remote
    url: https://ledger.example.com
    auth: jwt

plugins: []
```

Legacy network types map to canonical profiles like this:

| Legacy network type | Normalized profile kind |
|---------------------|-------------------------|
| `sandbox` | `sandbox` |
| `docker` | `canton-multi` |
| `remote` | `remote-validator` |

## Profile-Based Shape

Profile-based config separates runtime bundles from command targets:

```yaml
version: 1

project:
  name: my-app
  sdk-version: "3.4.11"

default-profile: sandbox

profiles:
  sandbox:
    kind: sandbox
    ledger:
      port: 5001
      json-api-port: 7575

  canton-full:
    kind: canton-multi
    ledger:
      url: http://localhost:7575
    localnet:
      base-port: 10000
      canton-image: ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3

  splice-devnet:
    kind: remote-validator
    ledger:
      url: https://ledger.example.com
    validator:
      url: https://validator.example.com
    auth:
      kind: oidc
      issuer: https://login.example.com

networks:
  local:
    profile: sandbox
  devnet:
    profile: splice-devnet
```

If `networks:` is omitted and `default-profile` points to a `sandbox` or `canton-multi` profile, cantonctl synthesizes a legacy-compatible `local` network internally so existing local command defaults keep working.

Splice-aware scaffolds typically keep `sandbox` as the default local profile and add a remote `splice-devnet` profile:

```yaml
version: 1

project:
  name: my-splice-app
  sdk-version: "3.4.11"
  template: splice-token-app

default-profile: sandbox

profiles:
  sandbox:
    kind: sandbox
    ledger:
      port: 5001
      json-api-port: 7575

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

| Kind | Intended target |
|------|-----------------|
| `sandbox` | Single-participant local sandbox |
| `canton-multi` | Canton-only multi-node local topology |
| `splice-localnet` | Local Splice workspace profile for stable/public service URLs |
| `remote-validator` | Remote validator-oriented target |
| `remote-sv-network` | Remote SV/Scan-oriented target |

## Service Blocks

Supported service blocks:

- `ledger`
- `scan`
- `scanProxy`
- `validator`
- `tokenStandard`
- `ans`
- `auth`
- `localnet`

Common blocks:

```yaml
ledger:
  url: https://ledger.example.com
  auth: jwt
```

```yaml
auth:
  kind: oidc
  issuer: https://login.example.com
```

```yaml
localnet:
  base-port: 10000
  canton-image: ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3
```

## Validation Rules

Profile kinds validate their service blocks:

| Profile kind | Allowed service blocks | Required service blocks |
|--------------|------------------------|-------------------------|
| `sandbox` | `ledger`, `auth` | `ledger` |
| `canton-multi` | `ledger`, `auth`, `localnet` | `ledger` |
| `splice-localnet` | `ledger`, `scan`, `scanProxy`, `validator`, `tokenStandard`, `ans`, `auth`, `localnet` | `localnet` |
| `remote-validator` | `ledger`, `scan`, `scanProxy`, `validator`, `tokenStandard`, `ans`, `auth` | none |
| `remote-sv-network` | `ledger`, `scan`, `scanProxy`, `tokenStandard`, `ans`, `auth` | `scan` or `scanProxy` |

Invalid combinations fail with `E1003` and include structured issue paths such as `profiles.sandbox.scan`.

## Migration Path

1. Keep existing `networks:` entries if you only need current Canton commands.
2. Add `profiles:` when you need explicit runtime kinds or multi-service targets.
3. Point `networks.<name>.profile` at those profiles as command targeting evolves.
4. Prefer the profile-based shape for new work; `cantonctl init` now emits that shape for bundled templates.

## Merge Behavior

`resolveConfig()` still merges layers in this order:

1. User config: `~/.config/cantonctl/config.yaml`
2. Project config: nearest `cantonctl.yaml`
3. Environment variables: `CANTONCTL_*`
4. CLI flags

Merge rules:

| Field | Merge strategy |
|-------|----------------|
| `project.*` | Shallow merge |
| `networks.*` | Deep merge per network key |
| `profiles.*` | Deep merge per profile key |
| `parties` | Concatenate |
| `plugins` | Concatenate and deduplicate |
| `default-profile` | Override wins |

## Source

- Loader: [`src/lib/config.ts`](../../src/lib/config.ts)
- Profile normalization: [`src/lib/config-profile.ts`](../../src/lib/config-profile.ts)
