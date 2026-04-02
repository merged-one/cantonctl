/**
 * @module ledger-client
 *
 * Compatibility wrapper around the stable ledger adapter. The public API stays
 * unchanged for current callers while the request/response plumbing now lives
 * in `src/lib/adapters/ledger.ts`.
 */

import {
  createLedgerAdapter,
  type ContractFilter,
  type SubmitRequest,
} from './adapters/ledger.js'

/** Fetch function signature (subset of global fetch). */
export type FetchFn = typeof globalThis.fetch

export interface LedgerClientOptions {
  /** Base URL of the JSON Ledger API (e.g., `http://localhost:7575`). */
  baseUrl: string
  /** JWT Bearer token for authentication. */
  token: string
  /** Fetch implementation. Defaults to global `fetch`. */
  fetch?: FetchFn
}

/** Client for the Canton JSON Ledger API V2. */
export interface LedgerClient {
  /** Get ledger version info. */
  getVersion(signal?: AbortSignal): Promise<Record<string, unknown>>
  /** Get the current ledger end offset. */
  getLedgerEnd(signal?: AbortSignal): Promise<{offset: number}>
  /** Upload a DAR archive (raw bytes). */
  uploadDar(darBytes: Uint8Array, signal?: AbortSignal): Promise<{mainPackageId: string}>
  /** Submit a command and wait for the transaction result. */
  submitAndWait(request: SubmitRequest, signal?: AbortSignal): Promise<{transaction: Record<string, unknown>}>
  /** Query active contracts (auto-fetches ledger end offset). */
  getActiveContracts(params: {filter: ContractFilter}, signal?: AbortSignal): Promise<{activeContracts: Array<Record<string, unknown>>}>
  /** Allocate a new party on the ledger. */
  allocateParty(params: {displayName: string; identifierHint?: string}, signal?: AbortSignal): Promise<{partyDetails: Record<string, unknown>}>
  /** List known parties. */
  getParties(signal?: AbortSignal): Promise<{partyDetails: Array<Record<string, unknown>>}>
}

/**
 * Create a {@link LedgerClient} for the Canton JSON Ledger API V2.
 *
 * @param options - Client configuration including base URL and JWT token
 * @returns A configured LedgerClient instance
 */
export function createLedgerClient(options: LedgerClientOptions): LedgerClient {
  const adapter = createLedgerAdapter({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    token: options.token,
  })

  return {
    async allocateParty(params, signal) {
      return adapter.allocateParty(params, signal)
    },

    async getActiveContracts(params, signal) {
      const result = await adapter.getActiveContracts(params, signal)
      return {
        activeContracts: result.activeContracts.map(contract => ({...contract})),
      }
    },

    async getLedgerEnd(signal) {
      const response = await adapter.getLedgerEnd(signal)
      return {offset: response.offset ?? 0}
    },

    async getParties(signal) {
      return adapter.getParties(signal)
    },

    async getVersion(signal) {
      return adapter.getVersion(signal)
    },

    async submitAndWait(request, signal) {
      return adapter.submitAndWait(request, signal)
    },

    async uploadDar(darBytes, signal) {
      return adapter.uploadDar(darBytes, signal)
    },
  }
}
