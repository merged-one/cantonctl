# API Stability Classes

The upstream manifest in [src/lib/upstream/manifest.ts](../../src/lib/upstream/manifest.ts) classifies every Canton/Splice input with one stability class.

## Stability Meanings

| Stability class | Meaning | Allowed default use |
|---|---|---|
| `stable-external` | Official public API/spec surface intended for downstream consumers. | Client generation and compatibility checks |
| `stable-daml-interface` | Stable Daml package or data-dependency anchor. | Binding generation and compatibility checks |
| `public-sdk` | Supported published SDK package. | Import the package directly; use for runtime integration and compatibility checks |
| `experimental-internal` | Real upstream surface, but internal or mixed-scope enough that cantonctl should not automate against it by default. | Reference and compatibility checks only |
| `operator-only` | Admin, operator, wallet-management, or otherwise non-public surface. | Reference and diagnostics only |

## Practical Guidance

- `stable-external` does not mean "the whole repo is stable". It means the specific manifest entry is the approved public contract.
- `stable-daml-interface` entries are the right place to anchor future token-standard DAR compatibility work.
- `public-sdk` entries should usually win over custom client generation when an official package already exists.
- `experimental-internal` and `operator-only` entries should not drive generated public artifacts.

## Mixed-Scope Specs

Some upstream files contain both stable and unstable material. The current example is the Scan OpenAPI file, which includes both `external` and `internal` tags. In those cases the manifest selector is authoritative:

- generate only from the selected subset
- do not silently widen scope to the entire upstream file

## Contributor Rule

If a change depends on a new URL, version, package, spec, or Daml interface, add or update the manifest first. Generated artifacts must come from the manifest, not from ad hoc URLs copied into scripts, CI, README text, or prompt context.
