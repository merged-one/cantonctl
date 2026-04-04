# `cantonctl test`

Run Daml Script tests by delegating to the official SDK tooling.

DPM is canonical. `cantonctl test` adds JSON output and companion-friendly ergonomics around the same underlying test command.

## Usage

```bash
cantonctl test [flags]
```

## Behavior

- Uses `dpm test` on current toolchains
- Falls back to `daml test` for older projects when required
- Preserves structured output and ANSI stripping in the `cantonctl` layer

## Flags

| Flag | Description |
|---|---|
| `--filter`, `-f` | Filter tests by name |
| `--json` | Output structured JSON |

## Source

- Command: [`src/commands/test.ts`](../../src/commands/test.ts)
- Logic: [`src/lib/test-runner.ts`](../../src/lib/test-runner.ts)
