# `cantonctl upgrade check`

Run the current read-only upgrade checks for a resolved profile.

`upgrade check` is currently the inspection half of a broader day-2 workflow. In `0.3.5`, it stays read-only and helps teams confirm compatibility, auth material, scan-backed migration hints, and network-tier reminders before following the official operator runbooks.

## Usage

```bash
cantonctl upgrade check --profile splice-devnet
cantonctl upgrade check --profile splice-mainnet --json
```

## What it checks

- compatibility baseline failures and warnings
- credential availability
- stable/public scan-backed migration hints when available
- reset-sensitive DevNet/TestNet reminders
- MainNet continuity reminders
