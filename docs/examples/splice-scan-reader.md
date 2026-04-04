# Splice Scan Reader Example

Create the scaffold:

```bash
cantonctl init my-scan-reader --template splice-scan-reader
```

What it generates:

- A profile-based `cantonctl.yaml` with local sandbox and remote `splice-devnet` targets
- `daml/Main.daml` with a `ScanBookmark` contract for tracking application cursors
- `scripts/read-scan-updates.mjs` that reads the stable Scan `POST /v2/updates` surface

Stable-surface policy:

- Uses direct Scan reads by default
- Leaves scan-proxy and validator-internal wiring out of the generated starter
- Keeps local Daml code separate from remote Scan ingestion

Suggested next steps:

```bash
cd my-scan-reader
cantonctl build
cantonctl test
cantonctl scan updates --profile splice-devnet --token "$BEARER_TOKEN"
node scripts/read-scan-updates.mjs
```
