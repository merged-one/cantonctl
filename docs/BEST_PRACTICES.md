# Best Practices

This document defines how to keep repo guidance current without creating stale roadmap or status clutter.

## Canonical Sources Of Truth

Use these sources in this order:

- [`scripts/ci/manifest.js`](../scripts/ci/manifest.js) for CI suite membership, Node/toolchain policy, and GitHub/Docker parity scope
- command help plus `docs/reference/*.md` for user-facing command behavior
- ADRs in [adr/](adr/) for accepted architectural decisions
- release notes and migration notes for change history
- [CURRENT_STATE.md](CURRENT_STATE.md) for the live product snapshot

## Documentation Update Order

Whenever functionality is added or trimmed:

1. Update the command or library implementation
2. Update or add unit and E2E coverage
3. Update command help and `docs/reference/*.md`
4. Update [CURRENT_STATE.md](CURRENT_STATE.md) if the supported feature set changed
5. Add or update an ADR if the architecture or product boundary changed
6. Add release or migration notes when users need to change behavior or terminology
7. Update [README.md](../README.md), [CLAUDE.md](../CLAUDE.md), and [AGENTS.md](../AGENTS.md) only after the underlying implementation and reference docs are correct

## What Not To Add

Do not add or revive:

- roadmap docs
- funding-justification docs
- in-repo status trackers
- phase-prep files
- worklog files
- hard-coded test counts or stale CI snapshots in active docs

Active work tracking belongs in GitHub issues, PRs, and PR checklists.

## ADR Policy

- ADRs capture accepted decisions, not rough brainstorming.
- Accepted ADRs are immutable.
- If the decision changes, write a new ADR instead of rewriting the old one.
- ADRs should link to the implementation or canonical docs they affect.

## Agent And Maintainer Guidance

- Prefer fixing stale docs by deleting or replacing them, not by appending caveats to obsolete plans.
- Avoid duplicating the same policy in multiple docs when one canonical source already exists.
- If a doc drifts from the current command/help surface, update the reference doc and help text first, then update higher-level docs.
- Do not describe a command's current read-only or advisory behavior as a permanent product non-goal unless an accepted ADR makes that boundary explicit.
- If a change affects local runtime behavior, verify it against both native tests and the Docker parity path when applicable.

## Naming And Positioning Rules

- Use "Splice-aware orchestration companion" in top-level positioning.
- Use "project-local control plane" or "day-2 operations layer" when describing `cantonctl`'s ownership boundary.
- Use "wrap, do not replace" when describing ecosystem fit.
- Use `CIP-0103`, not `CIP-103`.
- Use `--net`, not `--full`, for the local multi-node Canton runtime.
- Keep stable/public and experimental boundaries explicit.
- Do not use control-plane language to imply ownership of Quickstart, validator/wallet/scan implementations, or cloud/Kubernetes/Terraform/Helm provisioning.
