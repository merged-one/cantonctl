import {describe, expect, it, vi} from 'vitest'

import {createAnsAdapter} from './ans.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

describe('createAnsAdapter', () => {
  it('uses the ANS profile endpoint and normalizes listed entries', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({
      entries: [{
        amount: '10.0',
        contractId: 'cid-1',
        expiresAt: '2026-05-01T00:00:00Z',
        name: 'alice.unverified.ans',
        paymentDuration: 'P30D',
        paymentInterval: 'P30D',
        unit: 'AMT',
      }],
    }))

    const adapter = createAnsAdapter({
      fetch,
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'validator',
        services: {
          ans: {url: 'https://ans.example.com'},
        },
      },
    })

    const result = await adapter.listEntries()

    expect(fetch.mock.calls[0][0]).toBe('https://ans.example.com/v0/entry/all')
    expect(result.entries).toEqual([{
      amount: '10.0',
      contractId: 'cid-1',
      expiresAt: '2026-05-01T00:00:00Z',
      name: 'alice.unverified.ans',
      paymentDuration: 'P30D',
      paymentInterval: 'P30D',
      unit: 'AMT',
    }])
  })

  it('posts ANS entry creation requests to the external API', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({
      entryContextCid: 'cid-ctx',
      subscriptionRequestCid: 'cid-sub',
    }))

    const adapter = createAnsAdapter({
      baseUrl: 'https://ans.example.com',
      fetch,
      token: 'jwt-token',
    })

    await adapter.createEntry({
      description: 'Example entry',
      name: 'alice.unverified.ans',
      url: 'https://example.com',
    })

    const [, init] = fetch.mock.calls[0]
    expect(fetch.mock.calls[0][0]).toBe('https://ans.example.com/v0/entry/create')
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({Authorization: 'Bearer jwt-token'}),
      method: 'POST',
    }))
    expect(JSON.parse(String(init.body))).toEqual({
      description: 'Example entry',
      name: 'alice.unverified.ans',
      url: 'https://example.com',
    })
  })
})
