# `cantonctl serve`

Start the profile-aware Canton IDE Protocol backend.

This is an adjunct workbench backend for local demos, inspections, and editor integrations. Daml Studio remains the canonical IDE.

## Usage

```bash
cantonctl serve
cantonctl serve --profile splice-devnet --no-sandbox
cantonctl serve --json
```

## What It Is For

- local profile-aware inspection
- a backend for the browser workbench
- future or custom editor integrations
- support-oriented service summaries around the active profile

## What It Is Not

- not the canonical Daml authoring workflow
- not a replacement for Daml Studio
- not a production application backend

## Source

- Command: [`src/commands/serve.ts`](../../src/commands/serve.ts)
- Backend: [`src/lib/serve.ts`](../../src/lib/serve.ts)
