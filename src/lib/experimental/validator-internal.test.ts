import {describe, expect, it, vi} from 'vitest'

import {createValidatorInternalAdapter} from './validator-internal.js'

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
})
