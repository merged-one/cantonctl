# Remote Diagnostics

Use `cantonctl diagnostics bundle --profile <name>` when you need a support-friendly snapshot of:

- resolved profile and auth mode
- compatibility summary
- service endpoints
- health probe results
- metrics endpoint reachability
- validator-liveness hints from stable/public scan data

The bundle is read-only and should complement, not replace, your existing observability stack.

