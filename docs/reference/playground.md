# `cantonctl playground`

Open the local browser workbench on top of the Canton IDE Protocol backend.

This is an adjunct demo and inspection surface. It is useful for local exploration, profile-aware service inspection, and workflow demos. Daml Studio remains the canonical IDE.

## Usage

```bash
cantonctl playground
cantonctl playground --profile splice-devnet --no-open
cantonctl playground --port 8080
```

## Positioning

- Use Daml Studio for day-to-day contract authoring
- Use `playground` when you want a local workbench around the same project
- Use `serve` when you want the backend without the browser UI

## Source

- Command: [`src/commands/playground.ts`](../../src/commands/playground.ts)
- Backend: [`src/lib/serve.ts`](../../src/lib/serve.ts)
