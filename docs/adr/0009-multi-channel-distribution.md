# ADR-0009: Multi-Channel Distribution (npm + Homebrew + Binary)

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
Foundry's `foundryup` and Starknet's `starkup` proved that single-command install is critical for developer adoption. cantonctl must reach three distinct audiences: the 71% EVM developers (npm ecosystem), macOS-primary Canton developers (Homebrew), and CI/CD environments that cannot assume Node.js is available.

## Decision
We distribute via three channels: npm as the primary channel (`npm install -g cantonctl` or `npx cantonctl`), Homebrew tap for macOS developers (`brew install merged-one/tap/cantonctl`), and a standalone binary via oclif packaging for CI/Docker environments (`curl -fsSL https://get.cantonctl.dev | bash`). npm is primary because it directly serves the majority EVM audience.

## Consequences
**Positive:**
- npm covers the largest audience segment with zero friction
- Homebrew provides a native-feeling install for macOS developers
- Standalone binary ensures CI/CD and non-Node environments are supported

**Negative:**
- Three distribution channels triple the release and testing burden
- Standalone binary packaging via oclif bundles Node.js, increasing artifact size
- Homebrew tap requires separate maintenance and formula updates

## References
- [Distribution design](../DESIGN_DECISIONS.md#decision-9-multi-channel-distribution)
- foundryup single-command install pattern; npm for 71% EVM audience
