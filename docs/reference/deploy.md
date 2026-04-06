# `cantonctl deploy`

Roll out a built DAR to the resolved profile or legacy target.

`deploy` is the mutating ledger rollout command inside `cantonctl`'s project-local control-plane boundary. It consumes already built DAR artifacts, resolves the target profile, and applies the rollout against official runtime endpoints when the resolved ledger surface is apply-capable.

It does not compile Daml, run codegen, provision infrastructure, or replace official validator or LocalNet lifecycle tooling.

Remote apply uses the resolved operator credential path. It does not reuse sandbox-style fallback tokens for remote mutations.

## Usage

```bash
cantonctl deploy [target] [flags]
```

## Modes

- `--plan`: resolve the target profile, DAR selection, fan-out, and preconditions without contacting the runtime
- `--dry-run`: resolve the DAR and run read-only preflight checks without uploading
- default apply: upload the DAR, record returned package IDs, and report post-deploy checks

## Current Scope

- sandbox single-target rollout
- `canton-multi` fan-out across the generated local topology
- `splice-localnet` rollout against the ledger endpoint exposed by the official LocalNet workspace
- remote profile rollout for apply-capable ledger targets
- structured JSON output for artifact selection, fan-out, target status, and step-by-step rollout state
- explicit operator-auth reporting in plan, dry-run, and apply output

## Official Stack Boundary

- build, test, codegen, and Studio workflows remain owned by DPM and Daml Studio
- Quickstart and the official LocalNet workspace still own runtime lifecycle and provisioning
- `deploy` only targets the resolved ledger endpoint; it does not replace validator, wallet, Scan, or OIDC implementations
- cloud, cluster, and infrastructure provisioning remain out of scope

## Flags

| Flag | Description |
|---|---|
| `[target]` | Optional profile name or legacy network alias |
| `--profile <name>` | Preferred resolved runtime profile |
| `--plan` | Produce a rollout plan without contacting the runtime |
| `--dry-run` | Resolve the DAR and run read-only preflight without uploading |
| `--dar <path>` | Path to a built DAR (otherwise auto-detected from `.daml/dist`) |
| `--party <name>` | Override the local fallback token `actAs` party |
| `--json` | Output the full structured rollout result |

## JSON Highlights

- `artifact`: selected DAR path, size, and whether it was auto-detected or explicit
- `fanOut`: whether the rollout is single-target or local fan-out, plus endpoint provenance
- `targets[]`: per-target endpoint, management class, package ID, and post-deploy checks
- `steps[]`: plan/apply execution detail, including blockers, warnings, and serialized errors
- `auth`: operator credential source, env var name, and scope used for the rollout

## Examples

```bash
cantonctl build
cantonctl auth login devnet --scope operator --token eyJhbGci...
cantonctl deploy --profile sandbox
cantonctl deploy --profile splice-devnet --plan --json
cantonctl deploy devnet --dry-run
cantonctl deploy --profile sandbox --dar ./.daml/dist/demo.dar
```

## Related

- [Auth](auth.md)
- [Status](status.md)
- [Preflight](preflight.md)
