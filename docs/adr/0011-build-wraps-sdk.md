# ADR-0011: Build Command Wraps SDK (Not Reimplements)

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context

Phase 3 requires implementing the `build` command. Two approaches exist:

1. **Wrap `dpm build` / `daml build`** — shell out to the SDK, parse output, present results
2. **Reimplement compilation** — call the Daml compiler directly (damlc), manage the build graph ourselves

Research against the real Daml SDK (3.4.11) revealed:
- `daml build` produces output on **stderr** (not stdout), using timestamped log format: `2026-03-31 18:56:42.03 [INFO]  [build]`
- The DAR is placed at `.daml/dist/{name}-{version}.dar` (predictable path from `daml.yaml`)
- Incremental builds work via Shake build system with `.hi` interface files
- Build takes ~1.4s for simple projects, ~1.0s incremental
- Exit code 0 on success, 1 on failure
- Error messages include file path, line:column range, severity, and ANSI color codes

The existing `DamlSdk.build()` in `daml.ts` already wraps the SDK subprocess. The `build` command just needs to orchestrate it with caching, codegen, and watch mode.

## Decision

**Wrap the SDK.** The `build` command delegates to `DamlSdk.build()` and adds:
- **DAR discovery:** Glob `.daml/dist/*.dar` for the output artifact (not hardcoded path)
- **Caching:** Compare `.dar` mtime against newest `.daml` source file mtime. Skip build if `.dar` is newer.
- **Codegen:** After successful build, optionally run `DamlSdk.codegen()` for TypeScript bindings
- **Watch mode:** Reuse the chokidar + debounce pattern from dev-server.ts
- **Package ID extraction:** Run `daml damlc inspect` to extract the deterministic content hash

We do NOT:
- Parse the SDK's stderr log format (fragile, changes between versions)
- Manage the Shake build graph ourselves
- Replace the SDK's incremental compilation

## Consequences

**Positive:**
- Inherits SDK's incremental build system for free
- No coupling to internal SDK formats (only public CLI interface)
- Codegen produces typed bindings that work with `@daml/types`
- Same approach as Hardhat (wraps `solc`, doesn't reimplement it)

**Negative:**
- Can't provide richer build diagnostics than what the SDK emits
- Dependent on SDK's error format for user-facing messages (we catch CantonctlError with stderr as context)
- Codegen produces CommonJS modules (not ESM) — may need post-processing for modern frontends

## References

- Daml SDK 3.4.11 build behavior research (session 2026-03-31)
- Design Decision 10: Hybrid Architecture ("Never rewrite what dpm already does well")
- Hardhat's approach: wraps `solc` compiler, adds caching/artifact management on top
