# Architecture Decision Records

We use [ADRs](https://adr.github.io/) to document significant architecture and design decisions. Each ADR is a short document capturing a single decision, its context, and consequences.

## Format

Each ADR follows this template:

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNNN
**Date:** YYYY-MM-DD
**Authors:** Name

## Context
What is the issue? What forces are at play?

## Decision
What did we decide?

## Consequences
What are the results? Both positive and negative.

## References
Links to evidence, research, related ADRs.
```

## Rules

1. **ADRs are immutable once accepted.** If a decision changes, write a new ADR that supersedes the old one.
2. **One decision per ADR.** Keep them focused.
3. **Number sequentially.** Never reuse numbers.
4. **Include evidence.** Link to research, survey data, or benchmarks.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-typescript-oclif-framework.md) | TypeScript CLI with oclif framework | Accepted | 2026-03-31 |
| [0002](0002-plugin-architecture.md) | Hardhat-style plugin architecture | Accepted | 2026-03-31 |
| [0003](0003-yaml-configuration.md) | YAML configuration with Zod validation | Accepted | 2026-03-31 |
| [0004](0004-sandbox-first-local-dev.md) | Sandbox-first local development | Accepted | 2026-03-31 |
| [0005](0005-template-system.md) | Template system with community registry | Accepted | 2026-03-31 |
| [0006](0006-testing-value-proposition.md) | Testing as core value proposition | Accepted | 2026-03-31 |
| [0007](0007-dual-interface-console.md) | Dual-interface console (REPL + scripting) | Accepted | 2026-03-31 |
| [0008](0008-deploy-pipeline.md) | Environment-aware deploy pipeline | Accepted | 2026-03-31 |
| [0009](0009-multi-channel-distribution.md) | Multi-channel distribution | Accepted | 2026-03-31 |
| [0010](0010-hybrid-architecture.md) | Hybrid architecture for performance | Accepted | 2026-03-31 |
| [0011](0011-build-wraps-sdk.md) | Build command wraps SDK (not reimplements) | Accepted | 2026-03-31 |
| [0012](0012-test-output-parsing.md) | Test output parsing strategy | Accepted | 2026-03-31 |
| [0013](0013-dar-caching-strategy.md) | DAR caching via mtime comparison | Accepted | 2026-03-31 |
