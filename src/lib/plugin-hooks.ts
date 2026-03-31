/**
 * @module plugin-hooks
 *
 * Lifecycle hook system for cantonctl plugins. Plugins register callbacks
 * for named hooks, and the CLI emits events at key points in the
 * build/test/deploy lifecycle.
 *
 * Hooks execute in registration order. Errors from `onError` hooks are
 * swallowed to prevent cascading failures; all other hook errors propagate.
 *
 * Follows ADR-0002 (Hardhat-inspired plugin architecture).
 *
 * @example
 * ```ts
 * const hooks = createPluginHookManager()
 * hooks.register('beforeBuild', async (ctx) => { console.log('Building...') })
 * hooks.register('afterBuild', async (ctx) => { console.log('Built!', ctx) })
 * await hooks.emit('beforeBuild', { projectDir: '/my-app' })
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookName =
  | 'beforeBuild'
  | 'afterBuild'
  | 'beforeDeploy'
  | 'afterDeploy'
  | 'beforeTest'
  | 'afterTest'
  | 'onError'

export interface HookContext {
  [key: string]: unknown
}

export type HookFn = (context: HookContext) => Promise<void> | void

export interface PluginHookManager {
  /** Register a callback for a lifecycle hook. */
  register(hook: HookName, fn: HookFn): void
  /** Emit a hook event, calling all registered callbacks in order. */
  emit(hook: HookName, context: HookContext): Promise<void>
  /** Get the number of registered callbacks for a hook. */
  count(hook: HookName): number
  /** Remove all registered callbacks. */
  clear(): void
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a PluginHookManager for lifecycle event dispatch.
 */
export function createPluginHookManager(): PluginHookManager {
  const registry = new Map<HookName, HookFn[]>()

  return {
    register(hook: HookName, fn: HookFn): void {
      let fns = registry.get(hook)
      if (!fns) {
        fns = []
        registry.set(hook, fns)
      }

      fns.push(fn)
    },

    async emit(hook: HookName, context: HookContext): Promise<void> {
      const fns = registry.get(hook)
      if (!fns) return

      for (const fn of fns) {
        if (hook === 'onError') {
          // onError hooks must not throw — swallow errors to prevent cascading
          try {
            await fn(context)
          } catch {
            // Swallowed intentionally
          }
        } else {
          await fn(context)
        }
      }
    },

    count(hook: HookName): number {
      return registry.get(hook)?.length ?? 0
    },

    clear(): void {
      registry.clear()
    },
  }
}
