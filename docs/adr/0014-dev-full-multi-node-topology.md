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

## Implementation Addendum (2026-03-31)

The following decisions were made during implementation and are documented here as rationale for future maintainers.

### Canton 3.4.x HOCON Schema: Sequencers + Mediators (not legacy Domains)

Canton 3.4.x deprecated the `domains {}` HOCON block in favor of explicit `sequencers {}` and `mediators {}` blocks. The generated HOCON uses:

```hocon
canton {
  sequencers {
    sequencer1 {
      storage.type = memory
      public-api { address = "0.0.0.0"; port = 10002 }
      admin-api { address = "0.0.0.0"; port = 10001 }
      sequencer.type = BFT
    }
  }
  mediators {
    mediator1 {
      storage.type = memory
      admin-api { address = "0.0.0.0"; port = 10101 }
    }
  }
  participants { ... }
}
```

**Justification**: The `domains {}` block produces "At least one node must be defined" errors on Canton 3.4.x. The new schema was discovered by inspecting the example configs inside the Canton Docker image at `/app/examples/01-simple-topology/simple-topology.conf`.

### Bootstrap Script: `synchronizers.connect_local` (not `domains.connect_local`)

Canton 3.4.x renamed the participant API from `domains` to `synchronizers`:

```scala
participant1.synchronizers.connect_local(sequencer1, alias = "da")
utils.retry_until_true { participant1.synchronizers.active("da") }
```

**Justification**: The `domains.connect_local` API no longer exists in Canton 3.4.x. The `bootstrap` DSL object provides `synchronizer_local()` (not the deprecated `domain()`).

### Custom Docker Entrypoint (Ammonite Name Collision Bypass)

The Canton Docker image's default `entrypoint.sh` wraps the bootstrap script via Ammonite:

```scala
// bootstrap-entrypoint.sc (image's wrapper)
import $file.bootstrap
bootstrap.main()
```

This imports our bootstrap script as a `bootstrap` object, which shadows the Canton DSL's built-in `bootstrap` object (needed for `bootstrap.synchronizer_local()`). The result is a compilation error: `bootstrap` resolves to our file's self-reference, not the Canton DSL.

**Solution**: Bypass the image's entrypoint entirely with a custom Docker entrypoint:

```yaml
entrypoint: ["/app/bin/canton"]
command:
  - daemon
  - --no-tty
  - --config
  - /app/app.conf
  - --bootstrap
  - /canton/bootstrap.canton
```

This invokes the Canton binary directly, which loads the bootstrap script without Ammonite's `import $file` wrapper. The `--bootstrap` flag passes the script directly to Canton's DSL interpreter.

**Justification**: There is no way to rename the Canton DSL's `bootstrap` object or the image's wrapper file. The only reliable solution is to bypass the wrapper entirely. This is also more explicit and avoids depending on undocumented wrapper behavior.

### Address Binding: `0.0.0.0` for All APIs

Canton defaults all API address bindings to `127.0.0.1`, which is unreachable from the Docker host even with port forwarding. Docker's `--publish` flag maps host→container ports but cannot intercept traffic to `127.0.0.1` inside the container (only `0.0.0.0`).

All API blocks (ledger-api, admin-api, http-ledger-api, public-api) explicitly bind to `0.0.0.0`:

```hocon
ledger-api {
  address = "0.0.0.0"
  port = 10012
}
```

**Justification**: Verified empirically — `docker exec curl localhost:20013` succeeds but host `curl localhost:20013` fails (exit 56, empty response) when using the default `127.0.0.1` binding. Adding `address = "0.0.0.0"` resolves this.

### E2E Docker Test Strategy

The E2E Docker tests (`test/e2e/dev-full.e2e.test.ts`) follow these principles:

1. **Triple-layer cleanup**: (1) in-test `afterAll` calls `server.stop()`, (2) fallback `docker compose down` if stop fails, (3) CI `if: always()` step catches anything that leaks
2. **Port isolation**: Uses `basePort: 20000` to avoid conflicts with sandbox tests (5xxx/7xxx ports)
3. **Skip guards**: `describe.skipIf` when Docker, Canton image, or Daml SDK is unavailable — `npm test` never fails on machines without Docker
4. **CI image caching**: GitHub Actions uses `docker save/load` with `actions/cache` to avoid pulling the ~500MB Canton image on every run
5. **vitest `forks` pool**: Prevents JVM child process cleanup issues (same rationale as sandbox E2E tests per vitest.config.ts comments)

## References

- [ADR-0004: Sandbox-first local development](0004-sandbox-first-local-dev.md) — establishes the sandbox/Docker split
- [ADR-0010: Hybrid architecture](0010-hybrid-architecture.md) — TypeScript orchestrates native subprocesses
- [canton-upgrade-conformance-kit-demo](https://github.com/merged-one/canton-upgrade-conformance-kit-demo) — single-container multi-node pattern, health checking, HOCON config structure
- [ADR index](README.md) — canonical replacement for the retired monolithic design-decisions document
