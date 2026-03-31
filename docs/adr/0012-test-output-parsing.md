# ADR-0012: Test Output Parsing Strategy

**Status:** Accepted
**Date:** 2026-03-31
**Authors:** Charles Dusek

## Context

Phase 3 requires implementing the `test` command. The Daml SDK test runner has several quirks discovered during research:

1. **Test discovery is module-based.** Scripts named `testFoo : Script ()` are discovered within compiled modules, not by scanning test directories. The test file must be a valid Daml module imported by the project.
2. **Output goes to stderr** with ANSI formatting (`[4;1m` bold/underline headers, `[0;91m` red errors).
3. **Coverage report is always emitted** showing template/choice exercise percentages.
4. **JUnit XML output** via `--junit <path>` flag — but currently shows `tests="0"` for script-based tests (SDK limitation for some test patterns).
5. **`--test-pattern PATTERN`** filters which scripts run.
6. **No structured JSON output** from the SDK.

Options considered:
1. **Parse stderr text** — fragile, ANSI codes change between versions
2. **Use JUnit XML** — machine-readable but incomplete for script tests
3. **Capture exit code + raw output** — simple, reliable, present output as-is
4. **Run scripts via Ledger API** — reimplements test runner (too complex)

## Decision

**Capture exit code + pass through output, with structured wrapper.**

The `test` command will:
1. Run `DamlSdk.test({projectDir, filter})` which delegates to `dpm test` / `daml test`
2. Capture exit code: 0 = all passed, 1 = failures
3. Pass through SDK output to the user (strip ANSI in `--json` mode)
4. Wrap in structured result: `{success, data: {passed: boolean, output, durationMs}}`
5. Request JUnit XML as a secondary artifact when available (`--junit` flag passthrough)

We do NOT:
- Parse individual test names from stderr (fragile)
- Count pass/fail numbers (SDK doesn't emit structured counts reliably)
- Reimplement test discovery or execution

For `--json` mode, the output is:
```json
{
  "success": true,
  "data": {
    "passed": true,
    "output": "...stripped ANSI...",
    "durationMs": 1234
  }
}
```

## Consequences

**Positive:**
- Zero coupling to SDK's output format
- Exit code is the most reliable signal and never changes
- Users see the same output they'd see from `dpm test` directly
- JUnit XML passthrough enables CI integration (GitHub Actions, etc.)

**Negative:**
- Can't report individual test pass/fail counts in JSON mode
- Can't provide per-test timing breakdowns
- If SDK improves structured output in future versions, we'd need to update to take advantage

## References

- Daml SDK 3.4.11 test behavior research (session 2026-03-31)
- Hardhat's approach: wraps Mocha/Node test runner, adds HRE injection
- Foundry's approach: native test runner with per-test gas reporting
