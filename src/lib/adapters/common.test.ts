import {describe, expect, it, vi} from 'vitest'

import {CantonctlError, ErrorCode} from '../errors.js'
import {
  createAdapterTransport,
  isRecord,
  readArray,
  readNumber,
  readRecord,
  readString,
} from './common.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

function createProfile(overrides: Record<string, unknown> = {}) {
  return {
    experimental: false,
    kind: 'remote-validator',
    name: 'profile',
    services: {
      ans: {url: 'https://ans.example.com/'},
      ledger: {url: 'https://ledger.example.com/'},
      scan: {url: 'https://scan.example.com/'},
      scanProxy: {url: 'https://scan-proxy.example.com/'},
      tokenStandard: {url: 'https://token.example.com/'},
      validator: {url: 'https://validator.example.com/'},
      ...overrides,
    },
  } as const
}

describe('createAdapterTransport', () => {
  it('builds query strings, trims explicit base urls, and parses json responses', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({items: [1, 2]}))
    const transport = createAdapterTransport({
      baseUrl: 'https://service.example.com///',
      fetch,
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })

    const result = await transport.requestJson<{items: number[]}>({
      method: 'GET',
      path: '//v1/items',
      query: {
        flag: true,
        ids: [1, null, undefined, 2],
        q: 'name',
      },
    })

    expect(result).toEqual({items: [1, 2]})
    expect(transport.metadata.baseUrl).toBe('https://service.example.com')

    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.pathname).toBe('/v1/items')
    expect(url.searchParams.get('q')).toBe('name')
    expect(url.searchParams.getAll('ids')).toEqual(['1', '2'])
    expect(url.searchParams.get('flag')).toBe('true')
  })

  it('supports binary, text, void, optional 404, and empty-json request flows', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, {status: 204}))
      .mockResolvedValueOnce(new Response('plain text', {status: 200}))
      .mockResolvedValueOnce(new Response('', {status: 404}))
      .mockResolvedValueOnce(new Response('', {status: 200}))

    const transport = createAdapterTransport({
      baseUrl: 'https://service.example.com',
      fetch,
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
      token: 'jwt-token',
    })

    await expect(transport.requestVoid({
      body: new Uint8Array([1, 2, 3]),
      method: 'POST',
      path: '/v1/upload',
    })).resolves.toBeUndefined()

    await expect(transport.requestText({
      body: 'payload',
      bodyContentType: 'text/plain',
      method: 'POST',
      path: '/v1/text',
    })).resolves.toBe('plain text')

    await expect(transport.requestOptionalJson({
      method: 'GET',
      path: '/v1/missing',
    })).resolves.toBeNull()

    await expect(transport.requestJson({
      method: 'GET',
      path: '/v1/empty',
    })).resolves.toEqual({})

    expect(fetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      body: new Uint8Array([1, 2, 3]),
      headers: expect.objectContaining({
        Authorization: 'Bearer jwt-token',
        'Content-Type': 'application/octet-stream',
      }),
      method: 'POST',
    }))
    expect(fetch.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      body: 'payload',
      headers: expect.objectContaining({
        Authorization: 'Bearer jwt-token',
        'Content-Type': 'text/plain',
      }),
      method: 'POST',
    }))
  })

  it('propagates aborts and wraps connection failures', async () => {
    const abortError = new DOMException('Aborted', 'AbortError')
    const abortingTransport = createAdapterTransport({
      baseUrl: 'https://service.example.com',
      fetch: vi.fn().mockRejectedValue(abortError),
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })
    await expect(abortingTransport.requestJson({
      method: 'GET',
      path: '/v1/items',
    })).rejects.toBe(abortError)

    const failingTransport = createAdapterTransport({
      baseUrl: 'https://service.example.com',
      fetch: vi.fn().mockRejectedValue('offline'),
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })
    await expect(failingTransport.requestJson({
      method: 'GET',
      path: '/v1/items',
    })).rejects.toThrow(CantonctlError)
    try {
      await failingTransport.requestJson({
        method: 'GET',
        path: '/v1/items',
      })
    } catch (err) {
      const error = err as CantonctlError & {cause?: unknown}
      expect(error.code).toBe(ErrorCode.SERVICE_CONNECTION_FAILED)
      expect(error.cause).toBeUndefined()
    }

    const errorCause = new Error('socket closed')
    const typedFailingTransport = createAdapterTransport({
      baseUrl: 'https://service.example.com',
      fetch: vi.fn().mockRejectedValue(errorCause),
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })
    await expect(typedFailingTransport.requestJson({
      method: 'GET',
      path: '/v1/items',
    })).rejects.toMatchObject({
      cause: errorCause,
      code: ErrorCode.SERVICE_CONNECTION_FAILED,
    })
  })

  it('raises auth and request errors with readable context', async () => {
    const authFetch = vi.fn()
      .mockResolvedValueOnce(new Response('denied', {status: 401}))
      .mockResolvedValueOnce(new Response('denied', {status: 403}))
    const authTransport = createAdapterTransport({
      baseUrl: 'https://service.example.com',
      fetch: authFetch,
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })

    await expect(authTransport.requestJson({
      method: 'GET',
      path: '/v1/items',
    })).rejects.toMatchObject({code: ErrorCode.SERVICE_AUTH_FAILED})
    await expect(authTransport.requestJson({
      method: 'GET',
      path: '/v1/items',
    })).rejects.toMatchObject({code: ErrorCode.SERVICE_AUTH_FAILED})

    const requestTransport = createAdapterTransport({
      baseUrl: 'https://service.example.com',
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: vi.fn().mockRejectedValue(new Error('cannot read body')),
      } as unknown as Response),
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })

    await expect(requestTransport.requestJson({
      method: 'GET',
      path: '/v1/items',
    })).rejects.toMatchObject({
      code: ErrorCode.SERVICE_REQUEST_FAILED,
      context: expect.objectContaining({body: 'HTTP 502', status: 502}),
    })
  })

  it('raises request errors when a supposedly json response is invalid', async () => {
    const transport = createAdapterTransport({
      baseUrl: 'https://service.example.com',
      fetch: vi.fn().mockResolvedValue(new Response('not-json', {status: 200})),
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })

    await expect(transport.requestJson({
      method: 'GET',
      path: '/v1/items',
    })).rejects.toMatchObject({
      code: ErrorCode.SERVICE_REQUEST_FAILED,
      suggestion: expect.stringContaining('Expected JSON'),
    })
  })

  it('drops non-Error JSON parser causes when decoding invalid payloads', async () => {
    const transport = createAdapterTransport({
      baseUrl: 'https://service.example.com',
      fetch: vi.fn().mockResolvedValue(new Response('not-json', {status: 200})),
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })

    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw 'invalid json'
    })

    try {
      await expect(transport.requestJson({
        method: 'GET',
        path: '/v1/items',
      })).rejects.toThrow(CantonctlError)
      try {
        await transport.requestJson({
          method: 'GET',
          path: '/v1/items',
        })
      } catch (err) {
        const error = err as CantonctlError & {cause?: unknown}
        expect(error.code).toBe(ErrorCode.SERVICE_REQUEST_FAILED)
        expect(error.cause).toBeUndefined()
        expect(error.suggestion).toContain('Expected JSON')
      }
    } finally {
      parseSpy.mockRestore()
    }
  })

  it('builds warnings for non-stable upstreams and scanProxy on non-experimental profiles', () => {
    const validatorTransport = createAdapterTransport({
      baseUrl: 'https://validator.example.com',
      service: 'validator',
      sourceIds: ['splice-validator-internal-openapi'],
      warnings: ['custom-warning'],
    })
    expect(validatorTransport.metadata.warnings).toEqual(expect.arrayContaining([
      'custom-warning',
      expect.stringContaining('not GA'),
    ]))

    const scanProxyTransport = createAdapterTransport({
      profile: createProfile(),
      service: 'scanProxy',
      sourceIds: ['splice-scan-proxy-openapi'],
    })
    expect(scanProxyTransport.metadata.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('exposes scanProxy while experimental=false'),
    ]))
  })

  it('resolves profile endpoints and raises missing-service errors when configuration is absent', () => {
    const explicitLedger = createAdapterTransport({
      profile: createProfile(),
      service: 'ledger',
      sourceIds: ['canton-json-ledger-api-openapi'],
    })
    expect(explicitLedger.metadata.baseUrl).toBe('https://ledger.example.com')

    const localLedger = createAdapterTransport({
      profile: createProfile({
        ledger: {'json-api-port': 9000},
      }),
      service: 'ledger',
      sourceIds: ['canton-json-ledger-api-openapi'],
    })
    expect(localLedger.metadata.baseUrl).toBe('http://localhost:9000')

    const defaultLedger = createAdapterTransport({
      profile: createProfile({
        ledger: {},
      }),
      service: 'ledger',
      sourceIds: ['canton-json-ledger-api-openapi'],
    })
    expect(defaultLedger.metadata.baseUrl).toBe('http://localhost:7575')

    expect(() => createAdapterTransport({
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })).toThrowError(expect.objectContaining({
      code: ErrorCode.SERVICE_NOT_CONFIGURED,
      suggestion: expect.stringContaining('Provide a baseUrl or a profile'),
    }))

    expect(() => createAdapterTransport({
      profile: createProfile({ans: undefined}),
      service: 'ans',
      sourceIds: ['splice-ans-external-openapi'],
    })).toThrowError(expect.objectContaining({
      code: ErrorCode.SERVICE_NOT_CONFIGURED,
      suggestion: expect.stringContaining('profiles.profile.ans.url'),
    }))

    expect(() => createAdapterTransport({
      profile: createProfile({ledger: undefined}),
      service: 'ledger',
      sourceIds: ['canton-json-ledger-api-openapi'],
    })).toThrowError(expect.objectContaining({
      code: ErrorCode.SERVICE_NOT_CONFIGURED,
      suggestion: expect.stringContaining('profiles.profile.ledger.url'),
    }))
  })

  it('reads helper values conservatively', () => {
    const record = {
      array: [1, 2, 3],
      nested: {ok: true},
      number: 7,
      string: 'value',
    } satisfies Record<string, unknown>

    expect(isRecord(record)).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord(['x'])).toBe(false)
    expect(readArray(record, 'array')).toEqual([1, 2, 3])
    expect(readArray(record, 'nested')).toBeUndefined()
    expect(readNumber(record, 'number')).toBe(7)
    expect(readNumber(record, 'string')).toBeUndefined()
    expect(readRecord(record, 'nested')).toEqual({ok: true})
    expect(readRecord(record, 'array')).toBeUndefined()
    expect(readString(record, 'string')).toBe('value')
    expect(readString(record, 'number')).toBeUndefined()
  })
})
