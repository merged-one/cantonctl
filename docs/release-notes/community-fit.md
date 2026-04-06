# Community-Fit Repositioning

This release repositions `cantonctl` as a Splice-aware orchestration companion over the official Canton stack.

## What Changed

- top-level docs and help text now describe `cantonctl` as a companion, not the whole platform
- official-tool boundaries are explicit for DPM, Daml Studio, Quickstart, the dApp SDK, Wallet Gateway, and Wallet SDK
- docs now lead with profile-aware config, LocalNet wrapping, compatibility, diagnostics, and stable/public workflows
- `serve` and `playground` are framed as adjunct workbench surfaces

## What Did Not Change

- profile-based config and compatibility work remain intact
- LocalNet wrapping remains intact
- stable/public Scan, token-standard, ANS, and validator-user commands remain intact
- experimental/operator-only surfaces remain explicit opt-ins

## Why This Release Exists

The codebase already had a strong Splice-aware wedge. The product story was broader than the repo’s most defensible capabilities. This release brings the docs and help surfaces back in line with the actual boundary.
