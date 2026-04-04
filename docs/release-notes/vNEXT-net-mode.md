# vNEXT Net-Mode Release Notes

This release replaces the old local multi-node flag with the new topology-oriented naming.

## What Changed

- `cantonctl dev --net` now replaces `cantonctl dev --full`
- `cantonctl playground --net` now replaces `cantonctl playground --full`
- named local Canton topologies can be defined under `topologies:` in `cantonctl.yaml`
- `cantonctl topology show` and `cantonctl topology export` are available for preview and inspection
- `serve` and `playground` now prefer `.cantonctl/topology.json` over Docker Compose parsing when attaching to a local net runtime

## What Did Not Change

- sandbox-first local iteration still exists under `cantonctl dev`
- `cantonctl localnet ...` is still the wrapper over the official Splice LocalNet workspace
- remote profile flows remain separate from the local Canton-only topology builder

## Positioning Reminder

The local topology builder is for Canton-only local realism. It is not a Splice LocalNet replacement and it is not a validator orchestration surface.
