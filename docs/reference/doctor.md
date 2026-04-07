# `cantonctl doctor`

Check local prerequisites and profile-aware environment readiness.

`doctor` is a support and diagnostics surface. It helps validate the local toolchain and a selected profile context, but it does not replace upstream installation guides, runtime observability, or control-plane rollout commands.

## Usage

```bash
cantonctl doctor
cantonctl doctor --json
cantonctl doctor --profile splice-devnet --json
cantonctl doctor --fix
```

## What It Checks

Base environment checks:

- Node.js major version
- Java 21 availability
- DPM or legacy `daml` CLI availability
- Docker availability
- Docker Compose availability
- Canton Docker image availability
- default local ports `5001` and `7575`

When a project config is available, `doctor` also adds best-effort profile diagnostics from the compatibility layer, including the resolved profile kind and any compatibility warnings relevant to that profile.

## Flags

| Flag | Default | Description |
|---|---|---|
| `--fix` | `false` | In interactive mode, offer to install DPM when the SDK CLI is missing; with `--fix`, run that install flow automatically |
| `--json` | `false` | Output the structured diagnostics report |
| `--profile <name>` | default profile | Include profile-aware diagnostics for the selected profile |

## JSON Output

`doctor --json` returns:

- `checks[]`: normalized check entries with `name`, `status`, `detail`, `required`, and optional `fix`
- `passed`, `failed`, and `warned`: summary counts
- `profile`: resolved profile summary when config loading and profile resolution succeed

Check statuses are:

- `pass`: requirement satisfied
- `warn`: optional or best-effort issue
- `fail`: required prerequisite missing or unsupported

## Boundary

- `doctor` is a support surface, not a deployment or mutation command
- `--fix` only covers the missing DPM install path; it does not auto-install Java, Docker, or cloud/runtime dependencies
- profile diagnostics are best-effort and do not replace `status`, `preflight`, `readiness`, or upstream operator observability

## Related

- [Configuration](configuration.md)
- [Status](status.md)
- [Preflight](preflight.md)
- [Diagnostics](diagnostics.md)
