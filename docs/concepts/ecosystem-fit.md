# Ecosystem Fit

`cantonctl` is a community-maintained orchestration companion over the official Canton stack.

The rule is simple: wrap, do not replace.

## Matrix

| Tool | Official role | Where it stops | What `cantonctl` adds |
|---|---|---|---|
| DPM | Canonical build, test, codegen, sandbox, and Studio launch | Not a profile-driven remote-operations companion | Profile resolution, compatibility checks, auth helpers, diagnostics, canaries |
| Daml Studio | Canonical Daml IDE | Not an orchestration or support workflow tool | Keep the canonical IDE workflow; use `cantonctl` around profiles and support checks |
| CN Quickstart | Official reference app and LocalNet launchpad | Not a generic control plane for arbitrary projects and remote validators | LocalNet wrapping, profile progression, remote-environment readiness helpers |
| dApp SDK / dApp API / Wallet Gateway | Canonical wallet-connected dApp path, including CIP-0103 | Not a profile-management or deployment-host diagnostics tool | Config export, stable/public smoke checks, profile-aware support flows |
| Wallet SDK | Canonical wallet-provider, exchange, and custody toolkit | Not a general CLI for promotion hygiene and remote checks | Support-oriented config export and advisory validation |
| Stable/public Splice APIs and published Daml interfaces | Supported automation surfaces | No opinionated project-local orchestration or runbook layer | Wrappers, validation, discovery, canaries, CI-friendly JSON |
| `cantonctl` | Community orchestration companion | Should not claim ownership of the official stack | Profiles, auth, compatibility, LocalNet wrapping, diagnostics, discovery, canaries, advisory helpers |

## Summary

- Build with DPM.
- Edit with Daml Studio.
- Start from Quickstart when you want the official reference app or LocalNet workflow.
- Use the official SDKs for wallet-connected integration.
- Use `cantonctl` when you need a stable/public-first operational companion across sandbox, LocalNet, and remote validator-backed environments.
