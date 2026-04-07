# Remote Diagnostics

Use `cantonctl diagnostics bundle --profile <name>` when you need a support-friendly snapshot of:

- resolved profile and declared services
- app and operator auth summaries without secrets
- compatibility summary
- runtime inventory and endpoint provenance
- drift classification and reconcile guidance
- health probe results
- metrics endpoint reachability
- validator-liveness hints from stable/public scan data
- the last stored deploy, promotion, upgrade, or reset summary when available

If you are debugging rollout or credential issues, include `.cantonctl/control-plane/last-operation.json` in the bundle by running the command from the same project directory where the control-plane workflow ran.

The bundle is read-only, aggressively redacted, and should complement rather than replace your existing observability stack.
