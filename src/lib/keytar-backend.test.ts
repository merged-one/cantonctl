import {describe, expect, it, vi} from 'vitest'

import {createBackendWithFallback} from './keytar-backend.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('keytar-backend', () => {
  describe('createBackendWithFallback()', () => {
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
  })
})
