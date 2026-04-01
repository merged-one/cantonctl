/**
 * @module ledger-client
 *
 * HTTP client for the Canton JSON Ledger API V2 (port 7575). Provides typed
 * methods for all core ledger operations: DAR upload, command submission,
 * contract queries, party management, and version checks.
 *
 * Uses native `fetch` (injected for testability) and maps HTTP errors to
 * structured {@link CantonctlError} instances with appropriate error codes.
 *
 * All operations require a JWT Bearer token — even local sandboxes decode
 * (but don't validate) the token. Use {@link createSandboxToken} from the
 * `jwt` module to generate tokens for local development.
 *
 * @example
 * ```ts
 * import { createLedgerClient } from './ledger-client.js'
 * import { createSandboxToken } from './jwt.js'
 *
 * const token = await createSandboxToken({ actAs: ['Alice::1234'], readAs: [], applicationId: 'cantonctl' })
 * const client = createLedgerClient({ baseUrl: 'http://localhost:7575', token })
 *
 * const version = await client.getVersion()
 * const { partyDetails } = await client.allocateParty({ displayName: 'Bob' })
 * ```
 */

import {CantonctlError, ErrorCode} from './errors.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** Command to submit to the ledger. */
export interface SubmitRequest {
  /** Command ID for idempotency. */
  commandId: string
  /** Parties authorizing the command. */
  actAs: string[]
  /** List of commands (create, exercise, etc.). */
  commands: unknown[]
  /** User ID for Canton V2 API authentication. */
  userId?: string
}

/** Filter for active contract queries. */
export interface ContractFilter {
  /** Party whose contracts to query. */
  party: string
  /** Template IDs to filter by. */
  templateIds?: string[]
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/** Client for the Canton JSON Ledger API V2. */
export interface LedgerClient {
  /** Get ledger version info. */
  getVersion(signal?: AbortSignal): Promise<Record<string, unknown>>
  /** Upload a DAR archive (raw bytes). */
  uploadDar(darBytes: Uint8Array, signal?: AbortSignal): Promise<{mainPackageId: string}>
  /** Submit a command and wait for the transaction result. */
  submitAndWait(request: SubmitRequest, signal?: AbortSignal): Promise<{transaction: Record<string, unknown>}>
  /** Query active contracts. */
  getActiveContracts(params: {filter: ContractFilter}, signal?: AbortSignal): Promise<{activeContracts: Array<Record<string, unknown>>}>
  /** Allocate a new party on the ledger. */
  allocateParty(params: {displayName: string; identifierHint?: string}, signal?: AbortSignal): Promise<{partyDetails: Record<string, unknown>}>
  /** List known parties. */
  getParties(signal?: AbortSignal): Promise<{partyDetails: Array<Record<string, unknown>>}>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a {@link LedgerClient} for the Canton JSON Ledger API V2.
 *
 * @param options - Client configuration including base URL and JWT token
 * @returns A configured LedgerClient instance
 */
export function createLedgerClient(options: LedgerClientOptions): LedgerClient {
  const {baseUrl, token} = options
  const fetchFn = options.fetch ?? globalThis.fetch

  /**
   * Execute an HTTP request against the ledger API.
   * Maps HTTP errors to appropriate CantonctlError codes.
   */
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    errorCode?: ErrorCode,
  ): Promise<T> {
    const url = `${baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    }

    const init: RequestInit = {headers, method, signal}

    if (body instanceof Uint8Array) {
      headers['Content-Type'] = 'application/octet-stream'
      init.body = body as unknown as BodyInit
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    let response: Response
    try {
      response = await fetchFn(url, init)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }

      throw new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED, {
        cause: err instanceof Error ? err : undefined,
        context: {url},
        suggestion: `Cannot connect to ${baseUrl}. Is the Canton sandbox running?`,
      })
    }

    if (response.status === 401 || response.status === 403) {
      throw new CantonctlError(ErrorCode.LEDGER_AUTH_EXPIRED, {
        context: {status: response.status, url},
        suggestion: 'Generate a new JWT token. The current token may have expired.',
      })
    }

    if (!response.ok) {
      let errorBody: string
      try {
        errorBody = await response.text()
      } catch {
        errorBody = `HTTP ${response.status}`
      }

      const code = errorCode ?? ErrorCode.LEDGER_CONNECTION_FAILED
      throw new CantonctlError(code, {
        context: {body: errorBody, status: response.status, url},
        suggestion: `Ledger API returned HTTP ${response.status}. Check the request and ledger logs.`,
      })
    }

    return response.json() as Promise<T>
  }

  return {
    async getVersion(signal?: AbortSignal) {
      return request<Record<string, unknown>>('GET', '/v2/version', undefined, signal)
    },

    async uploadDar(darBytes: Uint8Array, signal?: AbortSignal) {
      return request<{mainPackageId: string}>(
        'POST', '/v2/dars', darBytes, signal, ErrorCode.DEPLOY_UPLOAD_FAILED,
      )
    },

    async submitAndWait(req: SubmitRequest, signal?: AbortSignal) {
      return request<{transaction: Record<string, unknown>}>(
        'POST', '/v2/commands/submit-and-wait', req, signal, ErrorCode.LEDGER_COMMAND_REJECTED,
      )
    },

    async getActiveContracts(params: {filter: ContractFilter}, signal?: AbortSignal) {
      return request<{activeContracts: Array<Record<string, unknown>>}>(
        'POST', '/v2/state/active-contracts', params, signal,
      )
    },

    async allocateParty(params: {displayName: string; identifierHint?: string}, signal?: AbortSignal) {
      return request<{partyDetails: Record<string, unknown>}>(
        'POST', '/v2/parties', {
          displayName: params.displayName,
          partyIdHint: params.identifierHint ?? params.displayName,
        }, signal,
      )
    },

    async getParties(signal?: AbortSignal) {
      return request<{partyDetails: Array<Record<string, unknown>>}>(
        'GET', '/v2/parties', undefined, signal,
      )
    },
  }
}
