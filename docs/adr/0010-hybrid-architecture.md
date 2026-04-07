# ADR-0010: Hybrid Architecture (TypeScript Shell + Native Subprocesses)

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context
Hardhat 3 proved the hybrid pattern works: they rewrote the Ethereum Development Runtime (EDR) in Rust for performance while keeping the plugin/DX layer in TypeScript. cantonctl faces the same tension -- the user-facing layer benefits from TypeScript's ecosystem and plugin system, but heavy operations like Daml compilation and test execution are better handled by existing native tools.

## Decision
cantonctl uses TypeScript for the user-facing shell (command parsing, config resolution, plugin system, output formatting, interactive prompts) and delegates heavy operations to native subprocesses (`dpm build`, `dpm test`, Canton sandbox, Docker). The key principle is: never rewrite what dpm already does well. cantonctl orchestrates and extends; it does not replace the Daml SDK. Future native addons are possible if hot-reload latency becomes a bottleneck.

## Consequences
**Positive:**
- Leverages existing dpm/Daml SDK investment rather than reimplementing it
- TypeScript shell enables the plugin ecosystem while native subprocesses handle performance
- Follows a proven pattern validated by Hardhat 3's EDR architecture

**Negative:**
- Subprocess orchestration adds error handling complexity (exit codes, stderr parsing)
- Runtime dependency on dpm and Canton SDK being installed and on PATH
- IPC overhead between TypeScript shell and native subprocesses for frequent operations

## References
- [ADR index](README.md) — canonical replacement for the retired monolithic design-decisions document
- Hardhat 3 EDR pattern; principle of never rewriting what dpm does well
