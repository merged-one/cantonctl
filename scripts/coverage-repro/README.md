# Coverage Attribution Repro

This directory isolates two coverage behaviors seen in the main unit suite.

## Repo strategy

The repo now defaults coverage runs to Istanbul in [vitest.config.ts](/Users/charlesdusek/Code/cantonctl/vitest.config.ts) and keeps V8 available via `COVERAGE_PROVIDER=v8`.

Use these commands for ongoing triage:

```bash
npm run test:coverage
npm run test:coverage:strict
npm run test:coverage:v8
npm run test:coverage:strict:v8
npm run test:coverage:compare-providers
```

Interpretation:

- Prefer the Istanbul report as the authoritative strict gate.
- Use the provider compare script to identify files with large V8 vs Istanbul deltas.
- Treat large deltas as tooling-noise candidates first.
- Treat files that remain low under Istanbul as genuine coverage backlog.

## 1. Generic command patterns that do **not** reproduce the bug

These stay stable under V8 coverage:

```bash
npx vitest run --config scripts/coverage-repro/vitest.config.ts scripts/coverage-repro/stable-derived-mixed.test.ts --coverage --coverage.include=scripts/coverage-repro/stable-derived.ts
```

Expected outcome:

- `stable-derived.ts` credits `run()` correctly
- the prelude lines before the `try` block are covered
- the only misses are the intentionally uncalled override bodies

## 2. Real-file noise case from the production suite

`cleaner.ts` is fully covered when run alone:

```bash
npx vitest run --project unit src/lib/cleaner.test.ts --coverage --coverage.include=src/lib/cleaner.ts
```

But it drops when an unrelated covered command test joins the same run:

```bash
npx vitest run --project unit src/lib/cleaner.test.ts src/commands/splice-stable.test.ts --coverage --coverage.include=src/lib/cleaner.ts --coverage.include=src/commands/ans/create.ts
```

Expected outcome:

- alone: `cleaner.ts` reports `100%`
- combined: `cleaner.ts` drops to roughly `67.74%`

That makes `cleaner.ts` a deterministic attribution/remapping problem, not a genuine uncovered-logic gap.

## 3. Real-file case that still undercounts even in isolation

`ans/create.ts` stays undercounted even when isolated with its own test file:

```bash
npx vitest run --project unit src/commands/splice-stable.test.ts --coverage --coverage.include=src/commands/ans/create.ts
```

Expected outcome:

- `src/commands/ans/create.ts` reports about `88.23%` statements / `0%` functions
- lines around the `parse()` / `outputFor()` prelude remain uncovered

This means the broad-suite attribution issue does **not** fully explain `ans/create.ts`.
The remaining miss there is either file-specific remapping noise or a real gap in how that exact file is exercised.
