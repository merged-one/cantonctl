# When To Use Which Tool

## Choose DPM

Use DPM when the job is:

- compiling or testing Daml
- running sandbox
- launching Daml Studio
- code generation owned by the official toolchain

## Choose Daml Studio

Use Daml Studio when the job is:

- editing contracts
- navigating diagnostics
- working in the canonical IDE flow

## Choose CN Quickstart

Use Quickstart when the job is:

- starting from the official reference app
- using the official LocalNet launchpad
- learning the supported end-to-end application path

## Choose The Official SDKs

Use the dApp SDK, dApp API, Wallet Gateway, and Wallet SDK when the job is:

- wiring wallet-connected browser flows
- implementing CIP-0103 integration
- building wallet-provider, exchange, or custody functionality

## Choose `cantonctl`

Use `cantonctl` when the job is:

- resolving profiles across sandbox, LocalNet, and remote validator-backed environments
- checking auth, compatibility, or service readiness
- wrapping the official LocalNet workspace from a project-local CLI
- running stable/public Scan, token-standard, ANS, or validator-user checks
- exporting config, diagnostics, canaries, or discovery output for CI and support workflows

## Choose The Official Path Instead Of `cantonctl`

Pick the official path when:

- the task already has a canonical DPM, Daml Studio, Quickstart, or SDK workflow
- the task depends on validator-internal, wallet-internal, or other unstable surfaces
- you need an official runtime or product capability rather than a community wrapper
