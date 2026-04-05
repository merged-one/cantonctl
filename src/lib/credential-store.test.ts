import {describe, expect, it, vi} from 'vitest'

import {
  createCredentialStore,
  createInMemoryBackend,
  type CredentialStore,
  type CredentialStoreDeps,
  type KeychainBackend,
} from './credential-store.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockBackend(): KeychainBackend & {
  deletePassword: ReturnType<typeof vi.fn>
  findCredentials: ReturnType<typeof vi.fn>
  getPassword: ReturnType<typeof vi.fn>
  setPassword: ReturnType<typeof vi.fn>
} {
  return {
    deletePassword: vi.fn().mockResolvedValue(true),
    findCredentials: vi.fn().mockResolvedValue([]),
    getPassword: vi.fn().mockResolvedValue(null),
    setPassword: vi.fn().mockResolvedValue(undefined),
  }
}

function createTestStore(overrides: Partial<CredentialStoreDeps> = {}): {
  backend: ReturnType<typeof createMockBackend>
  store: CredentialStore
} {
  const backend = createMockBackend()
  const store = createCredentialStore({
    backend,
    env: {},
    ...overrides,
  })
  return {backend, store}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialStore', () => {
  describe('store()', () => {
    it('stores a token in the keychain', async () => {
      const {backend, store} = createTestStore()
      await store.store('devnet', 'my-jwt-token')

      expect(backend.setPassword).toHaveBeenCalledWith(
        'cantonctl',
        'devnet',
        expect.stringContaining('"token":"my-jwt-token"'),
      )
    })

    it('stores the auth mode alongside the token', async () => {
      const {backend, store} = createTestStore()
      await store.store('devnet', 'my-jwt-token', {mode: 'env-or-keychain-jwt'})

      expect(backend.setPassword).toHaveBeenCalledWith(
        'cantonctl',
        'devnet',
        expect.stringContaining('"mode":"env-or-keychain-jwt"'),
      )
    })
  })

  describe('retrieve()', () => {
    it('retrieves a token from the keychain', async () => {
      const {backend, store} = createTestStore()
      backend.getPassword.mockResolvedValue(JSON.stringify({token: 'stored-token'}))

      const token = await store.retrieve('devnet')
      expect(token).toBe('stored-token')
      expect(backend.getPassword).toHaveBeenCalledWith('cantonctl', 'devnet')
    })

    it('returns null when no token stored', async () => {
      const {store} = createTestStore()
      const token = await store.retrieve('devnet')
      expect(token).toBeNull()
    })

    it('keeps backward compatibility with legacy plain token entries', async () => {
      const {backend, store} = createTestStore()
      backend.getPassword.mockResolvedValue('legacy-token')

      const token = await store.retrieve('devnet')
      expect(token).toBe('legacy-token')
    })
  })

  describe('retrieveRecord()', () => {
    it('returns stored credential metadata when present', async () => {
      const {backend, store} = createTestStore()
      backend.getPassword.mockResolvedValue(JSON.stringify({
        mode: 'bearer-token',
        storedAt: '2026-04-02T20:00:00.000Z',
        token: 'stored-token',
      }))

      await expect(store.retrieveRecord('devnet')).resolves.toEqual({
        mode: 'bearer-token',
        storedAt: '2026-04-02T20:00:00.000Z',
        token: 'stored-token',
      })
    })

    it('falls back to the raw stored string when the envelope has no token field', async () => {
      const {backend, store} = createTestStore()
      backend.getPassword.mockResolvedValue('{"mode":"bearer-token"}')

      await expect(store.retrieveRecord('devnet')).resolves.toEqual({
        token: '{"mode":"bearer-token"}',
      })
    })
  })

  describe('resolve()', () => {
    it('prefers env var over keychain', async () => {
      const backend = createMockBackend()
      backend.getPassword.mockResolvedValue('keychain-token')

      const store = createCredentialStore({
        backend,
        env: {CANTONCTL_JWT_DEVNET: 'env-token'},
      })

      const token = await store.resolve('devnet')
      expect(token).toBe('env-token')
      expect(backend.getPassword).not.toHaveBeenCalled()
    })

    it('falls back to keychain when env var not set', async () => {
      const backend = createMockBackend()
      backend.getPassword.mockResolvedValue('keychain-token')

      const store = createCredentialStore({backend, env: {}})
      const token = await store.resolve('devnet')
      expect(token).toBe('keychain-token')
    })

    it('returns null when neither env var nor keychain has token', async () => {
      const {store} = createTestStore()
      const token = await store.resolve('devnet')
      expect(token).toBeNull()
    })

    it('converts network name to uppercase env var with underscores', async () => {
      const store = createCredentialStore({
        backend: createMockBackend(),
        env: {CANTONCTL_JWT_MY_NETWORK: 'hyphen-token'},
      })

      const token = await store.resolve('my-network')
      expect(token).toBe('hyphen-token')
    })

    it('defaults to process.env when no env override map is provided', async () => {
      process.env.CANTONCTL_JWT_DEVNET = 'process-token'
      try {
        const store = createCredentialStore({backend: createMockBackend()})
        await expect(store.resolve('devnet')).resolves.toBe('process-token')
      } finally {
        delete process.env.CANTONCTL_JWT_DEVNET
      }
    })
  })

  describe('resolveRecord()', () => {
    it('marks environment overrides as env-sourced', async () => {
      const {store} = createTestStore({
        env: {CANTONCTL_JWT_DEVNET: 'env-token'},
      })

      await expect(store.resolveRecord('devnet')).resolves.toEqual({
        source: 'env',
        token: 'env-token',
      })
    })

    it('returns stored credential metadata when no env override exists', async () => {
      const {backend, store} = createTestStore()
      backend.getPassword.mockResolvedValue(JSON.stringify({
        mode: 'env-or-keychain-jwt',
        storedAt: '2026-04-02T20:00:00.000Z',
        token: 'stored-token',
      }))

      await expect(store.resolveRecord('devnet')).resolves.toEqual({
        mode: 'env-or-keychain-jwt',
        source: 'stored',
        storedAt: '2026-04-02T20:00:00.000Z',
        token: 'stored-token',
      })
    })
  })

  describe('remove()', () => {
    it('removes credentials from keychain', async () => {
      const {backend, store} = createTestStore()
      const result = await store.remove('devnet')

      expect(result).toBe(true)
      expect(backend.deletePassword).toHaveBeenCalledWith('cantonctl', 'devnet')
    })

    it('returns false when no credentials to remove', async () => {
      const {backend, store} = createTestStore()
      backend.deletePassword.mockResolvedValue(false)

      const result = await store.remove('devnet')
      expect(result).toBe(false)
    })
  })

  describe('list()', () => {
    it('lists networks with stored credentials', async () => {
      const {backend, store} = createTestStore()
      backend.findCredentials.mockResolvedValue([
        {account: 'devnet', password: 'token1'},
        {account: 'testnet', password: 'token2'},
      ])

      const networks = await store.list()
      expect(networks).toEqual(['devnet', 'testnet'])
    })

    it('returns empty array when no credentials stored', async () => {
      const {store} = createTestStore()
      const networks = await store.list()
      expect(networks).toEqual([])
    })
  })
})

