# `cantonctl build`

Compile Daml contracts and optionally generate bindings by delegating to the official SDK tooling.

DPM is canonical. `cantonctl build` exists so profile-aware workflows, JSON output, and companion commands can sit on top of the same build result.

## Usage

```bash
cantonctl build [flags]
```

## Behavior

- Uses `dpm build` on current toolchains
- Falls back to `daml build` for older projects when only the legacy CLI is available
- Keeps DAR caching and JSON output in the `cantonctl` layer
- Runs code generation only when requested

## When To Use It

- Use `dpm build` when you want the official low-level CLI directly
- Use `cantonctl build` when you want that same build step inside a profile-aware, JSON-first workflow

## Flags

| Flag | Description |
|---|---|
| `--codegen`, `-c` | Run SDK code generation after a successful build |
| `--no-codegen` | Explicitly skip code generation |
| `--force` | Ignore the DAR cache and rebuild |
| `--watch`, `-w` | Watch `daml/` for changes and rebuild automatically until interrupted |
| `--json` | Output structured JSON |

## Watch Mode

`cantonctl build --watch` performs an initial build, watches `.daml` sources under `daml/`, and rebuilds on change. In interactive mode it stays attached until `Ctrl+C` or `q`.

Watch mode is build-only. If you also need generated bindings, rerun `cantonctl build --codegen` after the watched build finishes.

## Source

- Command: [`src/commands/build.ts`](../../src/commands/build.ts)
- Logic: [`src/lib/builder.ts`](../../src/lib/builder.ts)
