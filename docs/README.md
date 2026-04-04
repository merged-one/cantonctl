# `cantonctl` Docs

Start here for the canonical documentation system.

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
- [Status](reference/status.md)
- [LocalNet wrapper](reference/localnet.md)
- [Preflight](reference/preflight.md)
- [Promotion diff](reference/promotion.md)
- [Upgrade checks](reference/upgrade.md)
- [Reset checklist](reference/reset.md)
- [Diagnostics bundle](reference/diagnostics.md)
- [Discovery and profile import](reference/discovery.md)
- [Stable/public canaries](reference/canary.md)
- [SDK config export](reference/sdk-config-export.md)

## Adjunct Workbench Surfaces

- [Serve](reference/serve.md)
- [Playground](reference/playground.md)

Use Daml Studio for the canonical IDE workflow. Use these surfaces when you want a local demo, inspection surface, or profile-aware backend around the same project.

## Stable/Public Splice Workflows

- [Scan](reference/scan.md)
- [Token standard](reference/token-standard.md)
- [CI gates](tasks/ci-gates.md)
- [API stability](reference/api-stability.md)
- [Upstream sources](reference/upstream-sources.md)
- [Examples](examples/README.md)

## Release And Migration

- [v0.4.0 Splice support notes](release-notes/v0.4.0-splice-support.md)
- [vNEXT community-fit release notes](release-notes/vNEXT-community-fit.md)
- [vNEXT net-mode release notes](release-notes/vNEXT-net-mode.md)
- [v0.4.0 Splice support migration](migration/v0.4.0-splice-support.md)
- [vNEXT community-fit migration](migration/vNEXT-community-fit.md)
- [vNEXT net-mode migration](migration/vNEXT-net-mode.md)
