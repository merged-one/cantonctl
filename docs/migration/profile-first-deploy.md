# Profile-First Deploy Migration

## Preferred Invocation

Update scripts, docs, and examples to use profile-first deploy invocations:

```bash
cantonctl deploy devnet                    -> cantonctl deploy --profile splice-devnet
cantonctl deploy                          -> cantonctl deploy --profile sandbox
cantonctl deploy devnet --dry-run         -> cantonctl deploy --profile splice-devnet --dry-run
```

Legacy positional targets still work when `networkProfiles` maps them to a profile, but new automation should use `--profile`.

## Build Ownership

`deploy` no longer implies a build-owning pipeline. Build the DAR first with the official stack or `cantonctl build`, then deploy:

```bash
cantonctl build
cantonctl deploy --profile splice-devnet
```

Use `--dar <path>` when the rollout should use a specific artifact instead of `.daml/dist` auto-detection.

## New Non-Mutating Modes

Use `--plan` when you want the resolved rollout contract without touching the runtime. Use `--dry-run` when you want live read-only preflight against the runtime without uploading.
