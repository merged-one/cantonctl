# Compatibility And Spec Sync

## `cantonctl compat check`

Check a resolved runtime profile against the stable upstream surfaces tracked in `src/lib/upstream/manifest.ts`.

### Usage

```bash
cantonctl compat check [profile] [--json]
```

### What It Checks

1. Resolves the requested profile, or the `default-profile` when omitted.
2. Lists the configured services for that profile.
3. Classifies each service against the manifest stability policy:
   - stable tracked surfaces pass
   - reference-only or operator-only surfaces warn
   - config-only surfaces warn because no stable upstream contract is enforced yet
4. Compares `project.sdk-version` against the pinned Canton compatibility baseline.

### Examples

```bash
cantonctl compat check
cantonctl compat check sandbox
cantonctl compat check splice-devnet --json
```

### JSON Shape

```json
{
  "success": true,
  "data": {
    "profile": {
      "name": "sandbox",
      "kind": "sandbox",
      "experimental": false
    },
    "services": [
      {
        "name": "ledger",
        "endpoint": "http://localhost:7575",
        "stability": "stable-external",
        "sourceIds": ["canton-json-ledger-api-openapi"]
      }
    ],
    "checks": [
      {
        "name": "Project SDK",
        "status": "pass",
        "expected": "3.4.11",
        "actual": "3.4.11",
        "detail": "Project SDK 3.4.11 matches the pinned Canton compatibility baseline.",
        "sourceIds": ["canton-json-ledger-api-openapi"]
      },
      {
        "name": "Service ledger",
        "status": "pass",
        "detail": "ledger is backed by a stable upstream contract tracked in the manifest.",
        "sourceIds": ["canton-json-ledger-api-openapi"]
      }
    ],
    "passed": 2,
    "warned": 0,
    "failed": 0
  }
}
```

## `cantonctl codegen sync`

Sync the manifest-managed upstream specs and regenerate the stable generated clients.

### Usage

```bash
cantonctl codegen sync [--json]
```

### Behavior

This command wraps the existing repository-maintainer workflow:

1. `npm run codegen:fetch-specs`
2. `npm run codegen:generate-types`

It does not add new generation policy. It keeps the command surface aligned with the manifest-driven stable-surface boundary already in the repo.

## Source

- Compatibility lib: [`src/lib/compat.ts`](../../src/lib/compat.ts)
- Command: [`src/commands/compat/check.ts`](../../src/commands/compat/check.ts)
- Command: [`src/commands/codegen/sync.ts`](../../src/commands/codegen/sync.ts)
