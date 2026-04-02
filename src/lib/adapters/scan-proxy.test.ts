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
})
