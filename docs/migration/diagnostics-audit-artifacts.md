# Diagnostics Audit Artifacts

No config migration is required.

If you consume diagnostics bundles in automation, expect three additional files:

- `inventory.json`
- `drift.json`
- `last-operation.json`

`last-operation.json` is present when the project has a stored control-plane workflow summary under `.cantonctl/control-plane/last-operation.json`.
