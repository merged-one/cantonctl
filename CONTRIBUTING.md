# Contributing to cantonctl

Thank you for your interest in contributing to cantonctl. This guide will help you get started.

## Getting Started

```bash
git clone https://github.com/merged-one/cantonctl.git
cd cantonctl
npm install
npm run build
npm test
```

### Prerequisites

Run `cantonctl doctor` to verify your environment, or check manually:

- **Node.js** >= 18
- **Java 21** (for Daml SDK)
- **Daml SDK** 3.4.11 (`curl -sSL https://get.daml.com/ | sh -s 3.4.11`)
- **Docker** (optional, for `dev --full` multi-node E2E tests)

## Architecture Rules

These rules are non-negotiable. PRs that violate them will be requested to change.

1. **Test-first TDD** — Write tests that define the contract, then implement to pass. Never ship untested code.
2. **Dependency injection** — Every I/O module accepts injected dependencies. Zero `vi.mock()` anywhere.
3. **AbortSignal everywhere** — All long-running operations accept AbortSignal for graceful shutdown.
4. **CantonctlError for all errors** — Every error uses a structured error code (E1xxx-E8xxx) with a suggestion and docs URL.
5. **Dual output** — Every command supports `--json` via `OutputWriter`.
6. **Thin command wrappers** — Commands in `src/commands/` are thin oclif wrappers. All logic lives in `src/lib/`.

## Test Structure

```bash
npm test              # 383 unit tests (fast, no external deps)
npm run test:e2e:sdk  # 66 SDK E2E tests (requires Daml SDK + Java)
npm run test:e2e:sandbox  # 9 sandbox E2E tests (requires Canton sandbox)
npm run test:e2e:docker   # 2 Docker E2E tests (requires Docker)
npm run test:all      # All tests
npm run test:coverage # Coverage report
```

## Making Changes

1. **Fork and branch** from `main`
2. **Write tests first** that describe the expected behavior
3. **Implement** the feature or fix
4. **Run `npm test`** to verify all unit tests pass
5. **Run `npm run build`** to verify TypeScript compiles
6. **Run `npm run ci`** for full local CI check (or `./scripts/ci-local.sh --docker` for exact GitHub Actions parity)

## Pull Request Guidelines

- Keep PRs focused on a single concern
- Include tests for new functionality
- Update documentation if you change command behavior
- Ensure all CI checks pass before requesting review

## Code Style

- TypeScript strict mode
- ESLint configuration in the repo
- No `vi.mock()` — use dependency injection
- Factory functions for creating module instances (e.g., `createBuilder({...})`)

## Error Handling

All errors must be `CantonctlError` instances with:
- An error code from the `ErrorCode` enum (E1xxx-E8xxx)
- A human-readable `suggestion` field
- Structured `context` for JSON output

## Design Decisions

Read the [Design Decisions](docs/DESIGN_DECISIONS.md) document and the [14 ADRs](docs/adr/) before proposing architectural changes.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
