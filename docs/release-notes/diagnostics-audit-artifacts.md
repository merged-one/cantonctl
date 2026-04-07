# Diagnostics Audit Artifacts

`cantonctl diagnostics bundle` now exports a fuller support bundle:

- runtime inventory in `inventory.json`
- drift classification in `drift.json`
- the last stored control-plane operation summary in `last-operation.json`

Control-plane workflows persist the latest deploy, promotion, upgrade, or reset summary under `.cantonctl/control-plane/last-operation.json` on a best-effort basis. Bundle output redacts obvious secret-bearing fields before writing JSON to disk.

This remains a support surface, not a monitoring backend or observability replacement.
