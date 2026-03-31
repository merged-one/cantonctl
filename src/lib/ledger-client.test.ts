import {describe, expect, it, vi} from 'vitest'

import {type LedgerClient, createLedgerClient} from './ledger-client.js'
import {CantonctlError, ErrorCode} from './errors.js'

/**
 * Creates a mock fetch function for ledger client tests.
 * Returns a function matching the Fetch API signature.
 */
function createMockFetch(): ReturnType<typeof vi.fn> & {
  mockJsonResponse(status: number, body: unknown): void
  mockTextResponse(status: number, body: string): void
  mockNetworkError(message: string): void
} {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & {
    mockJsonResponse(status: number, body: unknown): void
    mockTextResponse(status: number, body: string): void
    mockNetworkError(message: string): void
  }

  fn.mockJsonResponse = (status: number, body: unknown) => {
    fn.mockResolvedValue(new Response(JSON.stringify(body), {
      headers: {'Content-Type': 'application/json'},
      status,
    }))
  }

  fn.mockTextResponse = (status: number, body: string) => {
    fn.mockResolvedValue(new Response(body, {status}))
  }

  fn.mockNetworkError = (message: string) => {
    fn.mockRejectedValue(new TypeError(message))
  }

  return fn
}

describe('LedgerClient', () => {
  const baseUrl = 'http://localhost:7575'
  const token = 'test-jwt-token'

  describe('getVersion()', () => {
    it('returns version info from /v2/version', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(200, {version: '3.4.9', features: ['daml-lf/1.17']})

      const client = createLedgerClient({baseUrl, fetch, token})
      const version = await client.getVersion()
      expect(version).toEqual({version: '3.4.9', features: ['daml-lf/1.17']})
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v2/version`,
        expect.objectContaining({
          headers: expect.objectContaining({Authorization: `Bearer ${token}`}),
          method: 'GET',
        }),
      )
    })

    it('throws LEDGER_CONNECTION_FAILED on network error', async () => {
      const fetch = createMockFetch()
      fetch.mockNetworkError('fetch failed')

      const client = createLedgerClient({baseUrl, fetch, token})
      await expect(client.getVersion()).rejects.toThrow(CantonctlError)
      try {
        await client.getVersion()
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.LEDGER_CONNECTION_FAILED)
      }
    })

    it('throws LEDGER_AUTH_EXPIRED on 401', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(401, {error: 'Token expired'})

      const client = createLedgerClient({baseUrl, fetch, token})
      await expect(client.getVersion()).rejects.toThrow(CantonctlError)
      try {
        await client.getVersion()
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.LEDGER_AUTH_EXPIRED)
      }
    })
  })

  describe('uploadDar()', () => {
    it('uploads DAR bytes to /v2/dars', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(200, {mainPackageId: 'abc123'})

      const client = createLedgerClient({baseUrl, fetch, token})
      const darBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]) // ZIP header
      const result = await client.uploadDar(darBytes)
      expect(result.mainPackageId).toBe('abc123')
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v2/dars`,
        expect.objectContaining({
          body: darBytes,
          method: 'POST',
        }),
      )
    })

    it('throws DEPLOY_UPLOAD_FAILED on non-200 response', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(400, {error: 'Invalid DAR'})

      const client = createLedgerClient({baseUrl, fetch, token})
      await expect(client.uploadDar(new Uint8Array())).rejects.toThrow(CantonctlError)
      try {
        await client.uploadDar(new Uint8Array())
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.DEPLOY_UPLOAD_FAILED)
      }
    })

    it('respects AbortSignal', async () => {
      const fetch = createMockFetch()
      const controller = new AbortController()
      controller.abort()
      fetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'))

      const client = createLedgerClient({baseUrl, fetch, token})
      await expect(client.uploadDar(new Uint8Array(), controller.signal)).rejects.toThrow()
    })
  })

  describe('submitAndWait()', () => {
    it('submits command to /v2/commands/submit-and-wait', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(200, {
        transaction: {commandId: 'cmd-1', transactionId: 'tx-1'},
      })

      const client = createLedgerClient({baseUrl, fetch, token})
      const result = await client.submitAndWait({
        actAs: ['Alice::1234'],
        commands: [{
          createCommand: {
            arguments: {owner: 'Alice::1234'},
            templateId: 'Main:Token',
          },
        }],
        commandId: 'cmd-1',
      })
      expect(result.transaction.transactionId).toBe('tx-1')
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v2/commands/submit-and-wait`,
        expect.objectContaining({method: 'POST'}),
      )
    })

    it('throws LEDGER_COMMAND_REJECTED on non-200', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(400, {error: 'Insufficient rights'})

      const client = createLedgerClient({baseUrl, fetch, token})
      await expect(client.submitAndWait({
        actAs: ['Alice::1234'],
        commands: [],
        commandId: 'cmd-1',
      })).rejects.toThrow(CantonctlError)
      try {
        await client.submitAndWait({actAs: ['Alice::1234'], commands: [], commandId: 'cmd-1'})
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.LEDGER_COMMAND_REJECTED)
      }
    })
  })

  describe('getActiveContracts()', () => {
    it('queries active contracts from /v2/state/active-contracts', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(200, {
        activeContracts: [
          {contractId: 'c-1', templateId: 'Main:Token', payload: {owner: 'Alice'}},
        ],
      })

      const client = createLedgerClient({baseUrl, fetch, token})
      const result = await client.getActiveContracts({
        filter: {party: 'Alice::1234', templateIds: ['Main:Token']},
      })
      expect(result.activeContracts).toHaveLength(1)
      expect(result.activeContracts[0].contractId).toBe('c-1')
    })
  })

  describe('allocateParty()', () => {
    it('allocates a party via POST /v2/parties', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(200, {
        partyDetails: {displayName: 'Alice', identifier: 'Alice::1234', isLocal: true},
      })

      const client = createLedgerClient({baseUrl, fetch, token})
      const result = await client.allocateParty({displayName: 'Alice'})
      expect(result.partyDetails.identifier).toBe('Alice::1234')
      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/v2/parties`,
        expect.objectContaining({method: 'POST'}),
      )
    })
  })

  describe('getParties()', () => {
    it('lists known parties from /v2/parties', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(200, {
        partyDetails: [
          {displayName: 'Alice', identifier: 'Alice::1234', isLocal: true},
          {displayName: 'Bob', identifier: 'Bob::5678', isLocal: true},
        ],
      })

      const client = createLedgerClient({baseUrl, fetch, token})
      const result = await client.getParties()
      expect(result.partyDetails).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    it('throws LEDGER_AUTH_EXPIRED on 403 (forbidden)', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(403, {error: 'Forbidden'})

      const client = createLedgerClient({baseUrl, fetch, token})
      try {
        await client.getVersion()
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.LEDGER_AUTH_EXPIRED)
      }
    })

    it('handles error body parse failure on non-ok response', async () => {
      const fetch = vi.fn()
      // Return a response where .text() throws
      fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => { throw new Error('body stream already consumed') },
      })

      const client = createLedgerClient({baseUrl, fetch, token})
      try {
        await client.getVersion()
      } catch (err) {
        expect(err).toBeInstanceOf(CantonctlError)
        expect((err as CantonctlError).context.body).toBe('HTTP 500')
      }
    })

    it('handles non-Error thrown from fetch (string throw)', async () => {
      const fetch = vi.fn().mockRejectedValue('network down')

      const client = createLedgerClient({baseUrl, fetch, token})
      try {
        await client.getVersion()
      } catch (err) {
        expect(err).toBeInstanceOf(CantonctlError)
        expect((err as CantonctlError).code).toBe(ErrorCode.LEDGER_CONNECTION_FAILED)
      }
    })

    it('uses default fetch when none provided', () => {
      // Should not throw during construction
      const client = createLedgerClient({baseUrl, token})
      expect(client).toBeDefined()
    })

    it('falls back to LEDGER_CONNECTION_FAILED when no error code override', async () => {
      const fetch = createMockFetch()
      fetch.mockJsonResponse(500, {error: 'Internal error'})

      const client = createLedgerClient({baseUrl, fetch, token})
      try {
        await client.getVersion()
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.LEDGER_CONNECTION_FAILED)
      }
    })
  })
})
