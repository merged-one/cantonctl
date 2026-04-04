import {describe, expect, it, vi} from 'vitest'

import {createScanProxyAdapter} from './scan-proxy.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

describe('createScanProxyAdapter', () => {
  it('treats 404 lookups as absent data instead of brittle failures', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({error: 'not found'}, 404))

    const adapter = createScanProxyAdapter({
      baseUrl: 'https://validator.example.com',
      fetch,
    })

    await expect(adapter.lookupAnsEntryByName('alice.unverified.ans')).resolves.toBeNull()
    expect(fetch.mock.calls[0][0]).toBe(
      'https://validator.example.com/v0/scan-proxy/ans-entries/by-name/alice.unverified.ans',
    )
  })

  it('keeps scan-proxy metadata visibly marked as non-GA and forwards query params', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({entries: []}))

    const adapter = createScanProxyAdapter({
      baseUrl: 'https://validator.example.com',
      fetch,
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'validator',
        services: {
          scanProxy: {url: 'https://validator.example.com'},
        },
      },
    })

    await adapter.listAnsEntries({namePrefix: 'alice', pageSize: 20})

    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.pathname).toBe('/v0/scan-proxy/ans-entries')
    expect(url.searchParams.get('name_prefix')).toBe('alice')
    expect(url.searchParams.get('page_size')).toBe('20')
    expect(adapter.metadata.warnings.join(' ')).toContain('not GA')
  })

  it('covers the remaining scan-proxy endpoints with encoded path and query handling', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({dso_party_id: 'DSO::1220'}))
      .mockResolvedValueOnce(createJsonResponse({dso_name: 'DSO'}))
      .mockResolvedValueOnce(createJsonResponse({amulet_rules: {contract_id: 'amulet-1'}}))
      .mockResolvedValueOnce(createJsonResponse({
        issuing_mining_rounds: [{contract_id: 'issuing-1'}],
        open_mining_rounds: [{contract_id: 'open-1'}],
      }))
      .mockResolvedValueOnce(createJsonResponse({rules: []}))
      .mockResolvedValueOnce(createJsonResponse({entry: {name: 'alice'}}))
      .mockResolvedValueOnce(createJsonResponse({entry: {party: 'Alice::1220'}}))
      .mockResolvedValueOnce(createJsonResponse({counter: 7}))
      .mockResolvedValueOnce(createJsonResponse({status: 'pending'}))
      .mockResolvedValueOnce(createJsonResponse({preapproval: {party: 'Alice::1220'}}))

    const adapter = createScanProxyAdapter({
      baseUrl: 'https://validator.example.com',
      fetch,
      token: 'jwt-token',
    })

    await expect(adapter.getDsoPartyId()).resolves.toEqual({dso_party_id: 'DSO::1220'})
    await expect(adapter.getDsoInfo()).resolves.toEqual({dso_name: 'DSO'})
    await expect(adapter.getAmuletRules()).resolves.toEqual({amulet_rules: {contract_id: 'amulet-1'}})
    await expect(adapter.getOpenAndIssuingMiningRounds()).resolves.toEqual({
      issuing_mining_rounds: [{contract_id: 'issuing-1'}],
      open_mining_rounds: [{contract_id: 'open-1'}],
    })
    await expect(adapter.getAnsRules({} as never)).resolves.toEqual({rules: []})
    await expect(adapter.lookupAnsEntryByName('alice/with spaces')).resolves.toEqual({entry: {name: 'alice'}})
    await expect(adapter.lookupAnsEntryByParty('Alice::1220')).resolves.toEqual({entry: {party: 'Alice::1220'}})
    await expect(adapter.lookupTransferCommandCounterByParty('Alice::1220')).resolves.toEqual({counter: 7})
    await expect(adapter.lookupTransferCommandStatus({nonce: 7, sender: 'Alice::1220'})).resolves.toEqual({status: 'pending'})
    await expect(adapter.lookupTransferPreapprovalByParty('Alice::1220')).resolves.toEqual({preapproval: {party: 'Alice::1220'}})

    const transferStatusUrl = new URL(String(fetch.mock.calls[8][0]))
    expect(String(fetch.mock.calls[5][0])).toContain('alice%2Fwith%20spaces')
    expect(transferStatusUrl.searchParams.get('nonce')).toBe('7')
    expect(transferStatusUrl.searchParams.get('sender')).toBe('Alice::1220')
    expect(fetch.mock.calls[4][1]).toEqual(expect.objectContaining({method: 'POST'}))
  })
})
