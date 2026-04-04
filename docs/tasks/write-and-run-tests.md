# Write and Run Tests

Daml Script tests verify your smart contract logic before deployment. cantonctl wraps the Daml SDK test runner with structured output and CI-friendly JSON.

## Prerequisites

- A cantonctl project with Daml source files in `daml/`
- DPM installed (`dpm` on PATH for the current Canton 3.4 flow)

## Writing Tests

Daml Script tests live alongside your contracts in `daml/` files:

```daml
module Main where

-- Your contract
template Token
  with
    owner : Party
    amount : Int
  where
    signatory owner

-- Your test
testMint = script do
  alice <- allocateParty "Alice"
  submit alice do
    createCmd Token with owner = alice, amount = 100
  pure ()
```

Tests are Daml Script functions that exercise your templates.

## Running Tests

```bash
cantonctl test                        # Run all tests
cantonctl test --filter testMint      # Run specific test
cantonctl test --json                 # JSON output for CI
```

## Reading Output

**Human output:**

```
Running Daml Script tests...
✓ All tests passed

Test Summary

4/4 passed
Done in 2.3s
```

**JSON output** (`--json`):

```json
{
  "success": true,
  "data": {
    "passed": true,
    "output": "Test Summary\n\n4/4 passed",
    "durationMs": 2300
  },
  "timing": { "durationMs": 2300 }
}
```

## Test Failures

When tests fail, cantonctl returns exit code 1 and shows the SDK error output:

```
Running Daml Script tests...
Error: Some tests failed

Script execution error in Main:testTransfer
...

Done in 1.8s
```

The `--json` output includes the failure details in `data.output`.

## CI Integration

```yaml
# GitHub Actions example
- run: cantonctl test --json
  # Exit code 1 on failure, JSON output for parsing
```

## Troubleshooting

| Error | Resolution |
|-------|-----------|
| E2001 (SDK not installed) | Install DPM: `./scripts/install-prerequisites.sh` |
| E5001 (test failed) | Fix the failing test logic in your Daml source |

## Related

- [Reference: test command](../reference/test.md)
- [Reference: build command](../reference/build.md)
