# Migration Guide: Community-Fit Repositioning

This migration is about wording, guidance, and docs structure. It is not a runtime feature removal release.

## What To Expect

- DPM-first guidance for build, test, codegen, sandbox, and Studio
- Quickstart-aware guidance for the official reference-app and LocalNet path
- profile-first docs for sandbox, LocalNet, and remote validator-backed environments
- clearer separation between stable/public and experimental surfaces

## If You Already Use `cantonctl`

- Existing commands still work
- Existing profile-based config remains the preferred model
- Legacy `networks:` config continues to load
- `serve` and `playground` still exist; they are simply documented more narrowly

## How To Read The Docs Now

1. Start with [docs/README.md](../README.md)
2. Read the ecosystem-fit and non-goal docs first
3. Move to configuration, auth, compatibility, status, and LocalNet
4. Use the stable/public command references and examples from there
