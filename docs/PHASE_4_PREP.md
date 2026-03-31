# Phase 4 Preparation

> Concrete execution order for the next delivery phase after Phase 3.

## Scope

In scope for Phase 4:
- `deploy` from stub to working local/remote deployment pipeline
- `console` from stub to working REPL
- `auth` and credential storage as enabling infrastructure for remote deploy
- plugin hooks after the command contracts settle

Explicitly deferred:
- `dev --full`
- `cantonctl exec`
- package listing in `status` unless deploy verification requires it later

## Existing Building Blocks

- `src/lib/config.ts` already resolves networks, parties, env overrides, and user config
- `src/lib/output.ts` already provides the human/JSON contract Phase 4 commands should reuse
- `src/lib/builder.ts` already owns build orchestration, DAR discovery, and caching
- `src/lib/ledger-client.ts` already covers version checks, DAR upload, party queries, command submission, and contract queries
- `src/lib/jwt.ts` already handles local sandbox auth
- `src/lib/errors.ts` already defines the E600x, E700x, and E800x ranges Phase 4 will rely on

## Recommended Order

### 1. Deploy: local path first

Goal:
- Make `cantonctl deploy local` real before taking on remote auth complexity

Tests first:
- `src/lib/deployer.test.ts`
- `test/e2e/deploy.e2e.test.ts`

First iteration should include:
- config validation
- build or `--dar` path resolution
- `--dry-run`
- local sandbox token generation
- DAR upload via `LedgerClient.uploadDar()`
- verification via returned `mainPackageId` plus a version/health re-check

Notes:
- Treat local sandbox upload success as completion
- Keep remote vetting logic separate so the local path can land quickly

### 2. Auth and credential store

Goal:
- Unlock remote deploy without pushing auth logic down into the deployer

Tests first:
- `src/lib/credential-store.test.ts`
- command tests for `src/commands/auth.ts`

Deliverables:
- `src/lib/credential-store.ts`
- `cantonctl auth login <network>`
- `cantonctl auth logout <network>`
- `cantonctl auth status`
- `CANTONCTL_JWT_<NETWORK>` override support

Decision locked in:
- Use the OS keychain path described by ADR-0008, not a custom encrypted file format

### 3. Console REPL

Goal:
- Ship read-heavy exploration first, then ledger writes

Tests first:
- `src/lib/repl/parser.test.ts`
- `src/lib/repl/executor.test.ts`
- `src/lib/repl/completer.test.ts`
- `test/e2e/console.e2e.test.ts`

Suggested feature order:
- `help`
- `status`
- `parties`
- `query`
- `submit ... create ...`
- `submit ... exercise ...`

Notes:
- Keep the grammar in one parser so `cantonctl exec` can be added later without rework
- Default to local sandbox, then inherit credential-store support for remote networks

### 4. Plugin hooks

Goal:
- Add lifecycle hooks only after build/test/deploy surfaces are stable enough to freeze

Tests first:
- `src/lib/plugin-hooks.test.ts`

Deliverables:
- `beforeBuild`
- `afterBuild`
- `beforeDeploy`
- `afterDeploy`
- `beforeTest`
- `afterTest`
- `onError`
- plugin authoring docs

## Exit Criteria

Phase 4 is ready to close when:
- `deploy local` is real, tested, and documented
- remote auth can be stored and reused safely
- `console` supports `help`, `status`, `parties`, `query`, and basic submit flows
- plugin hooks are documented and exercised in tests
