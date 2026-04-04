# Compatibility And Spec Sync

`cantonctl compat check` is the stable/public boundary guard for a resolved profile.

It does not replace official SDK or API compatibility promises. It makes the repo’s manifest-driven policy visible in a JSON-first form.

## `cantonctl compat check`

```bash
cantonctl compat check [profile] [--json]
```

The command:

1. Resolves the requested profile
2. Lists configured services
3. Classifies them against the upstream manifest
4. Highlights stable/public, reference-only, operator-only, and experimental surfaces
5. Compares the project SDK version against the pinned support baseline

## `cantonctl codegen sync`

```bash
cantonctl codegen sync [--json]
```

This wraps the maintainer workflow for syncing manifest-managed specs and regenerating stable generated clients.

## Related

- [API stability](api-stability.md)
- [Upstream sources](upstream-sources.md)
- [Configuration](configuration.md)
