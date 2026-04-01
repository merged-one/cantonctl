# ADR-0014: Multi-Node Development Topology via Docker

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context

ADR-0004 established sandbox-first local development for zero-Docker onboarding, with Docker as an opt-in upgrade path via `cantonctl dev --full` for multi-node topologies. Phases 0-5 delivered the sandbox mode. This ADR defines the architecture for `--full` mode.

The core problem: single-sandbox mode (`dpm sandbox`) runs one participant with in-memory storage. This is fast but hides multi-party, multi-node, and cross-participant bugs that appear in production Canton networks. Developers need a realistic multi-node environment that is still simple to start.

### Forces

1. **Realism vs. speed**: Production Canton networks have multiple participants connected through a synchronizer (sequencer + mediator + topology manager). Single-sandbox mode collapses all of this.
2. **Docker dependency**: Multi-node requires a Canton process image. The `dpm sandbox` command only supports single-participant mode.
3. **Resource efficiency**: cn-quickstart requires 8GB+ Docker RAM. `dev --full` must be lighter.
4. **Configuration generation**: Developers should not write HOCON config or Docker Compose files — cantonctl generates everything from `cantonctl.yaml`.
5. **Conformance kit pattern**: merged-one/canton-upgrade-conformance-kit-demo demonstrates colocating multiple Canton nodes in a single container, reducing resource overhead while maintaining logical separation.

### Best Practice Criteria

The following criteria were evaluated to select the architecture:

| Criterion | Description | Weight |
|-----------|-------------|--------|
| **Zero manual config** | Works from `cantonctl.yaml` alone — no HOCON, no docker-compose.yml | Must-have |
| **Health-gated startup** | Each layer waits for dependencies to be healthy before proceeding | Must-have |
| **Graceful lifecycle** | Clean startup, shutdown, no zombie containers or volumes | Must-have |
| **Hot-reload across nodes** | File changes trigger rebuild + DAR upload to all participants | Must-have |
| **Observable status** | All nodes, ports, parties, health visible via status output | Must-have |
| **Resource efficient** | Runs on 4GB Docker RAM (half of cn-quickstart) | Should-have |
| **In-memory default** | Fastest possible startup; no Postgres required for basic use | Should-have |
| **Persistent storage option** | Postgres mode for state that survives restarts | Nice-to-have |
| **DI/testable** | Full dependency injection, no vi.mock() | Must-have (Rule #2) |
| **Deterministic ports** | Predictable port scheme derived from config | Must-have |

### Alternatives Considered

**A. Multi-container: one container per Canton node**
- Each participant and the synchronizer run in separate Docker containers
- Pro: Closest to production architecture
- Con: 3-5 containers, complex networking, high resource usage, slow startup
- Rejected: Too heavy for a dev tool

**B. Single-container colocation (conformance kit pattern)**
- One Canton container runs all logical nodes (synchronizer + N participants), differentiated by port prefix
- Pro: Single container, shared JVM, efficient memory, fast startup, proven by conformance kit
- Con: Less production-realistic than multi-container
- Selected: Best balance of realism and resource efficiency

**C. Native multi-node (no Docker)**
- Run `canton daemon --config` locally with generated HOCON
- Pro: No Docker required
- Con: Requires Canton binary on PATH (not just `dpm`), platform-specific, hard to manage process tree
- Rejected: Docker provides consistent cross-platform behavior

## Decision

`cantonctl dev --full` generates Docker Compose and Canton HOCON configuration from `cantonctl.yaml`, then orchestrates a single-container multi-node topology:

### Architecture

```
cantonctl.yaml  →  topology.ts generates:
                    ├── docker-compose.yml (temporary)
                    ├── canton.conf (HOCON, temporary)
                    └── bootstrap.canton (topology script, temporary)

Docker Compose runs:
  canton (single container):
    ├── synchronizer (embedded sequencer + mediator + topology manager)
    ├── participant-1 (JSON API on port prefix 1)
    ├── participant-2 (JSON API on port prefix 2)
    └── ... (one per party group or explicit participant config)
```

### Key Design Decisions

1. **Single Canton container** with multiple logical nodes (conformance kit pattern). Reduces Docker overhead from 3-5 containers to 1.

2. **Generated temporary configs** in a `.cantonctl/` directory within the project. Not committed to git (added to .gitignore by scaffold). Regenerated on every `dev --full` start.

3. **In-memory storage by default** — no Postgres container needed. Fastest startup. State resets on restart, which is acceptable for development.

4. **Port assignment scheme**: Base port (default 10000) + participant index * 10 + offset. Each participant gets: admin API (+1), ledger API (+2), JSON API (+3), health HTTP (+4).

5. **Health-gated startup**: Poll each participant's JSON API `/v2/version` endpoint. Only proceed to party provisioning when all participants are healthy.

6. **Canton image**: Use `ghcr.io/digital-asset/decentralized-canton-sync/docker/canton` (same registry as conformance kit). Version pinned to match SDK version in config.

7. **Party-to-participant mapping**: Parties are assigned to participants based on their `role` in config. `operator` parties go to participant-1, `participant` parties go to participant-2, etc. Simple round-robin for additional participants.

8. **Hot-reload**: On `.daml` file change, rebuild DAR, then upload to ALL participants (since packages must be available on every participant that will execute the contract).

9. **New error codes**: E3004 (DOCKER_NOT_AVAILABLE), E3005 (DOCKER_COMPOSE_FAILED) in the E3xxx sandbox/node range.

10. **New module `topology.ts`**: Pure function that takes `CantonctlConfig` and returns generated file contents (Docker Compose YAML, Canton HOCON, bootstrap script). Fully testable without Docker.

11. **New module `docker.ts`**: Manages Docker Compose lifecycle (up, down, health check, logs). All subprocess calls via injected `ProcessRunner`.

### Startup Sequence

1. Check Docker is available (`docker compose version`)
2. Generate topology configs from `cantonctl.yaml`
3. Write configs to `.cantonctl/` directory
4. Run `docker compose up -d`
5. Poll health endpoints for all participants (conformance kit pattern)
6. Generate JWTs and provision parties on each participant
7. Start file watcher (same as sandbox mode)
8. Display multi-node status table

### Shutdown Sequence

1. Close file watcher
2. Run `docker compose down`
3. Clean up `.cantonctl/` directory (optional, configurable)

## Consequences

**Positive:**
- Developers get multi-node realism with a single flag (`--full`)
- No manual Docker Compose or HOCON authoring
- Resource efficient (single container, in-memory storage)
- Conformance kit pattern is battle-tested
- Full DI means unit tests don't need Docker

**Negative:**
- Requires Docker installed (but only for `--full`, sandbox mode remains Docker-free)
- Single-container colocation is less realistic than multi-container production topology
- Canton Docker image version must track SDK version (potential version mismatch)
- In-memory storage means state lost on restart (acceptable for dev; Postgres mode deferred)

## References

- [ADR-0004: Sandbox-first local development](0004-sandbox-first-local-dev.md) — establishes the sandbox/Docker split
- [ADR-0010: Hybrid architecture](0010-hybrid-architecture.md) — TypeScript orchestrates native subprocesses
- [canton-upgrade-conformance-kit-demo](https://github.com/merged-one/canton-upgrade-conformance-kit-demo) — single-container multi-node pattern, health checking, HOCON config structure
- [DESIGN_DECISIONS.md Decision 4](../DESIGN_DECISIONS.md#decision-4-lightweight-local-dev-sandbox-first-docker-optional) — startup time comparison table
