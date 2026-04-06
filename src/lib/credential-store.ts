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

import {
  type AuthCredentialScope,
  type AuthProfileMode,
  isAuthProfileMode,
  toCredentialAccountName,
  toJwtEnvVarName,
  toOperatorTokenEnvVarName,
} from './auth-profile.js'

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

export interface StoredCredential {
  mode?: AuthProfileMode
  scope?: AuthCredentialScope
  storedAt?: string
  token: string
}

export interface ResolvedCredential extends StoredCredential {
  source: 'env' | 'stored'
}

export interface CredentialStore {
  /** Store a JWT token for a network in the keychain. */
  store(network: string, token: string, options?: {mode?: AuthProfileMode; scope?: AuthCredentialScope}): Promise<void>
  /** Retrieve a JWT token from the keychain (ignoring env vars). */
  retrieve(network: string, options?: {scope?: AuthCredentialScope}): Promise<string | null>
  /** Retrieve the stored credential envelope from the keychain. */
  retrieveRecord(network: string, options?: {scope?: AuthCredentialScope}): Promise<StoredCredential | null>
  /** Resolve a JWT token: env var > keychain > null. */
  resolve(network: string, options?: {scope?: AuthCredentialScope}): Promise<string | null>
  /** Resolve the credential envelope: env var > keychain > null. */
  resolveRecord(network: string, options?: {scope?: AuthCredentialScope}): Promise<ResolvedCredential | null>
  /** Remove stored credentials for a network. */
  remove(network: string, options?: {scope?: AuthCredentialScope}): Promise<boolean>
  /** List network names that have stored credentials. */
  list(options?: {scope?: AuthCredentialScope | 'all'}): Promise<string[]>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseStoredCredential(raw: string | null): StoredCredential | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.token === 'string') {
      return {
        mode: typeof parsed.mode === 'string' && isAuthProfileMode(parsed.mode) ? parsed.mode : undefined,
        scope: parsed.scope === 'operator' ? 'operator' : parsed.scope === 'app' ? 'app' : undefined,
        storedAt: typeof parsed.storedAt === 'string' ? parsed.storedAt : undefined,
        token: parsed.token,
      }
    }
  } catch {
    // Backward compatibility: plain token string entries predate envelopes.
  }

  return {token: raw}
}

function serializeStoredCredential(record: StoredCredential): string {
  return JSON.stringify({
    mode: record.mode,
    scope: record.scope,
    storedAt: record.storedAt,
    token: record.token,
  })
}

function resolveCredentialScope(options?: {scope?: AuthCredentialScope}): AuthCredentialScope {
  return options?.scope ?? 'app'
}

function resolveCredentialEnvVarName(network: string, scope: AuthCredentialScope): string {
  return scope === 'operator' ? toOperatorTokenEnvVarName(network) : toJwtEnvVarName(network)
}

function parseCredentialAccount(account: string): {network: string; scope: AuthCredentialScope | 'unknown'} {
  if (account.startsWith('operator:')) {
    return {network: account.slice('operator:'.length), scope: 'operator'}
  }

  if (account.startsWith('app:')) {
    return {network: account.slice('app:'.length), scope: 'app'}
  }

  return {network: account, scope: 'app'}
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a CredentialStore backed by the provided keychain implementation.
 */
export function createCredentialStore(deps: CredentialStoreDeps): CredentialStore {
  const {backend, env = process.env} = deps

  const retrieveRecord = async (network: string, options?: {scope?: AuthCredentialScope}): Promise<StoredCredential | null> => {
    const scope = resolveCredentialScope(options)
    return parseStoredCredential(await backend.getPassword(SERVICE_NAME, toCredentialAccountName(network, scope)))
  }

  const resolveRecord = async (network: string, options?: {scope?: AuthCredentialScope}): Promise<ResolvedCredential | null> => {
    const scope = resolveCredentialScope(options)
    const envVar = resolveCredentialEnvVarName(network, scope)
    const envValue = env[envVar]
    if (envValue) {
      return {
        source: 'env',
        scope,
        token: envValue,
      }
    }

    const stored = await retrieveRecord(network, {scope})
    if (!stored) return null
    return {
      ...stored,
      source: 'stored',
      scope,
    }
  }

  return {
    async store(
      network: string,
      token: string,
      options: {mode?: AuthProfileMode; scope?: AuthCredentialScope} = {},
    ): Promise<void> {
      const scope = resolveCredentialScope(options)
      await backend.setPassword(
        SERVICE_NAME,
        toCredentialAccountName(network, scope),
        serializeStoredCredential({
          mode: options.mode,
          scope,
          storedAt: new Date().toISOString(),
          token,
        }),
      )
    },

    async retrieve(network: string, options?: {scope?: AuthCredentialScope}): Promise<string | null> {
      return (await retrieveRecord(network, options))?.token ?? null
    },

    async retrieveRecord(network: string, options?: {scope?: AuthCredentialScope}): Promise<StoredCredential | null> {
      return retrieveRecord(network, options)
    },

    async resolve(network: string, options?: {scope?: AuthCredentialScope}): Promise<string | null> {
      return (await resolveRecord(network, options))?.token ?? null
    },

    async resolveRecord(network: string, options?: {scope?: AuthCredentialScope}): Promise<ResolvedCredential | null> {
      return resolveRecord(network, options)
    },

    async remove(network: string, options?: {scope?: AuthCredentialScope}): Promise<boolean> {
      return backend.deletePassword(SERVICE_NAME, toCredentialAccountName(network, resolveCredentialScope(options)))
    },

    async list(options?: {scope?: AuthCredentialScope | 'all'}): Promise<string[]> {
      const creds = await backend.findCredentials(SERVICE_NAME)
      return creds.flatMap(({account}) => {
        const parsed = parseCredentialAccount(account)
        if (options?.scope === 'all') {
          return [parsed.network]
        }

        const scope = options?.scope ?? 'app'
        return parsed.scope === scope ? [parsed.network] : []
      })
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
