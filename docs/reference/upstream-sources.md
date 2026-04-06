# Upstream Source Manifest

The canonical source of truth for upstream Canton and Splice inputs is [`src/lib/upstream/manifest.ts`](../../src/lib/upstream/manifest.ts).

This supports the same product rule as the rest of the repo: wrap, do not replace.

## Rules

1. Add or change upstream pins in the manifest first.
2. Generate clients only from manifest entries approved for generation.
3. Prefer official public SDKs when the manifest marks them as `public-sdk`.
4. Keep `experimental-internal` and `operator-only` inputs out of the default product story.
5. Respect selectors for mixed-scope upstream files.
6. Promote approved admin actions only through explicit `operator` commands that cite their manifest source IDs and stability classes.

## Why It Matters

The manifest keeps README text, CI policy, generated clients, and stable/public command surfaces aligned to the same upstream policy instead of drifting into copied URLs or implicit scope expansion.
