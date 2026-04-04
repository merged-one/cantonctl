# `cantonctl topology`

Inspect or export the local Canton-only topology that powers `cantonctl dev --net` and `cantonctl playground --net`.

This is a local-runtime helper. It does not replace Quickstart or the official Splice LocalNet workspace.

## Usage

```bash
cantonctl topology show
cantonctl topology show --topology demo
cantonctl topology export --topology demo --out-dir .cantonctl/export/demo
```

## Config Shape

Named topologies live at the top level of `cantonctl.yaml`:

```yaml
topologies:
  demo:
    kind: canton-multi
    base-port: 10000
    canton-image: ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3
    participants:
      - name: participant1
        parties: [Alice]
      - name: participant2
        parties: [Bob]
      - name: participant3
        parties: []
```

## Current Rules

- Only `kind: canton-multi` is supported
- Participant names must be unique
- Party names must be unique across the topology
- Port assignment is deterministic from `base-port` and participant order
- `dev --net` without `--topology` uses the default implicit topology derived from `parties:`

## Commands

| Command | Purpose |
|---|---|
| `cantonctl topology show` | Resolve and print the current topology without starting Docker |
| `cantonctl topology export` | Write `docker-compose.yml`, `canton.conf`, `bootstrap.canton`, and `topology.json` for inspection or debugging |

## Workbench Integration

`serve` and `playground` read `.cantonctl/topology.json` first when attaching to a local net runtime. That manifest is the canonical runtime description for arbitrary participant counts.

## Source

- Commands: [`src/commands/topology/show.ts`](../../src/commands/topology/show.ts), [`src/commands/topology/export.ts`](../../src/commands/topology/export.ts)
- Logic: [`src/lib/topology.ts`](../../src/lib/topology.ts)
