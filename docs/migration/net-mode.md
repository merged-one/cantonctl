# Net-Mode Migration

## Required Flag Rename

Update scripts, aliases, docs, and examples as follows:

```bash
cantonctl dev --full        -> cantonctl dev --net
cantonctl playground --full -> cantonctl playground --net
```

`--full` is removed. There is no compatibility alias.

## New Topology Flow

If you need more than the default implicit topology, add a named entry under `topologies:` in `cantonctl.yaml` and select it with:

```bash
cantonctl dev --net --topology demo
cantonctl playground --net --topology demo
```

Use `cantonctl topology show` to inspect the resolved topology without starting Docker.

## Workbench Attachment

`serve` and `playground` now treat `.cantonctl/topology.json` as the canonical local net manifest. If you have older generated worktrees without that file, the repo still falls back to Compose parsing, but regenerated runtimes should use the manifest path.
