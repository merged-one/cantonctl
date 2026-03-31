import {describe, expect, it, vi} from 'vitest'

import {createPluginHookManager, type HookContext, type HookName} from './plugin-hooks.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginHookManager', () => {
  describe('register() and emit()', () => {
    it('calls registered callback with context', async () => {
      const hooks = createPluginHookManager()
      const fn = vi.fn()

      hooks.register('beforeBuild', fn)
      await hooks.emit('beforeBuild', {projectDir: '/my-app'})

      expect(fn).toHaveBeenCalledWith({projectDir: '/my-app'})
    })

    it('calls multiple callbacks in registration order', async () => {
      const hooks = createPluginHookManager()
      const order: number[] = []

      hooks.register('beforeBuild', async () => { order.push(1) })
      hooks.register('beforeBuild', async () => { order.push(2) })
      hooks.register('beforeBuild', async () => { order.push(3) })

      await hooks.emit('beforeBuild', {})
      expect(order).toEqual([1, 2, 3])
    })

    it('does nothing when no callbacks registered', async () => {
      const hooks = createPluginHookManager()
      await expect(hooks.emit('beforeBuild', {})).resolves.toBeUndefined()
    })

    it('supports all hook names', async () => {
      const hooks = createPluginHookManager()
      const hookNames: HookName[] = [
        'beforeBuild', 'afterBuild',
        'beforeDeploy', 'afterDeploy',
        'beforeTest', 'afterTest',
        'onError',
      ]

      for (const name of hookNames) {
        const fn = vi.fn()
        hooks.register(name, fn)
        await hooks.emit(name, {})
        expect(fn).toHaveBeenCalledOnce()
      }
    })

    it('keeps hooks for different names separate', async () => {
      const hooks = createPluginHookManager()
      const buildFn = vi.fn()
      const deployFn = vi.fn()

      hooks.register('beforeBuild', buildFn)
      hooks.register('beforeDeploy', deployFn)

      await hooks.emit('beforeBuild', {})
      expect(buildFn).toHaveBeenCalled()
      expect(deployFn).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('propagates errors from non-onError hooks', async () => {
      const hooks = createPluginHookManager()
      hooks.register('beforeBuild', async () => {
        throw new Error('hook error')
      })

      await expect(hooks.emit('beforeBuild', {})).rejects.toThrow('hook error')
    })

    it('swallows errors from onError hooks', async () => {
      const hooks = createPluginHookManager()
      const secondFn = vi.fn()

      hooks.register('onError', async () => {
        throw new Error('should be swallowed')
      })
      hooks.register('onError', secondFn)

      await hooks.emit('onError', {error: 'test'})
      // Second hook should still be called even though first threw
      expect(secondFn).toHaveBeenCalledWith({error: 'test'})
    })
  })

  describe('count()', () => {
    it('returns 0 for unregistered hooks', () => {
      const hooks = createPluginHookManager()
      expect(hooks.count('beforeBuild')).toBe(0)
    })

    it('returns the number of registered callbacks', () => {
      const hooks = createPluginHookManager()
      hooks.register('beforeBuild', vi.fn())
      hooks.register('beforeBuild', vi.fn())
      expect(hooks.count('beforeBuild')).toBe(2)
    })
  })

  describe('clear()', () => {
    it('removes all registered callbacks', async () => {
      const hooks = createPluginHookManager()
      const fn = vi.fn()

      hooks.register('beforeBuild', fn)
      hooks.register('afterBuild', fn)
      hooks.clear()

      expect(hooks.count('beforeBuild')).toBe(0)
      expect(hooks.count('afterBuild')).toBe(0)

      await hooks.emit('beforeBuild', {})
      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('sync callbacks', () => {
    it('supports synchronous hook functions', async () => {
      const hooks = createPluginHookManager()
      const fn = vi.fn() // sync function

      hooks.register('beforeBuild', fn)
      await hooks.emit('beforeBuild', {context: 'sync'})

      expect(fn).toHaveBeenCalledWith({context: 'sync'})
    })
  })
})
