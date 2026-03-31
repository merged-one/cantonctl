/**
 * @module credential-store
 *
 * Secure credential storage for Canton network authentication. Abstracts
 * the OS keychain via an injectable backend so tests can use an in-memory
 * implementation while production uses the system keychain.
 *
 * Resolution order for JWT tokens:
 * 1. `CANTONCTL_JWT_<NETWORK>` environment variable (uppercase, hyphens → underscores)
 * 2. OS keychain (stored via `auth login`)
 * 3. null (caller should prompt or throw)
 *
 * Follows ADR-0008 (deploy pipeline) which locks OS keychain over custom
 * encrypted file formats.
 *
 * @example
 * ```ts
 * const store = createCredentialStore({ backend: keytarBackend, env: process.env })
 * await store.store('devnet', 'eyJhbGci...')
 * const token = await store.resolve('devnet') // checks env var first, then keychain
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Service name used in the OS keychain. */
const SERVICE_NAME = 'cantonctl'

/**
 * Backend interface for keychain operations. In production this wraps the OS
 * keychain (via keytar or similar). In tests this is an in-memory map.
 */
export interface KeychainBackend {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
  findCredentials(service: string): Promise<Array<{account: string; password: string}>>
}

export interface CredentialStoreDeps {
  /** Keychain backend (injectable for testing). */
  backend: KeychainBackend
  /** Environment variables (for CANTONCTL_JWT_<NETWORK> override). */
  env?: Record<string, string | undefined>
}

export interface CredentialStore {
  /** Store a JWT token for a network in the keychain. */
  store(network: string, token: string): Promise<void>
  /** Retrieve a JWT token from the keychain (ignoring env vars). */
  retrieve(network: string): Promise<string | null>
  /** Resolve a JWT token: env var > keychain > null. */
  resolve(network: string): Promise<string | null>
  /** Remove stored credentials for a network. */
  remove(network: string): Promise<boolean>
  /** List network names that have stored credentials. */
  list(): Promise<string[]>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a network name to its env var name: devnet → CANTONCTL_JWT_DEVNET */
function toEnvVarName(network: string): string {
  return `CANTONCTL_JWT_${network.toUpperCase().replace(/-/g, '_')}`
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a CredentialStore backed by the provided keychain implementation.
 */
export function createCredentialStore(deps: CredentialStoreDeps): CredentialStore {
  const {backend, env = process.env} = deps

  return {
    async store(network: string, token: string): Promise<void> {
      await backend.setPassword(SERVICE_NAME, network, token)
    },

    async retrieve(network: string): Promise<string | null> {
      return backend.getPassword(SERVICE_NAME, network)
    },

    async resolve(network: string): Promise<string | null> {
      // 1. Check env var override
      const envVar = toEnvVarName(network)
      const envValue = env[envVar]
      if (envValue) {
        return envValue
      }

      // 2. Check keychain
      return backend.getPassword(SERVICE_NAME, network)
    },

    async remove(network: string): Promise<boolean> {
      return backend.deletePassword(SERVICE_NAME, network)
    },

    async list(): Promise<string[]> {
      const creds = await backend.findCredentials(SERVICE_NAME)
      return creds.map(c => c.account)
    },
  }
}

// ---------------------------------------------------------------------------
// In-memory backend (for testing and fallback)
// ---------------------------------------------------------------------------

/**
 * Create an in-memory keychain backend. Useful for tests and environments
 * where the OS keychain is unavailable.
 */
export function createInMemoryBackend(): KeychainBackend {
  const store = new Map<string, Map<string, string>>()

  function getServiceStore(service: string): Map<string, string> {
    let s = store.get(service)
    if (!s) {
      s = new Map()
      store.set(service, s)
    }

    return s
  }

  return {
    async getPassword(service: string, account: string): Promise<string | null> {
      return getServiceStore(service).get(account) ?? null
    },

    async setPassword(service: string, account: string, password: string): Promise<void> {
      getServiceStore(service).set(account, password)
    },

    async deletePassword(service: string, account: string): Promise<boolean> {
      return getServiceStore(service).delete(account)
    },

    async findCredentials(service: string): Promise<Array<{account: string; password: string}>> {
      const s = getServiceStore(service)
      return [...s.entries()].map(([account, password]) => ({account, password}))
    },
  }
}