describe('InMemoryBackend', () => {
  it('supports full CRUD lifecycle', async () => {
    const backend = createInMemoryBackend()

    // Initially empty
    expect(await backend.getPassword('svc', 'acct')).toBeNull()
    expect(await backend.findCredentials('svc')).toEqual([])

    // Store
    await backend.setPassword('svc', 'acct', 'pass')
    expect(await backend.getPassword('svc', 'acct')).toBe('pass')

    // Find
    const creds = await backend.findCredentials('svc')
    expect(creds).toEqual([{account: 'acct', password: 'pass'}])

    // Update
    await backend.setPassword('svc', 'acct', 'new-pass')
    expect(await backend.getPassword('svc', 'acct')).toBe('new-pass')

    // Delete
    expect(await backend.deletePassword('svc', 'acct')).toBe(true)
    expect(await backend.getPassword('svc', 'acct')).toBeNull()
    expect(await backend.deletePassword('svc', 'acct')).toBe(false)
  })

  it('isolates services from each other', async () => {
    const backend = createInMemoryBackend()

    await backend.setPassword('svc1', 'acct', 'pass1')
    await backend.setPassword('svc2', 'acct', 'pass2')

    expect(await backend.getPassword('svc1', 'acct')).toBe('pass1')
    expect(await backend.getPassword('svc2', 'acct')).toBe('pass2')
  })
})
