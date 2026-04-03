import {describe, expect, it, vi} from 'vitest'

import {ErrorCode} from '../errors.js'
import {
  createValidatorInternalAdapter,
  requireExperimentalConfirmation,
} from './validator-internal.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

describe('createValidatorInternalAdapter', () => {
  it('keeps validator-internal behind an explicitly experimental module', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({users: []}))

    const adapter = createValidatorInternalAdapter({
      baseUrl: 'https://validator.example.com',
      fetch,
      token: 'jwt-token',
    })

    await adapter.requestJson<{users: unknown[]}>({
      method: 'GET',
      path: '/v0/admin/users',
    })

    expect(fetch.mock.calls[0][0]).toBe('https://validator.example.com/v0/admin/users')
    expect(adapter.metadata.warnings.join(' ')).toContain('operator-only')
  })

  it('covers validator-internal admin flows and encoded query helpers', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({party_id: 'Alice::1220'}))
      .mockResolvedValueOnce(createJsonResponse({party_id: 'Alice::1220', topology_txs: []}))
      .mockResolvedValueOnce(createJsonResponse({contract_id: 'proposal-1'}))
      .mockResolvedValueOnce(createJsonResponse({party_id: 'Alice::1220'}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse({users: []}))
      .mockResolvedValueOnce(createJsonResponse({users: []}))

    const adapter = createValidatorInternalAdapter({
      baseUrl: 'https://validator.example.com',
      fetch,
      token: 'jwt-token',
    })

    await expect(adapter.onboardUser({name: 'alice'})).resolves.toEqual({party_id: 'Alice::1220'})
    await expect(adapter.generateExternalPartyTopology({party_hint: 'alice', public_key: 'pub'})).resolves.toEqual({
      party_id: 'Alice::1220',
      topology_txs: [],
    })
    await expect(adapter.createExternalPartySetupProposal({user_party_id: 'Alice::1220'})).resolves.toEqual({
      contract_id: 'proposal-1',
    })
    await expect(adapter.submitExternalPartyTopology({
      public_key: 'pub',
      signed_topology_txs: [{signed_hash: 'sig', topology_tx: 'tx'}],
    })).resolves.toEqual({party_id: 'Alice::1220'})
    await expect(adapter.offboardUser('alice+ops')).resolves.toBeUndefined()
    await expect(adapter.requestJson<{users: unknown[]}>({
      method: 'GET',
      path: '/v0/admin/users',
    })).resolves.toEqual({users: []})
    await expect(adapter.requestOptionalJson<{users: unknown[]}>({
      method: 'GET',
      path: '/v0/admin/users',
    })).resolves.toEqual({users: []})

    expect(String(fetch.mock.calls[4][0])).toContain('username=alice%2Bops')
  })
})

describe('requireExperimentalConfirmation', () => {
  it('allows explicitly confirmed commands and rejects implicit ones', () => {
    expect(() => requireExperimentalConfirmation(true, 'validator experimental register-user devnet')).not.toThrow()
    expect(() => requireExperimentalConfirmation(false, 'validator experimental register-user devnet'))
      .toThrowError(expect.objectContaining({code: ErrorCode.EXPERIMENTAL_CONFIRMATION_REQUIRED}))
  })
})
