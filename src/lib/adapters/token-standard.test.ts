import {describe, expect, it, vi} from 'vitest'

import {TOKEN_STANDARD_FAMILY_SOURCES, createTokenStandardAdapter} from './token-standard.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

describe('createTokenStandardAdapter', () => {
  it('exposes the stable token-standard families declared in the upstream manifest', () => {
    const adapter = createTokenStandardAdapter({baseUrl: 'https://token.example.com'})

    expect(adapter.metadata.families).toEqual([
      {family: 'allocation', sourceId: TOKEN_STANDARD_FAMILY_SOURCES.allocation},
      {family: 'allocationInstruction', sourceId: TOKEN_STANDARD_FAMILY_SOURCES.allocationInstruction},
      {family: 'metadata', sourceId: TOKEN_STANDARD_FAMILY_SOURCES.metadata},
      {family: 'transferInstruction', sourceId: TOKEN_STANDARD_FAMILY_SOURCES.transferInstruction},
    ])
    expect(adapter.metadata.warnings.join(' ')).toContain('transport-only')
  })

  it('forwards requests through the selected family client', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({items: []}))

    const adapter = createTokenStandardAdapter({
      fetch,
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'validator',
        services: {
          tokenStandard: {url: 'https://token.example.com'},
        },
      },
      token: 'jwt-token',
    })

    await adapter.families.metadata.requestJson<{items: unknown[]}>({
      method: 'GET',
      path: '/v1/tokens',
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://token.example.com/v1/tokens',
      expect.objectContaining({
        headers: expect.objectContaining({Authorization: 'Bearer jwt-token'}),
        method: 'GET',
      }),
    )
  })

  it('supports optional family lookups through the selected transport client', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', {status: 404}))

    const adapter = createTokenStandardAdapter({
      baseUrl: 'https://token.example.com',
      fetch,
    })

    await expect(adapter.families.allocation.requestOptionalJson({
      method: 'GET',
      path: '/v1/allocations/missing',
    })).resolves.toBeNull()
  })
})
