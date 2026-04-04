<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/banner.svg">
  <img alt="cantonctl — Splice-aware orchestration companion for the official Canton stack" src="assets/banner.svg">
</picture>

`cantonctl` is the Splice-aware orchestration companion for teams moving Daml artifacts and app code across sandbox, LocalNet, and validator-backed Canton/Splice environments.

It complements DPM, Daml Studio, Quickstart, and the official wallet and dApp SDKs. It wraps, not replaces, the official stack.

## What It Is Not

- Not the canonical build, test, codegen, sandbox, or studio tool. Use DPM first.
- Not the canonical IDE. Use Daml Studio first.
- Not the official reference app or LocalNet launcher. Use CN Quickstart first.
- Not the primary wallet-provider or exchange toolkit. Use the official Wallet SDK and wallet integration guidance first.
- Not the default UX for unstable internal APIs.

## Start With Official Tooling

| Tool | Official role | Where `cantonctl` adds value |
|---|---|---|
| DPM | Build, test, codegen, sandbox, Studio launch | Profiles, auth, compatibility checks, diagnostics, remote-environment helpers |
| Daml Studio | Canonical Daml IDE in VS Code | `serve` and `playground` as adjunct local workbench surfaces |
| CN Quickstart | Official reference app and LocalNet launchpad | Profile-driven movement from LocalNet into remote validator-backed environments |
| dApp SDK / dApp API / Wallet Gateway | Canonical wallet-connected dApp path, including CIP-0103 flows | Exported config, stable/public canaries, profile-aware diagnostics |
| Wallet SDK | Canonical wallet-provider, exchange, and custody toolkit | Config export and support-oriented readiness checks |
| Stable/public Splice APIs | Supported remote automation surfaces | Profile synthesis, discovery, validation, and CI-friendly wrappers |

See [docs/README.md](docs/README.md) for the full ecosystem-fit guide.

## Prerequisites

### Required

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | >= 18 | Run `cantonctl` |
| DPM | Current supported Canton release | Canonical build, test, sandbox, and Studio workflow |
| Java | 21 | Required by the Daml SDK and Canton |

### Optional

| Dependency | Purpose |
|---|---|
| Docker | `dev --full` and `localnet` workflows |
| Official Splice LocalNet workspace | `localnet up/down/status` wrapper |

Verify the environment with:

```bash
npm install -g cantonctl
cantonctl doctor
```

## Quick Start

### Build with the official stack

```bash
curl -fsSL https://get.digitalasset.com/install/install.sh | sh
dpm studio
```

### Choose the right starting point

Use CN Quickstart when you want the official reference app and LocalNet launchpad:

```bash
cantonctl localnet up --workspace ../quickstart --profile sv
cantonctl localnet status --workspace ../quickstart --json
```

Use `cantonctl init` when you want a companion-ready starter with profiles, diagnostics, and stable/public Splice wiring:

```bash
cantonctl init my-app --template splice-dapp-sdk
cd my-app
cantonctl dev
cantonctl build
cantonctl test
cantonctl profiles list
cantonctl compat check splice-devnet
```

## Profiles And Environments

The default progression is:

1. `sandbox` for local contract iteration
2. `canton-multi` when you need a Canton-only multi-node topology
3. `splice-localnet` when you want to wrap the official Splice LocalNet workspace
4. `remote-validator` or `remote-sv-network` for validator-backed or SV/Scan-backed remote environments

The profile model is the product backbone. It is what lets `cantonctl` stay focused on orchestration instead of re-owning the official runtime stack.

## Commands

