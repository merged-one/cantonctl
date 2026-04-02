import {describe, expect, it, vi} from 'vitest'

import {createValidatorUserAdapter} from './validator-user.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

describe('createValidatorUserAdapter', () => {
  it('resolves the validator profile endpoint for stable wallet-backed traffic requests', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({
      request_contract_id: 'traffic-request-1',
    }))

    const adapter = createValidatorUserAdapter({
      fetch,
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'validator',
        services: {
          validator: {url: 'https://validator.example.com/api/validator'},
        },
      },
      token: 'jwt-token',
    })

    const response = await adapter.createBuyTrafficRequest({
      domain_id: 'domain::1',
      expires_at: 1_744_000_000_000_000,
      receiving_validator_party_id: 'ValidatorUser',
      tracking_id: 'tracking-1',
      traffic_amount: 4096,
    })

    expect(response).toEqual({request_contract_id: 'traffic-request-1'})
    expect(fetch.mock.calls[0][0]).toBe(
      'https://validator.example.com/api/validator/v0/wallet/buy-traffic-requests',
    )
    expect(fetch.mock.calls[0][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({Authorization: 'Bearer jwt-token'}),
      method: 'POST',
    }))
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({
      domain_id: 'domain::1',
      expires_at: 1_744_000_000_000_000,
      receiving_validator_party_id: 'ValidatorUser',
      tracking_id: 'tracking-1',
      traffic_amount: 4096,
    })
    expect(adapter.metadata.upstreamSourceIds).toEqual(['splice-wallet-external-openapi'])
  })

  it('treats unknown tracking ids as absent status instead of failing', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({error: 'missing'}, 404))

    const adapter = createValidatorUserAdapter({
      baseUrl: 'https://validator.example.com/api/validator',
      fetch,
      token: 'jwt-token',
    })

    await expect(adapter.getBuyTrafficRequestStatus('tracking-404')).resolves.toBeNull()
    expect(fetch.mock.calls[0][0]).toBe(
      'https://validator.example.com/api/validator/v0/wallet/buy-traffic-requests/tracking-404/status',
    )
  })
})
