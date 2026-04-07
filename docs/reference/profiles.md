# `cantonctl profiles`

Inspect, validate, and synthesize the profile model that anchors the `cantonctl` control plane.

Profiles are the canonical runtime abstraction. They let `cantonctl` wrap sandbox, `dev --net`, official LocalNet, and remote validator-backed environments without re-owning the official runtime implementations themselves.

## Subcommands

```bash
cantonctl profiles list
cantonctl profiles show <name>
cantonctl profiles validate [name]
cantonctl profiles import-localnet --workspace <path> [--write]
cantonctl profiles import-scan --scan-url <url> --kind <kind> [--write]
```

## Inspection Commands

### `profiles list`

Lists resolved profiles from `cantonctl.yaml`.

Flags:

| Flag | Description |
|---|---|
| `--json` | Return `defaultProfile` and the resolved profile summaries as JSON |

Human output shows profile name, kind, default marker, and declared service set.

### `profiles show <name>`

Shows the resolved runtime contract for one profile.

Flags:

| Flag | Description |
|---|---|
| `--json` | Return the resolved profile, compatibility services, and SDK-backed capabilities as JSON |

Human output includes:

- profile kind and definition source
- whether the profile is experimental
- service endpoints, stability, lifecycle owner, management class, and endpoint provenance
- capability ownership and pinned SDK packages when the profile exposes wallet-connected capability surfaces

This is the best inspection entry point when you need to confirm what `status`, `deploy`, `preflight`, or `readiness` will actually operate against.

### `profiles validate [name]`

Resolves one profile or all profiles and fails if the config is invalid.

Flags:

| Flag | Description |
|---|---|
| `--json` | Return the validated profile count and per-profile summary as JSON |

When no name is provided, the command validates every resolvable profile.

## Synthesis Commands

### `profiles import-localnet`

Imports an official Splice LocalNet workspace as a `splice-localnet` profile and matching `networks:` alias.

Flags:

| Flag | Description |
|---|---|
| `--workspace <path>` | Official LocalNet workspace root |
| `--source-profile app-provider|app-user|sv` | Which upstream LocalNet profile to import |
| `--name <profile>` | Override the generated profile name |
| `--network-name <name>` | Override the generated network alias |
| `--write` | Merge the generated profile and network mapping into `cantonctl.yaml` |
| `--json` | Return the synthesized profile, network alias, warnings, and YAML as JSON |

Default behavior imports the upstream `sv` profile as `profiles.splice-localnet` and wires `networks.localnet.profile: splice-localnet`.

### `profiles import-scan`

Synthesizes a remote stable/public profile from scan discovery data.

Flags:

| Flag | Description |
|---|---|
| `--scan-url <url>` | Stable/public Scan base URL to query |
| `--kind remote-validator|remote-sv-network` | Profile kind to synthesize |
| `--name <profile>` | Override the generated profile name |
| `--write` | Merge the generated profile into `cantonctl.yaml` |
| `--json` | Return the synthesized profile, warnings, and YAML as JSON |

This command writes only the profile block. It does not create a `networks:` alias automatically.

## Related

- [Configuration](configuration.md)
- [LocalNet](localnet.md)
- [Discovery](discovery.md)
- [Auth](auth.md)
