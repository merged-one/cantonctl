# API Stability Classes

The upstream manifest is the source of truth for which surfaces are safe for default-path automation.

`cantonctl` should prefer stable/public surfaces and official SDKs. Anything internal, operator-only, or mixed-scope stays explicit and constrained.

## Stability Classes

| Class | Meaning | Default use |
|---|---|---|
| `stable-external` | Official public API or spec surface | Yes |
| `stable-daml-interface` | Stable published Daml interface | Yes |
| `public-sdk` | Official published SDK package | Prefer package import over custom client generation |
| `experimental-internal` | Real upstream surface but not safe as a default path | No |
| `operator-only` | Internal or admin-only surface | No |

## Companion Rule

- Use stable/public and official SDK surfaces by default
- Keep operator-only and approved admin flows behind the explicit `operator` namespace instead of widening the default stable/public commands
- Do not widen mixed-scope specs beyond the manifest selector
