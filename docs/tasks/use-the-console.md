# Use the Console

The cantonctl console is an interactive REPL for exploring a Canton ledger — query contracts, list parties, and submit commands without writing scripts.

## Prerequisites

- A running Canton node (local sandbox via `cantonctl dev` or a remote participant)
- A cantonctl project with `cantonctl.yaml` configured

## Start the Console

```bash
cantonctl dev          # Start local sandbox (in one terminal)
cantonctl console      # Connect to local sandbox (in another terminal)
```

You'll see:

```
Canton Console (cantonctl)
Connected to local at http://localhost:7575
Type "help" for commands, "exit" to quit

canton>
```

## Available Commands

### Check node health

```
canton> status
✓ Node healthy (v3.4.9)
```

### List parties

```
canton> parties
┌────────┬──────────────────────────┬───────┐
│ Party  │ ID                       │ Local │
├────────┼──────────────────────────┼───────┤
│ Alice  │ Alice::122f3e...         │ true  │
│ Bob    │ Bob::9a8b7c...           │ true  │
└────────┴──────────────────────────┴───────┘
```

### Query active contracts

```
canton> query
canton> query MyModule:MyTemplate
canton> query MyModule:MyTemplate --party Alice
```

### Create a contract

```
canton> submit Alice create MyModule:MyTemplate '{"owner":"Alice","amount":100}'
```

### Exercise a choice

```
canton> submit Alice exercise <contractId> Transfer '{"newOwner":"Bob"}'
```

### Get help

```
canton> help
```

### Exit

```
canton> exit
```

Or press `Ctrl+D`.

## Tab Completion

The console supports tab completion:
- Command names: `he<TAB>` → `help`
- Party names after `submit`: `submit Al<TAB>` → `submit Alice`

## Connect to Remote Networks

```bash
cantonctl console --network devnet
```

Requires stored credentials: `cantonctl auth login devnet`.

## Error Handling

Errors display inline without crashing the session:

```
canton> badcmd
Error E8002: Unknown console command.
canton>
```

## Related

- [Reference: console command](../reference/console.md)
- [Concept: authentication](../concepts/authentication.md)
