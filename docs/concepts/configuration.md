# Configuration

cantonctl uses a hierarchical configuration system. Settings are loaded from multiple sources and merged in priority order.

## Priority Order (lowest to highest)

1. **User config** — `~/.config/cantonctl/config.yaml`
2. **Project config** — `cantonctl.yaml` (searched upward from current directory)
3. **Environment variables** — `CANTONCTL_*` prefix
4. **CLI flags** — Highest priority, always wins

## cantonctl.yaml

Every cantonctl project has a `cantonctl.yaml` at its root. This file is created by `cantonctl init` and validated against a Zod schema on every load.

```yaml
version: 1

project:
  name: my-app
  sdk-version: "3.4.9"
  template: splice-dapp-sdk  # Optional: which template was used

parties:
  - name: Alice
    role: operator         # operator | participant | observer
  - name: Bob
    role: participant

networks:
  local:
    type: sandbox          # sandbox | remote | docker
    port: 5001
    json-api-port: 7575
  devnet:
    type: remote
    url: https://devnet.canton.network
    auth: jwt              # jwt | shared-secret | none

plugins:
  - "@cantonctl/plugin-zenith"
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | number | Config schema version (currently `1`) |
| `project.name` | string | Project name |
| `project.sdk-version` | string | Daml SDK version (e.g., `"3.4.9"`) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `project.template` | string | Template used during init |
| `parties` | array | Party definitions for auto-provisioning |
| `networks` | object | Network definitions (keyed by name) |
| `plugins` | array | npm package names for cantonctl plugins |

## Environment Variables

Environment variables use the `CANTONCTL_` prefix with underscores mapping to dot notation:

| Environment Variable | Config Path |
|---------------------|-------------|
| `CANTONCTL_PROJECT_NAME` | `project.name` |
| `CANTONCTL_PROJECT_SDK_VERSION` | `project.sdk-version` |

## User Config

Global defaults can be set in `~/.config/cantonctl/config.yaml`. This is useful for network credentials shared across projects:

```yaml
networks:
  devnet:
    type: remote
    url: https://devnet.canton.network
    auth: jwt
```

## Merge Behavior

| Field | Merge Strategy |
|-------|---------------|
| `project.*` | Shallow merge (override wins) |
| `networks.*` | Deep merge per network key (fields are individually overridden) |
| `parties` | Concatenated (no deduplication) |
| `plugins` | Concatenated and deduplicated |

## Validation

Config is validated using Zod at load time. Invalid configs produce error `E1003` (CONFIG_SCHEMA_VIOLATION) with specific field paths and human-readable messages.
