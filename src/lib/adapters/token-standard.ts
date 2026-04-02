import type {UpstreamSourceId} from '../upstream/manifest.js'
import {
  createAdapterTransport,
  type AdapterFetchFn,
  type AdapterHttpMethod,
  type AdapterMetadata,
  type AdapterProfileContext,
  type AdapterQueryValue,
} from './common.js'

export interface TokenStandardAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token?: string
}

export const TOKEN_STANDARD_FAMILY_SOURCES = {
  allocation: 'splice-token-allocation-openapi',
  allocationInstruction: 'splice-token-allocation-instruction-openapi',
  metadata: 'splice-token-metadata-openapi',
  transferInstruction: 'splice-token-transfer-instruction-openapi',
} as const satisfies Record<string, UpstreamSourceId>

export type TokenStandardFamily = keyof typeof TOKEN_STANDARD_FAMILY_SOURCES

export interface TokenStandardFamilyRequest {
  body?: unknown
  bodyContentType?: string
  method: AdapterHttpMethod
  path: string
  query?: Record<string, AdapterQueryValue>
  signal?: AbortSignal
}

export interface TokenStandardFamilyDescriptor {
  family: TokenStandardFamily
  sourceId: (typeof TOKEN_STANDARD_FAMILY_SOURCES)[TokenStandardFamily]
}

export interface TokenStandardFamilyClient {
  family: TokenStandardFamily
  requestJson<T>(request: TokenStandardFamilyRequest): Promise<T>
  requestOptionalJson<T>(request: TokenStandardFamilyRequest): Promise<T | null>
  sourceId: (typeof TOKEN_STANDARD_FAMILY_SOURCES)[TokenStandardFamily]
}

export interface TokenStandardAdapter {
  families: Record<TokenStandardFamily, TokenStandardFamilyClient>
  metadata: AdapterMetadata<'tokenStandard'> & {
    families: readonly TokenStandardFamilyDescriptor[]
  }
}

export function createTokenStandardAdapter(options: TokenStandardAdapterOptions): TokenStandardAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    profile: options.profile,
    service: 'tokenStandard',
    sourceIds: Object.values(TOKEN_STANDARD_FAMILY_SOURCES),
    token: options.token,
    warnings: [
      'Token Standard adapters are transport-only until the corresponding specs are synced into src/generated.',
    ],
  })

  const familyDescriptors = Object.entries(TOKEN_STANDARD_FAMILY_SOURCES).map(
    ([family, sourceId]) => ({
      family: family as TokenStandardFamily,
      sourceId,
    }),
  )

  function createFamilyClient(
    family: TokenStandardFamily,
    sourceId: (typeof TOKEN_STANDARD_FAMILY_SOURCES)[TokenStandardFamily],
  ): TokenStandardFamilyClient {
    return {
      family,

      async requestJson<T>(request: TokenStandardFamilyRequest) {
        return transport.requestJson<T>({
          body: request.body,
          bodyContentType: request.bodyContentType,
          method: request.method,
          path: request.path,
          query: request.query,
          signal: request.signal,
        })
      },

      async requestOptionalJson<T>(request: TokenStandardFamilyRequest) {
        return transport.requestOptionalJson<T>({
          body: request.body,
          bodyContentType: request.bodyContentType,
          method: request.method,
          path: request.path,
          query: request.query,
          signal: request.signal,
        })
      },

      sourceId,
    }
  }

  return {
    families: {
      allocation: createFamilyClient('allocation', TOKEN_STANDARD_FAMILY_SOURCES.allocation),
      allocationInstruction: createFamilyClient(
        'allocationInstruction',
        TOKEN_STANDARD_FAMILY_SOURCES.allocationInstruction,
      ),
      metadata: createFamilyClient('metadata', TOKEN_STANDARD_FAMILY_SOURCES.metadata),
      transferInstruction: createFamilyClient(
        'transferInstruction',
        TOKEN_STANDARD_FAMILY_SOURCES.transferInstruction,
      ),
    },
    metadata: {
      ...transport.metadata,
      families: familyDescriptors,
    },
  }
}
