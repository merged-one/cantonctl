# ADR-0004: Sandbox-First, Docker-Optional Local Development

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
The developer survey's top pain point (41%) is that developers must become infrastructure engineers before building. cn-quickstart requires Docker Desktop with 8GB+ RAM, Nix, Gradle, and JDK 21. Foundry's Anvil proved that local chain startup in under 1 second with zero config is achievable and sets the developer experience bar.

## Decision
`cantonctl dev` wraps `dpm sandbox` by default for zero-Docker local development, starting a single Canton participant with in-memory storage in seconds. Docker is opt-in via `cantonctl dev --full` for multi-node topologies. A file watcher (chokidar) enables hot-reload by detecting Daml changes, recompiling, and uploading .dar to the running sandbox -- inspired by Ignite CLI's `chain serve`.

## Consequences
**Positive:**
- Eliminates the 8GB Docker requirement for getting started
- Startup in seconds matches the Anvil benchmark developers expect
- Hot-reload shortens the inner development loop dramatically

**Negative:**
- Single-sandbox mode is less realistic than multi-node Docker topology
- Developers may miss multi-party/multi-node bugs that only appear in full mode
- Dependency on dpm sandbox availability and behavior

## References
- [ADR index](README.md) — canonical replacement for the retired monolithic design-decisions document
- 41% survey pain point on setup; cn-quickstart 8GB Docker requirement; Anvil <1s benchmark
