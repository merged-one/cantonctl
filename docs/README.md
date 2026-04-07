# `cantonctl` Docs

Start here for the canonical documentation system.

This docs tree reflects `cantonctl@0.3.5` on `main`.

The docs policy is simple:

- [CURRENT_STATE.md](CURRENT_STATE.md) is the live product snapshot
- [BEST_PRACTICES.md](BEST_PRACTICES.md) explains how docs stay accurate
- [adr/README.md](adr/README.md) indexes accepted architecture decisions
- `docs/reference/*.md` is the source of truth for user-facing command behavior
- release and migration notes capture change history for command-scope, boundary, and terminology changes

## Start Here

- [Current state](CURRENT_STATE.md)
- [Best practices](BEST_PRACTICES.md)
- [Ecosystem fit](concepts/ecosystem-fit.md)
- [When to use official tooling vs `cantonctl`](concepts/when-to-use-which-tool.md)
- [Target users](concepts/target-users.md)
- [Non-goals](concepts/non-goals.md)

## Core Workflows

- [Configuration](reference/configuration.md)
- [Topology](reference/topology.md)
- [Auth](reference/auth.md)
- [Compatibility](reference/compatibility.md)
- [Operator surfaces](reference/operator.md)
- [Deploy](reference/deploy.md)
- [Status](reference/status.md)
- [Doctor](reference/doctor.md)
- [LocalNet wrapper](reference/localnet.md)
- [Readiness gate](reference/readiness.md)
- [Preflight](reference/preflight.md)
- [Promotion rollout](reference/promotion.md)
- [Upgrade workflow](reference/upgrade.md)
- [Reset workflow](reference/reset.md)
- [Diagnostics bundle](reference/diagnostics.md)
- [Discovery and profile import](reference/discovery.md)
- [Stable/public canaries](reference/canary.md)
- [SDK config export](reference/sdk-config-export.md)

## Stable/Public Splice Workflows

- [Scan](reference/scan.md)
- [Token standard](reference/token-standard.md)
- [CI gates](tasks/ci-gates.md)
- [API stability](reference/api-stability.md)
- [Upstream sources](reference/upstream-sources.md)
- [Examples](examples/README.md)

## Release And Migration

- [Release notes](release-notes/)
- [Migration guides](migration/)
