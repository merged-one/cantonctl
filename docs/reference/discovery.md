# `cantonctl discover network`

Discover stable/public network metadata from a scan endpoint.

## Usage

```bash
cantonctl discover network --scan-url https://scan.example.com
cantonctl profiles import-scan --scan-url https://scan.example.com --kind remote-validator --write
```

## Scope

- reads stable/public scan discovery surfaces
- summarizes connected scans and sequencer groups
- synthesizes profile blocks for `remote-sv-network` or `remote-validator`
- writes generated profiles without deleting unrelated config

