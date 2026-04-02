/**
 * Experimental validator-internal adapter.
 *
 * This module intentionally isolates operator-only validator endpoints from the
 * stable adapter tree. The upstream contract is marked non-GA, can change
 * without notice, and should only be used by explicitly experimental flows.
 */

import {
  createAdapterTransport,
  type AdapterFetchFn,
  type AdapterHttpMethod,
  type AdapterMetadata,
  type AdapterProfileContext,
  type AdapterQueryValue,
} from '../adapters/common.js'

export interface ValidatorInternalAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token?: string
}

export interface ValidatorInternalRequest {
  body?: unknown
  bodyContentType?: string
  method: AdapterHttpMethod
  path: string
  query?: Record<string, AdapterQueryValue>
  signal?: AbortSignal
}

export interface ValidatorInternalAdapter {
  metadata: AdapterMetadata<'validator'>
  requestJson<T>(request: ValidatorInternalRequest): Promise<T>
  requestOptionalJson<T>(request: ValidatorInternalRequest): Promise<T | null>
}

export function createValidatorInternalAdapter(
  options: ValidatorInternalAdapterOptions,
): ValidatorInternalAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    profile: options.profile,
    service: 'validator',
    sourceIds: ['splice-validator-internal-openapi'],
    token: options.token,
    warnings: [
      'validator-internal is operator-only and intentionally not part of the GA cantonctl adapter surface.',
    ],
  })

  return {
    metadata: transport.metadata,

    async requestJson<T>(request: ValidatorInternalRequest) {
      return transport.requestJson<T>({
        body: request.body,
        bodyContentType: request.bodyContentType,
        method: request.method,
        path: request.path,
        query: request.query,
        signal: request.signal,
      })
    },

    async requestOptionalJson<T>(request: ValidatorInternalRequest) {
      return transport.requestOptionalJson<T>({
        body: request.body,
        bodyContentType: request.bodyContentType,
        method: request.method,
        path: request.path,
        query: request.query,
        signal: request.signal,
      })
    },
  }
}
