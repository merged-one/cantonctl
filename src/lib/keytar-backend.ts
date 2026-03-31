/**
 * @module keytar-backend
 *
 * OS keychain backend for credential-store. Wraps the `keytar` native module
 * to provide secure credential storage via the system keychain (macOS Keychain,
 * Windows Credential Manager, Linux Secret Service).
 *
 * Falls back to an in-memory backend when keytar is unavailable (e.g., CI
 * environments without native build tools).
 *
 * @example
 * ```ts
 * const backend = createBackendWithFallback()
 * const store = createCredentialStore({ backend })
 * ```
 */

import {createInMemoryBackend, type KeychainBackend} from './credential-store.js'

// ---------------------------------------------------------------------------
// Keytar backend
// ---------------------------------------------------------------------------

/** Interface matching keytar's public API (avoids hard dep on @types/keytar). */
interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
  findCredentials(service: string): Promise<Array<{account: string; password: string}>>
}

/**
 * Create a KeychainBackend backed by the OS keychain via keytar.
 * Throws if keytar is not installed or cannot be loaded.
 */
export async function createKeytarBackend(): Promise<KeychainBackend> {
  // Dynamic import so the module is optional at install time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const keytar = await (import('keytar' as string) as Promise<KeytarModule>)

  return {
    async getPassword(service: string, account: string): Promise<string | null> {
      return keytar.getPassword(service, account)
    },

    async setPassword(service: string, account: string, password: string): Promise<void> {
      await keytar.setPassword(service, account, password)
    },

    async deletePassword(service: string, account: string): Promise<boolean> {
      return keytar.deletePassword(service, account)
    },

    async findCredentials(service: string): Promise<Array<{account: string; password: string}>> {
      return keytar.findCredentials(service)
    },
  }
}

// ---------------------------------------------------------------------------
// Factory with fallback
// ---------------------------------------------------------------------------

/**
 * Create the best available keychain backend:
 * 1. OS keychain via keytar (if installed)
 * 2. In-memory fallback (CI, containers, missing native deps)
 *
 * Returns `{backend, isKeychain}` so callers can warn when falling back.
 */
export async function createBackendWithFallback(): Promise<{backend: KeychainBackend; isKeychain: boolean}> {
  try {
    const backend = await createKeytarBackend()
    return {backend, isKeychain: true}
  } catch {
    return {backend: createInMemoryBackend(), isKeychain: false}
  }
}
