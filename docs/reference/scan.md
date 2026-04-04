# cantonctl scan

Read stable public Scan surfaces without depending on validator-internal APIs.

## Subcommands

### `scan updates`

List stable public Scan update history.

```bash
cantonctl scan updates --profile splice-devnet
cantonctl scan updates --scan-url https://scan.example.com --after-migration-id 7 --after-record-time 2026-04-02T19:59:00Z --page-size 10 --json
```

**Flags**

| Flag | Default | Description |
|------|---------|-------------|
| `--profile <name>` | — | Resolved runtime profile that exposes `scan` |
| `--scan-url <url>` | — | Explicit Scan base URL override |
| `--after-migration-id <n>` | — | Start after the given migration id. Must be paired with `--after-record-time`. |
| `--after-record-time <iso>` | — | Start after the given record time. Must be paired with `--after-migration-id`. |
| `--page-size <n>` | `20` | Maximum number of updates to return |
| `--json` | `false` | Output as JSON |

Behavior:
- Calls the stable `POST /v2/updates` surface.
- Normalizes transaction and reassignment history.
- Keeps parsing tolerant of unknown upstream fields and templates.

### `scan acs`

Read a stable public Scan ACS snapshot.

```bash
cantonctl scan acs --profile splice-devnet --migration-id 7
cantonctl scan acs --scan-url https://scan.example.com --migration-id 7 --record-time 2026-04-02T20:10:00Z --page-size 25 --json
```

**Flags**

| Flag | Default | Description |
|------|---------|-------------|
| `--profile <name>` | — | Resolved runtime profile that exposes `scan` |
| `--scan-url <url>` | — | Explicit Scan base URL override |
| `--migration-id <n>` | — | Migration id to read the ACS from |
| `--record-time <iso>` | — | Exact or at-or-before ISO timestamp of the ACS snapshot |
| `--record-time-match <mode>` | `exact` | Match mode: `exact` or `at_or_before` |
| `--before <iso>` | current time | Resolve the latest snapshot at or before this timestamp when `--record-time` is omitted |
| `--after <n>` | — | Pagination token from a prior ACS response |
| `--page-size <n>` | `25` | Maximum number of contracts to return |
| `--party-id <party>` | — | Restrict the ACS to stakeholder party ids. Repeatable. |
| `--template <template>` | — | Restrict the ACS to package-name-qualified template ids. Repeatable. |
| `--json` | `false` | Output as JSON |

Behavior:
- Resolves `GET /v0/state/acs/snapshot-timestamp` when `--record-time` is omitted.
- Reads the corresponding ACS page from `POST /v0/state/acs`.
- Returns normalized created events plus the snapshot metadata and next page token.

### `scan current-state`

Read current stable public Scan state from direct Scan.

```bash
cantonctl scan current-state --profile splice-devnet
cantonctl scan current-state --scan-proxy-url https://validator.example.com/api/validator --json
```

**Flags**

| Flag | Default | Description |
|------|---------|-------------|
| `--profile <name>` | — | Resolved runtime profile that exposes `scan` or `scanProxy` |
| `--scan-url <url>` | — | Explicit Scan base URL override |
| `--scan-proxy-url <url>` | — | Explicit scan-proxy base URL override for experimental/reference-only usage |
| `--json` | `false` | Output as JSON |

Behavior:
- Uses direct Scan when a `scan` surface is available.
- `--scan-proxy-url` remains available for experimental/reference-only coverage and migration tooling.
- Reports DSO info plus open and issuing mining rounds.

## JSON Output

```json
{
  "success": true,
  "data": {
    "endpoint": "https://scan.example.com",
    "source": "scan",
    "updates": [
      {
        "kind": "transaction",
        "migrationId": 7,
        "recordTime": "2026-04-02T20:00:00Z",
        "updateId": "update-1"
      }
    ]
  }
}
```

## Source

- Commands: [`src/commands/scan/`](../../src/commands/scan/)
- Logic: [`src/lib/splice-public.ts`](../../src/lib/splice-public.ts)
- Adapters: [`src/lib/adapters/scan.ts`](../../src/lib/adapters/scan.ts), [`src/lib/adapters/scan-proxy.ts`](../../src/lib/adapters/scan-proxy.ts)
