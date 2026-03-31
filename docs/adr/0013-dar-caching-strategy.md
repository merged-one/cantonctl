# ADR-0013: DAR Caching via mtime Comparison

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context

The `build` command needs a caching strategy to skip unnecessary rebuilds. Research against Daml SDK 3.4.11 showed:

- The SDK has its own incremental build via Shake (interface files + fingerprints)
- But invoking `daml build` still takes ~1.0s even for no-op builds (JVM startup + Shake check)
- For `build --watch` and hot-reload, this 1s overhead per save is noticeable
- The `.dar` file at `.daml/dist/{name}-{version}.dar` has a predictable mtime

Options:
1. **Always rebuild** — simple, rely on SDK's Shake cache. ~1s per invocation.
2. **mtime comparison** — compare `.dar` mtime vs newest `.daml` source mtime. Skip invocation entirely if DAR is newer. ~0ms for no-op.
3. **Content hash** — hash all source files, compare to stored hash. More accurate but slower than mtime.
4. **File watcher events** — only rebuild on actual change events (used in dev-server already).

## Decision

**mtime comparison for `build` command; file watcher events for `dev` hot-reload.**

The `builder.ts` module will:
1. Find the `.dar` file in `.daml/dist/`
2. Find all `.daml` files in the `source` directory (from `daml.yaml`)
3. Compare: if `.dar` mtime > max(`.daml` mtimes), skip build
4. If `--force` flag is passed, always rebuild
5. The dev-server continues using chokidar events (more responsive for hot-reload)

## Consequences

**Positive:**
- Zero-cost no-op builds (no JVM startup for unchanged sources)
- Simple implementation (fs.stat comparison)
- Consistent with Make-style caching that developers understand
- `--force` escape hatch when mtime is unreliable (e.g., git checkout)

**Negative:**
- mtime can be wrong after `git checkout` or `cp -p` (mitigated by `--force`)
- Doesn't detect changes in `daml.yaml` (dependency changes) — future improvement
- If user edits a non-`.daml` file that affects compilation, cache is stale

## References

- Daml SDK incremental build timing: 1.4s fresh, 1.0s incremental (JVM overhead)
- Make's mtime-based caching (50+ years of proven reliability)
- Hardhat's approach: content hash of all sources stored in `cache/` directory
