# ADR-0008: Environment-Aware 7-Step Deploy Pipeline

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
Canton has 5 environment tiers (LocalNet, ScratchNet, DevNet, TestNet, MainNet) each with different access patterns and authentication requirements. JWT authentication is a known developer pain point with multiple token types and signing algorithms. DevNet requires IP whitelisting with a 2-7 day wait. Package ID management is opaque due to content-hash-based versioning.

## Decision
`cantonctl deploy <network>` executes a 7-step pipeline: validate config, build .dar, authenticate (guided JWT setup or saved credentials), pre-flight checks (compatibility, resource estimation), upload .dar to participant nodes, trigger package vetting, and verify deployment via status query. Authentication is guided interactively for first-time setup and cached securely in the OS keychain following NEAR CLI's pattern.

## Consequences
**Positive:**
- Guided authentication abstracts away JWT complexity for developers
- Pre-flight checks prevent failed deployments before they reach the network
- Consistent pipeline across all 5 environment tiers reduces deployment errors

**Negative:**
- 7-step pipeline is opinionated and may not fit all deployment workflows
- OS keychain dependency introduces platform-specific credential storage code
- DevNet's 2-7 day IP whitelisting delay cannot be automated away

## References
- [Deploy pipeline design](../DESIGN_DECISIONS.md#decision-8-environment-aware-deploy-pipeline)
- 5 environment tiers; JWT pain point; DevNet 2-7 day whitelist
