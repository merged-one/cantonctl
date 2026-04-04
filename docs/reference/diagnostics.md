# `cantonctl diagnostics bundle`

Export a read-only diagnostics bundle for a resolved profile.

## Usage

```bash
cantonctl diagnostics bundle --profile splice-devnet
cantonctl diagnostics bundle --profile splice-devnet --output .cantonctl/diagnostics/devnet --json
```

## Bundle contents

- resolved profile snapshot
- auth summary
- compatibility summary
- service inventory
- health probe results
- metrics endpoint summary
- validator-liveness hints from stable/public scan data when available

This is a support artifact, not a monitoring backend or dashboard replacement.

