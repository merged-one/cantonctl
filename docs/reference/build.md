# cantonctl build

Compile Daml contracts and optionally generate TypeScript bindings.

## Usage

```bash
cantonctl build [flags]
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--codegen` | `-c` | `false` | Generate TypeScript bindings after compilation |
| `--no-codegen` | — | — | Explicitly skip code generation |
| `--force` | — | `false` | Force rebuild even if DAR is up to date |
| `--json` | — | `false` | Output result as JSON |

## Behavior

### Compilation
Delegates to `dpm build` or `daml build` (auto-detected). Produces a `.dar` archive at `.daml/dist/{name}-{version}.dar`.

### Caching (ADR-0013)
Before invoking the SDK, compares the `.dar` modification time against all `.daml` source files. If the DAR is newer than all sources, the build is skipped. Use `--force` to override (e.g., after `git checkout`).

### Code Generation
With `--codegen`, runs `dpm codegen ts` (or `daml codegen js`) after a successful build to produce TypeScript bindings.

## Examples

```bash
cantonctl build                  # Compile (cached if up to date)
cantonctl build --force          # Force rebuild
cantonctl build --codegen        # Compile + generate TypeScript bindings
cantonctl build --json           # JSON output for CI
```

## JSON Output

```json
{
  "success": true,
  "data": {
    "darPath": ".daml/dist/my-app-1.0.0.dar",
    "cached": false,
    "durationMs": 1423
  },
  "timing": { "durationMs": 1423 }
}
```

## Error Codes

| Code | Error | Resolution |
|------|-------|------------|
| E2001 | SDK not installed | Install dpm or daml |
| E4001 | Daml compilation failed | Fix errors in .daml source files |
| E4002 | DAR not found | Build succeeded but no .dar produced. Check daml.yaml. |

## Source

- Command: [`src/commands/build.ts`](../../src/commands/build.ts)
- Logic: [`src/lib/builder.ts`](../../src/lib/builder.ts)
- ADRs: [ADR-0011](../adr/0011-build-wraps-sdk.md), [ADR-0013](../adr/0013-dar-caching-strategy.md)
