# ADR-0002: Hardhat-Style npm Plugin Architecture

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
Only 3 of 16 surveyed blockchain CLI toolchains have any plugin system. Canton's ecosystem has fragmented community tools (ChainSafe MCP, Lighthouse MCP, CCView API, Tenzro DAML Studio) with no standard integration path. Enterprise users need custom deployment validators, compliance checks, and audit hooks without modifying core tooling.

## Decision
We adopted a Hardhat-inspired runtime environment (CRE) built on oclif's npm plugin system. Plugins are discovered via npm naming convention (`@cantonctl/plugin-*` or `cantonctl-plugin-*`) and integrate through lifecycle hooks (beforeBuild, afterDeploy, onError). Zenith EVM integration is a plugin, not core, keeping the base tool focused on Daml workflows.

## Consequences
**Positive:**
- Community tools can integrate without forking cantonctl
- Enterprise extensions (compliance, audit) plug in cleanly
- Plugin ecosystem becomes a competitive moat, as proven by Hardhat's dominance

**Negative:**
- Plugin API surface becomes a compatibility contract that must be maintained
- Quality control across third-party plugins is difficult
- Additional complexity in config resolution and hook ordering

## References
- [Plugin architecture design](../DESIGN_DECISIONS.md#decision-2-hardhat-style-plugin-architecture-not-monolithic)
- Only 3/16 toolchains have plugins; Hardhat's plugin ecosystem is its primary competitive advantage
