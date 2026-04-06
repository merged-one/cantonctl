# vNEXT Profile-First Deploy Release Notes

This release promotes `cantonctl deploy` from a legacy network-oriented helper into the profile-first DAR rollout command for ledger-capable targets.

## What Changed

- `deploy` now resolves profiles first and accepts `--profile <name>` as the preferred selector
- `deploy --plan` produces a non-mutating rollout plan with resolved DAR selection, fan-out, and blockers
- `deploy --dry-run` resolves the DAR and runs read-only preflight without uploading
- apply mode now emits structured artifact, fan-out, target, and step results for sandbox, `canton-multi`, LocalNet-ledger, and remote ledger-capable profiles
- `deploy` consumes already built DAR artifacts from `.daml/dist` or `--dar`; it no longer owns build or codegen work

## What Did Not Change

- DPM and Daml Studio remain the canonical build, test, codegen, sandbox, and IDE tooling
- Quickstart and the official LocalNet workspace still own runtime lifecycle
- cloud and cluster provisioning remain out of scope
- legacy positional targets like `devnet` still resolve through `networkProfiles` for compatibility

## Boundary Reminder

`deploy` mutates only the resolved ledger endpoint. It does not replace validator operator runbooks, upstream runtime implementations, or wallet/Scan infrastructure.
