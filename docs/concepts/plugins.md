# Plugin System

cantonctl supports npm-based plugins that extend the CLI with new commands and lifecycle hooks. The design follows the Hardhat plugin pattern (ADR-0002).

## Plugin Discovery

cantonctl auto-discovers plugins from `node_modules` matching either naming convention:

- `@cantonctl/plugin-<name>` — scoped packages
- `cantonctl-plugin-<name>` — unscoped packages

List plugins in `cantonctl.yaml`:

```yaml
plugins:
  - "@cantonctl/plugin-zenith"
  - "cantonctl-plugin-audit"
```

## Lifecycle Hooks

The `PluginHookManager` dispatches named events at key points in the build/test/deploy lifecycle. Plugins register handlers that run when those events fire.

### Available Hooks

| Hook | When it fires | Context shape |
|------|--------------|---------------|
| `beforeBuild` | Before Daml compilation starts | `{projectDir, config}` |
| `afterBuild` | After a successful build | `{projectDir, config, darPath, durationMs}` |
| `beforeTest` | Before Daml Script tests run | `{projectDir, config, filter?}` |
| `afterTest` | After tests complete | `{projectDir, config, success, durationMs}` |
| `beforeDeploy` | Before the deploy pipeline starts | `{network, config, darPath}` |
| `afterDeploy` | After a successful deploy | `{network, config, darPath, mainPackageId, durationMs}` |
| `onError` | When any CantonctlError is thrown | `{error, command, config}` |

`onError` handlers are swallowed — errors thrown inside them do not propagate.

## Writing a Plugin

A cantonctl plugin is an npm package that exports a default object with a `register` function:

```ts
// cantonctl-plugin-audit/index.ts
import type {PluginHookManager} from 'cantonctl'

export default {
  register(hooks: PluginHookManager) {
    hooks.register('beforeDeploy', async (ctx) => {
      console.log(`[audit] deploying to ${ctx.network}`)
    })

    hooks.register('afterDeploy', async (ctx) => {
      console.log(`[audit] deployed ${ctx.mainPackageId} to ${ctx.network}`)
    })

    hooks.register('onError', async (ctx) => {
      // Report error to external audit log (errors are swallowed here)
      await sendToAuditLog(ctx.error)
    })
  },
}
```

### Package Structure

```
cantonctl-plugin-audit/
├── index.ts          # Entry point with register()
├── package.json      # name must match cantonctl-plugin-* or @cantonctl/plugin-*
└── README.md
```

`package.json` minimum:

```json
{
  "name": "cantonctl-plugin-audit",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "cantonctl": ">=0.1.0"
  }
}
```

## Using the Hook Manager Directly

For testing or scripting, create a hook manager in isolation:

```ts
import {createPluginHookManager} from 'cantonctl/lib/plugin-hooks'

const hooks = createPluginHookManager()

hooks.register('afterBuild', async (ctx) => {
  console.log(`Built ${ctx.darPath} in ${ctx.durationMs}ms`)
})

// Emit from your own tooling
await hooks.emit('afterBuild', {
  config: myConfig,
  darPath: '.daml/dist/my-app-1.0.0.dar',
  durationMs: 800,
  projectDir: process.cwd(),
})
```

## Source

- Hook manager: [`src/lib/plugin-hooks.ts`](../../src/lib/plugin-hooks.ts)
- ADRs: [ADR-0002](../adr/0002-plugin-architecture.md), [ADR-0010](../adr/0010-hybrid-architecture.md)
