# ADR-0005: Bundled Templates + Community Registry

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
Scaffolding approaches span a wide spectrum: Ignite CLI scaffolds everything (powerful but teams outgrow it), while Aptos provides only a package (too minimal for beginners). cantonctl needs to serve five distinct audiences -- first-time Canton developers, DeFi builders, backend developers, and EVM developers via Zenith -- each with different starting points.

## Decision
We bundle 5 templates (basic, token, defi-amm, api-service, zenith-evm) covering the primary developer personas. Community templates are supported via `cantonctl init --from <github-url>` with a `cantonctl-template.yaml` manifest for validation. No centralized registry yet -- Canton's community (41 survey respondents) is too small to justify one. GitHub URLs with convention-over-configuration suffice until the community grows.

## Consequences
**Positive:**
- Each template targets a specific audience, reducing time-to-first-contract
- Community templates scale without gatekeeping via the GitHub URL pattern
- Manifest file enables validation without a centralized registry

**Negative:**
- 5 bundled templates must be maintained and kept current with SDK changes
- No discoverability for community templates without a registry
- Template quality varies across community contributions

## References
- [Template system design](../DESIGN_DECISIONS.md#decision-5-template-system-with-community-registry)
- Scaffolding spectrum analysis across Ignite, Anchor, Foundry, Pop CLI, and Aptos
