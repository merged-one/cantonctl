import {describe, expect, it, vi} from 'vitest'

import {createBackendWithFallback, createKeytarBackend} from './keytar-backend.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('keytar-backend', () => {
  describe('createKeytarBackend()', () => {
    it('wraps a loaded keytar module', async () => {
      const module = {
        deletePassword: vi.fn(async () => true),
        findCredentials: vi.fn(async () => [{account: 'alice', password: 'secret'}]),
        getPassword: vi.fn(async () => 'secret'),
        setPassword: vi.fn(async () => undefined),
      }

      const backend = await createKeytarBackend({
        loadKeytar: async () => module,
      })

      expect(await backend.getPassword('svc', 'alice')).toBe('secret')
      await backend.setPassword('svc', 'alice', 'secret')
      expect(await backend.deletePassword('svc', 'alice')).toBe(true)
      expect(await backend.findCredentials('svc')).toEqual([{account: 'alice', password: 'secret'}])
      expect(module.getPassword).toHaveBeenCalledWith('svc', 'alice')
      expect(module.setPassword).toHaveBeenCalledWith('svc', 'alice', 'secret')
      expect(module.deletePassword).toHaveBeenCalledWith('svc', 'alice')
      expect(module.findCredentials).toHaveBeenCalledWith('svc')
    })
  })

  describe('createBackendWithFallback()', () => {
    it('returns the injected keychain backend when available', async () => {
      const backend = {
        deletePassword: vi.fn(async () => true),
        findCredentials: vi.fn(async () => []),
        getPassword: vi.fn(async () => 'secret'),
        setPassword: vi.fn(async () => undefined),
      }

      const result = await createBackendWithFallback({
        createKeytarBackend: async () => backend,
      })

      expect(result).toEqual({
        backend,
        isKeychain: true,
      })
    })

    it('returns a working backend (keychain or in-memory)', async () => {
      const {backend, isKeychain} = await createBackendWithFallback()

      // isKeychain depends on whether keytar is installed — both are valid
      expect(typeof isKeychain).toBe('boolean')
      expect(backend).toBeDefined()
      expect(typeof backend.getPassword).toBe('function')
      expect(typeof backend.setPassword).toBe('function')
      expect(typeof backend.deletePassword).toBe('function')
      expect(typeof backend.findCredentials).toBe('function')
    })

    it('returned backend supports full CRUD', async () => {
      const {backend} = await createBackendWithFallback()

      const svc = 'cantonctl-test'
      const acct = `test-${Date.now()}`

      // Set
      await backend.setPassword(svc, acct, 'pass')
      expect(await backend.getPassword(svc, acct)).toBe('pass')

      // Delete (cleanup)
      expect(await backend.deletePassword(svc, acct)).toBe(true)
      expect(await backend.getPassword(svc, acct)).toBeNull()
    })

    it('falls back to the in-memory backend when keytar loading fails', async () => {
      const {backend, isKeychain} = await createBackendWithFallback({
        createKeytarBackend: async () => {
          throw new Error('native module unavailable')
        },
      })

      expect(isKeychain).toBe(false)
      await backend.setPassword('svc', 'alice', 'pass')
      expect(await backend.getPassword('svc', 'alice')).toBe('pass')
      expect(await backend.findCredentials('svc')).toEqual([{account: 'alice', password: 'pass'}])
    })
  })
})
