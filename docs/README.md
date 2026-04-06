# `cantonctl` Docs

Start here for the canonical documentation system.

This docs tree reflects `cantonctl@0.3.5` on `main`.

The docs policy is simple:

- [CURRENT_STATE.md](CURRENT_STATE.md) is the live product snapshot
- [BEST_PRACTICES.md](BEST_PRACTICES.md) explains how docs stay accurate
- [adr/README.md](adr/README.md) indexes accepted architecture decisions
- `docs/reference/*.md` is the source of truth for user-facing command behavior
- release and migration notes capture change history

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
- [LocalNet wrapper](reference/localnet.md)
- [Readiness gate](reference/readiness.md)
- [Preflight](reference/preflight.md)
- [Promotion rollout](reference/promotion.md)
- [Upgrade checks](reference/upgrade.md)
- [Reset checklist](reference/reset.md)
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

- [Stable/public Splice support notes](release-notes/stable-public-splice-support.md)
- [Community-fit release notes](release-notes/community-fit.md)
- [Net-mode release notes](release-notes/net-mode.md)
- [Profile-first deploy release notes](release-notes/profile-first-deploy.md)
- [Promotion-rollout release notes](release-notes/promotion-rollout.md)
- [Operator-auth release notes](release-notes/operator-auth.md)
- [Stable/public Splice support migration](migration/stable-public-splice-support.md)
- [Community-fit migration](migration/community-fit.md)
- [Net-mode migration](migration/net-mode.md)
- [Profile-first deploy migration](migration/profile-first-deploy.md)
- [Promotion-rollout migration](migration/promotion-rollout.md)
- [Operator-auth migration](migration/operator-auth.md)
