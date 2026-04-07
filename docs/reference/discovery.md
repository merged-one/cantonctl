# Discovery And Scan-Based Profile Import

`cantonctl` exposes two scan-driven discovery helpers:

- `cantonctl discover network` for read-only stable/public discovery snapshots
- `cantonctl profiles import-scan` for synthesizing a `remote-validator` or `remote-sv-network` profile from that snapshot

## Usage

```bash
cantonctl discover network --scan-url https://scan.example.com
cantonctl profiles import-scan --scan-url https://scan.example.com --kind remote-validator --write
```

## `discover network`

Use this when you want the raw discovery snapshot without mutating local config.

Flags:

| Flag | Description |
|---|---|
| `--scan-url <url>` | Stable/public Scan base URL to query |
| `--json` | Output the full discovery snapshot as JSON |

Human output prints the discovered Scan URL, connected-scan count, and sequencer-group count. JSON output returns the full fetched discovery snapshot.

## `profiles import-scan`

Use this when you want to turn scan discovery data into a profile block.

Flags:

| Flag | Description |
|---|---|
| `--scan-url <url>` | Stable/public Scan base URL to query |
| `--kind remote-validator|remote-sv-network` | Select the synthesized profile kind |
| `--name <profile>` | Override the synthesized profile name |
| `--write` | Merge the synthesized profile into `cantonctl.yaml` |
| `--json` | Return the synthesized profile, warnings, and YAML as JSON |

Behavior:

- infers auth, ledger, validator, token-standard, and ANS URLs from the discovery payload when possible
- defaults the synthesized profile name to `<kind>-<scan-host>`
- writes only the profile block into `cantonctl.yaml`; unlike `profiles import-localnet`, it does not add a `networks:` alias
- preserves unrelated existing config when `--write` is used

If a required endpoint cannot be inferred, the command succeeds with warnings and returns the synthesized partial profile so you can finish the wiring manually.

## Related

- [Profiles](profiles.md)
- [Configuration](configuration.md)
