# ADR-0007: Dual-Interface Console (REPL + Scripting)

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
Developers need both interactive exploration (querying contracts, inspecting parties) and scriptable automation (CI pipelines, batch operations). Foundry solved this by splitting Chisel (interactive REPL) from Cast (scripted CLI). Canton console already exists but requires Scala/JVM knowledge, which is a barrier for the 71% EVM developer audience.

## Decision
We provide `cantonctl console` as a TypeScript-based interactive REPL with table-formatted output for exploration, and `cantonctl exec` for scripted single-command execution suitable for CI and automation. Both share the same command grammar, so developers learn one syntax. This replaces the need for developers to learn Scala to use Canton console.

## Consequences
**Positive:**
- Unified command grammar between REPL and scripting reduces learning curve
- TypeScript-based console eliminates the JVM/Scala barrier for EVM developers
- Scripting mode enables CI/CD integration and automation workflows

**Negative:**
- Two interfaces to maintain with shared grammar adds implementation complexity
- TypeScript REPL will be slower than native Canton console for heavy operations
- Must keep command grammar in sync across both modes

## References
- [Dual-interface design](../DESIGN_DECISIONS.md#decision-7-dual-interface-console-repl--scripting)
- Foundry Chisel + Cast split; Canton console requires Scala/JVM knowledge
