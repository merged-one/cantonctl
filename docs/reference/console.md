# cantonctl console

Interactive REPL connected to a Canton node. Explore contracts, query parties, and submit ledger commands without leaving the terminal.

## Usage

```bash
cantonctl console [flags]
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--network <name>` | `-n` | `local` | Network to connect to (must exist in `cantonctl.yaml`). |

## REPL Commands

| Command | Description |
|---------|-------------|
| `help` | Show available commands |
| `status` | Show node health and version |
| `parties` | List provisioned parties in a table |
| `query [templateId] [--party <name>]` | Query active contracts |
| `submit <party> create <templateId> [payload]` | Create a contract |
| `submit <party> exercise <contractId> <choice> [payload]` | Exercise a contract choice |
| `exit` / `quit` / `.exit` | Exit the console |

`payload` is a JSON object. Omit it to default to `{}`.

## Tab Completion

The REPL supports tab completion for:
- Command names (`he<TAB>` → `help`)
- Party names after `submit` (`submit Al<TAB>` → `submit Alice`)
- Actions after `submit <party>` (`submit Alice c<TAB>` → `submit Alice create`)
- Flags for `query` (`query --<TAB>` → `--party`)

## Examples

```
cantonctl console

canton> status
✓ Node healthy (v3.4.9)

canton> parties
┌────────┬──────────────────────────┬───────┐
│ Party  │ ID                       │ Local │
├────────┼──────────────────────────┼───────┤
│ Alice  │ Alice::122f3e...         │ true  │
└────────┴──────────────────────────┴───────┘

canton> query --party Alice
No active contracts found

canton> submit Alice create MyModule:MyTemplate '{"owner":"Alice"}'
✓ Contract created
{ "transactionId": "tx-abc123", ... }

canton> exit
```

## Error Handling

Errors are printed inline and the REPL continues — a bad command does not crash the session:

```
canton> badcmd
Error E8002: Unknown console command.
  badcmd. Type "help" for available commands.
canton>
```

## Connecting to Remote Networks

```bash
cantonctl console --network devnet
```

Requires a stored credential: `cantonctl auth login devnet`.

## Source

- Command: [`src/commands/console.ts`](../../src/commands/console.ts)
- Parser: [`src/lib/repl/parser.ts`](../../src/lib/repl/parser.ts)
- Executor: [`src/lib/repl/executor.ts`](../../src/lib/repl/executor.ts)
- Completer: [`src/lib/repl/completer.ts`](../../src/lib/repl/completer.ts)
- ADRs: [ADR-0007](../adr/0007-dual-interface-console.md)