| Command | Description | Positioning |
|---|---|---|
| `cantonctl init [name]` | Scaffold a companion-ready project or starter template | Supports official-stack workflows |
| `cantonctl dev` | Start the local sandbox wrapper with hot reload | Delegates to DPM/daml |
| `cantonctl dev --full` | Start the Canton-only multi-node Docker topology | Canton-only local realism |
| `cantonctl localnet up/down/status` | Wrap the official Splice LocalNet workspace | Quickstart-aware wrapper |
| `cantonctl build` | Compile Daml and optionally codegen bindings | Delegates to DPM/daml |
| `cantonctl test` | Run Daml Script tests with structured output | Delegates to DPM/daml |
| `cantonctl deploy <network>` | Run the advisory DAR deploy wrapper for ledger-capable targets | Not a validator control plane |
| `cantonctl status` | Show profile-aware service health and ledger status | Support and diagnostics surface |
| `cantonctl profiles list/show/validate` | Inspect and validate resolved runtime profiles | Core control-plane wedge |
| `cantonctl compat check [profile]` | Check stable/public compatibility for a profile | Stable/public guardrail |
| `cantonctl auth login/logout/status` | Manage profile-oriented auth and stored bearer credentials | Remote environment helper |
| `cantonctl scan updates/acs/current-state` | Query stable/public Scan surfaces | Stable/public only |
| `cantonctl token holdings/transfer` | Use stable holdings and transfer-factory flows | Stable/public only |
| `cantonctl ans list/create` | Read or create ANS entries through stable/public flows | Stable/public only |
| `cantonctl validator traffic-buy/traffic-status` | Use stable validator-user traffic flows | Stable/public only |
| `cantonctl codegen sync` | Sync manifest-managed upstream specs and generated clients | Maintainer workflow |
| `cantonctl doctor` | Check prerequisites and profile-aware environment readiness | Support and diagnostics surface |
| `cantonctl serve` | Start the profile-aware Canton IDE Protocol backend | Adjunct workbench backend |
| `cantonctl playground` | Open the local browser workbench | Adjunct demo and inspection surface |
| `cantonctl validator experimental ...` | Opt into operator-only validator-internal flows | Experimental only |

All commands except `console` and `playground` support `--json`.

## Stable/Public Vs Experimental

### Stable/Public Defaults

- Profile-based config and compatibility checks
- Official LocalNet wrapping via `localnet up/down/status`
- Scan, token-standard, ANS, and validator-user surfaces
- Auth, status, and doctor flows for sandbox, LocalNet, and remote profiles
- Manifest-driven stability policy and generated client sync

### Explicitly Experimental

- `validator experimental ...`
- Scan-proxy-only reads
- Auth modes that require explicit acknowledgement such as `localnet-unsafe-hmac` and `oidc-client-credentials`
- Any validator-internal, wallet-internal, or other operator-only surface

See [docs/reference/experimental.md](docs/reference/experimental.md) and [docs/reference/api-stability.md](docs/reference/api-stability.md).

## Templates And Examples

Stable/public Splice workflows lead the starter story:

```bash
cantonctl init my-app --template splice-dapp-sdk
cantonctl init my-app --template splice-scan-reader
cantonctl init my-app --template splice-token-app
```

Generic Canton and Zenith templates remain available:

```bash
cantonctl init my-app --template basic
cantonctl init my-app --template token
cantonctl init my-app --template defi-amm
cantonctl init my-app --template api-service
cantonctl init my-app --template zenith-evm
```

If you want the official reference app path, start from Quickstart instead of these templates.

Examples:

- [docs/examples/README.md](docs/examples/README.md)
- [docs/examples/splice-dapp-sdk.md](docs/examples/splice-dapp-sdk.md)
- [docs/examples/splice-scan-reader.md](docs/examples/splice-scan-reader.md)
- [docs/examples/splice-token-app.md](docs/examples/splice-token-app.md)

## Docs

- [docs/README.md](docs/README.md)
- [docs/concepts/ecosystem-fit.md](docs/concepts/ecosystem-fit.md)
- [docs/concepts/when-to-use-which-tool.md](docs/concepts/when-to-use-which-tool.md)
- [docs/concepts/target-users.md](docs/concepts/target-users.md)
- [docs/concepts/non-goals.md](docs/concepts/non-goals.md)
- [docs/reference/configuration.md](docs/reference/configuration.md)
- [docs/reference/localnet.md](docs/reference/localnet.md)
- [docs/reference/compatibility.md](docs/reference/compatibility.md)
- [docs/reference/preflight.md](docs/reference/preflight.md)

## Release And Migration Notes

- [docs/release-notes/v0.4.0-splice-support.md](docs/release-notes/v0.4.0-splice-support.md)
- [docs/release-notes/vNEXT-community-fit.md](docs/release-notes/vNEXT-community-fit.md)
- [docs/migration/v0.4.0-splice-support.md](docs/migration/v0.4.0-splice-support.md)
- [docs/migration/vNEXT-community-fit.md](docs/migration/vNEXT-community-fit.md)
