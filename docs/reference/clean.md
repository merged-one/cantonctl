# cantonctl clean

Remove build artifacts from the project directory.

## Usage

```bash
cantonctl clean [flags]
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--all` | `false` | Also remove `node_modules/` |
| `--force` | `false` | Skip confirmation prompt (for CI) |
| `--json` | `false` | Output result as JSON |

## What Gets Removed

**Default** (no flags):
- `.daml/` — Daml build cache and compiled artifacts
- `dist/` — TypeScript compilation output

**With `--all`**:
- Everything above, plus `node_modules/`

Directories that don't exist are silently skipped.

## Examples

```bash
cantonctl clean                  # Confirm, then remove .daml/ and dist/
cantonctl clean --force          # Remove without prompting (CI-safe)
cantonctl clean --all --force    # Remove everything including node_modules/
cantonctl clean --json           # JSON output, no confirmation
```

## JSON Output

```json
{
  "success": true,
  "data": {
    "removed": [".daml", "dist"],
    "skipped": []
  },
  "timing": { "durationMs": 42 }
}
```

## Source

- Command: [`src/commands/clean.ts`](../../src/commands/clean.ts)
- Logic: [`src/lib/cleaner.ts`](../../src/lib/cleaner.ts)
