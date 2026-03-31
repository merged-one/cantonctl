# cantonctl test

Run Daml Script tests with structured output.

## Usage

```bash
cantonctl test [flags]
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--filter` | `-f` | — | Filter tests by name pattern |
| `--json` | — | `false` | Output results as JSON (for CI) |

## Behavior

Delegates to `dpm test` or `daml test` (auto-detected). Captures the exit code to determine pass/fail and forwards the SDK's output with ANSI codes stripped (per ADR-0012).

- **Exit code 0** → all tests passed
- **Exit code 1** → one or more tests failed (command exits with code 1)
- **SDK errors** (E2001, etc.) → propagated as CantonctlError

The `--filter` flag passes `--test-pattern <pattern>` to the underlying SDK command.

## Examples

```bash
cantonctl test                        # Run all tests
cantonctl test --filter testTransfer  # Run matching tests only
cantonctl test --json                 # JSON output for CI
```

## JSON Output

```json
{
  "success": true,
  "data": {
    "passed": true,
    "output": "Test Summary\n...",
    "durationMs": 1795
  },
  "timing": { "durationMs": 1795 }
}
```

On failure:
```json
{
  "success": false,
  "data": {
    "passed": false,
    "output": "test failed: Main:testTransfer...",
    "durationMs": 2100
  }
}
```

## Error Codes

| Code | Error | Resolution |
|------|-------|------------|
| E2001 | SDK not installed | Install dpm or daml |
| E5001 | Test execution failed | Review failing test output |

## Source

- Command: [`src/commands/test.ts`](../../src/commands/test.ts)
- Logic: [`src/lib/test-runner.ts`](../../src/lib/test-runner.ts)
- ADR: [ADR-0012](../adr/0012-test-output-parsing.md)
