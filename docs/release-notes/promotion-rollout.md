# Promotion Rollout

This release turns `cantonctl promote diff` from a plain comparison helper into the promotion workflow surface for profile-to-profile rollout planning.

Shipped behavior:

- default mode is `plan`, which stays non-mutating and emits the rollout contract without live target inspection
- `--dry-run` runs live target `preflight` and `readiness` gates and returns their reports alongside the promotion result
- `--apply` uses the same shared operation engine and returns the same structured rollout result in apply mode
- promotion JSON now exposes `rollout` as the canonical step, blocker, warning, and runbook contract
- official-stack and operator-owned work stays explicit in runbooks rather than being executed implicitly

This remains inside the project-local companion boundary. It does not add cloud provisioning, validator-internal automation, wallet-internal automation, or ownership of upstream runtimes.
