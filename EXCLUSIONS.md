# Coverage Exclusions

This registry documents every allowed `coverage.exclude` entry and every inline `v8 ignore` directive used by the root Vitest coverage policy.

```json
{
  "coverageExclude": {
    "src/**/*.test.ts": {
      "reason": "Tests live beside runtime source but are not shipped CLI code."
    },
    "src/**/*.d.ts": {
      "reason": "Declaration files do not execute at runtime."
    },
    "src/generated/**": {
      "reason": "Generated clients are validated by smoke tests and regeneration checks instead of hand-authored coverage."
    },
    "src/lib/adapters/index.ts": {
      "reason": "Adapter barrel only re-exports runtime modules and type surfaces."
    }
  },
  "inlineV8Ignore": {}
}
```
