import type {NormalizedProfile, ProfileKind} from '../config-profile.js'
import {CantonctlError, ErrorCode} from '../errors.js'
import {getUpstreamSource, type UpstreamSource, type UpstreamSourceId} from '../upstream/manifest.js'

export type AdapterFetchFn = typeof globalThis.fetch
export type AdapterHttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
export type StableAdapterServiceName = 'ledger' | 'scan' | 'scanProxy' | 'tokenStandard' | 'ans'
export type AdapterServiceName = StableAdapterServiceName | 'validator'

export type AdapterQueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean | null | undefined)[]

export interface AdapterProfileContext {
  experimental: boolean
  kind: ProfileKind
  name: string
  services: NormalizedProfile['services']
}

export interface AdapterMetadata<TService extends AdapterServiceName = AdapterServiceName> {
  baseUrl: string
  profile?: Pick<AdapterProfileContext, 'experimental' | 'kind' | 'name'>
  service: TService
  upstream: readonly UpstreamSource[]
  upstreamSourceIds: readonly UpstreamSourceId[]
  warnings: readonly string[]
}

export interface AdapterRequestBase {
  body?: unknown
  bodyContentType?: string
  headers?: Record<string, string>
  path: string
  query?: Record<string, AdapterQueryValue>
  signal?: AbortSignal
}

export interface AdapterRequestOptions extends AdapterRequestBase {
  errorCodes?: Partial<AdapterErrorCodes>
  method: AdapterHttpMethod
}

export interface AdapterTransport<TService extends AdapterServiceName = AdapterServiceName> {
  metadata: AdapterMetadata<TService>
  requestJson<T>(request: AdapterRequestOptions): Promise<T>
  requestOptionalJson<T>(request: AdapterRequestOptions): Promise<T | null>
  requestText(request: AdapterRequestOptions): Promise<string>
  requestVoid(request: AdapterRequestOptions): Promise<void>
}

interface AdapterErrorCodes {
  auth: ErrorCode
  connection: ErrorCode
  request: ErrorCode
}

interface CreateAdapterTransportOptions<TService extends AdapterServiceName> {
  baseUrl?: string
  errorCodes?: Partial<AdapterErrorCodes>
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  service: TService
  sourceIds: readonly UpstreamSourceId[]
  token?: string
  warnings?: readonly string[]
}

const DEFAULT_ERROR_CODES: AdapterErrorCodes = {
  auth: ErrorCode.SERVICE_AUTH_FAILED,
  connection: ErrorCode.SERVICE_CONNECTION_FAILED,
  request: ErrorCode.SERVICE_REQUEST_FAILED,
}

export function createAdapterTransport<TService extends AdapterServiceName>(
  options: CreateAdapterTransportOptions<TService>,
): AdapterTransport<TService> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const baseUrl = resolveServiceBaseUrl(options.service, options.baseUrl, options.profile)
  const upstream = options.sourceIds.map(getUpstreamSource)
  const metadata: AdapterMetadata<TService> = {
    baseUrl,
    profile: options.profile ? {
      experimental: options.profile.experimental,
      kind: options.profile.kind,
      name: options.profile.name,
    } : undefined,
    service: options.service,
    upstream,
    upstreamSourceIds: options.sourceIds,
    warnings: buildWarnings({
      customWarnings: options.warnings,
      profile: options.profile,
      service: options.service,
      upstream,
    }),
  }

  async function request(
    requestOptions: AdapterRequestOptions,
    responseType: 'json' | 'text' | 'void',
    allow404: boolean,
  ): Promise<unknown> {
    const errorCodes = {
      ...DEFAULT_ERROR_CODES,
      ...options.errorCodes,
      ...requestOptions.errorCodes,
    }
    const url = buildRequestUrl(baseUrl, requestOptions.path, requestOptions.query)
    const headers: Record<string, string> = {...requestOptions.headers}
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`
    }

    const init: RequestInit = {
      headers,
      method: requestOptions.method,
      signal: requestOptions.signal,
    }

    if (requestOptions.body instanceof Uint8Array) {
      headers['Content-Type'] = requestOptions.bodyContentType ?? 'application/octet-stream'
      init.body = requestOptions.body as unknown as BodyInit
    } else if (requestOptions.body !== undefined) {
      const contentType = requestOptions.bodyContentType ?? 'application/json'
      headers['Content-Type'] = contentType
      init.body = contentType === 'application/json'
        ? JSON.stringify(requestOptions.body)
        : String(requestOptions.body)
    }

    let response: Response
    try {
      response = await fetchFn(url, init)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }

      throw new CantonctlError(errorCodes.connection, {
        cause: err instanceof Error ? err : undefined,
        context: {service: options.service, url},
        suggestion: `Cannot connect to ${baseUrl}. Check the configured ${options.service} service endpoint.`,
      })
    }

    if (allow404 && response.status === 404) {
      return null
    }

    if (response.status === 401 || response.status === 403) {
      throw new CantonctlError(errorCodes.auth, {
        context: {service: options.service, status: response.status, url},
        suggestion: `Authentication failed for ${options.service}. Refresh credentials for ${baseUrl}.`,
      })
    }

    if (!response.ok) {
      const body = await safeReadText(response)
      throw new CantonctlError(errorCodes.request, {
        context: {body, service: options.service, status: response.status, url},
        suggestion: `The ${options.service} service returned HTTP ${response.status}. Check the request payload and service logs.`,
      })
    }

    if (responseType === 'void') {
      return undefined
    }

    if (responseType === 'text') {
      return response.text()
    }

    return parseJsonResponse(response, url, errorCodes.request)
  }

  return {
    metadata,

    async requestJson<T>(requestOptions: AdapterRequestOptions) {
      return request(requestOptions, 'json', false) as Promise<T>
    },

    async requestOptionalJson<T>(requestOptions: AdapterRequestOptions) {
      return request(requestOptions, 'json', true) as Promise<T | null>
    },

    async requestText(requestOptions: AdapterRequestOptions) {
      return request(requestOptions, 'text', false) as Promise<string>
    },

    async requestVoid(requestOptions: AdapterRequestOptions) {
      await request(requestOptions, 'void', false)
    },
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readArray(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key]
  return Array.isArray(value) ? value : undefined
}

export function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

export function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function buildWarnings(options: {
  customWarnings?: readonly string[]
  profile?: AdapterProfileContext
  service: AdapterServiceName
  upstream: readonly UpstreamSource[]
}): string[] {
  const warnings = new Set<string>(options.customWarnings ?? [])

  for (const source of options.upstream) {
    if (source.stability !== 'stable-external') {
      warnings.add(
        `${source.name} is marked ${source.stability} upstream; keep ${options.service} callers tolerant because this surface is not GA.`,
      )
    }
  }

  if (
    options.service === 'scanProxy'
    && options.profile
    && options.profile.experimental !== true
  ) {
    warnings.add(
      `Profile "${options.profile.name}" exposes scanProxy while experimental=false; prefer public scan and ANS surfaces when possible.`,
    )
  }

  return [...warnings]
}

function buildRequestUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, AdapterQueryValue>,
): string {
  const url = new URL(normalizeRequestPath(path), `${baseUrl}/`)
  if (query) {
    for (const [key, rawValue] of Object.entries(query)) {
      appendQueryValue(url.searchParams, key, rawValue)
    }
  }

  return url.toString()
}

function appendQueryValue(params: URLSearchParams, key: string, value: AdapterQueryValue): void {
  if (value === undefined || value === null) return

  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(params, key, item)
    }
    return
  }

  params.append(key, String(value))
}

async function parseJsonResponse<T>(
  response: Response,
  url: string,
  errorCode: ErrorCode,
): Promise<T> {
  const body = await safeReadText(response)
  if (!body.trim()) {
    return {} as T
  }

  try {
    return JSON.parse(body) as T
  } catch (err) {
    throw new CantonctlError(errorCode, {
      cause: err instanceof Error ? err : undefined,
      context: {body, status: response.status, url},
      suggestion: `Expected JSON from ${url} but received an invalid payload.`,
    })
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return `HTTP ${response.status}`
  }
}

function normalizeRequestPath(path: string): string {
  if (path.startsWith('/')) return path
  return `/${path}`
}

function resolveServiceBaseUrl(
  service: AdapterServiceName,
  explicitBaseUrl?: string,
  profile?: AdapterProfileContext,
): string {
  if (explicitBaseUrl) {
    return trimTrailingSlash(explicitBaseUrl)
  }

  if (!profile) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {service},
      suggestion: `Provide a baseUrl or a profile that configures the ${service} service.`,
    })
  }

  switch (service) {
    case 'ledger': {
      const ledger = profile.services.ledger
      if (!ledger) {
        throw missingServiceError(profile.name, service)
      }

      if (ledger.url) {
        return trimTrailingSlash(ledger.url)
      }

      const jsonApiPort = ledger['json-api-port'] ?? 7575
      return `http://localhost:${jsonApiPort}`
    }

    case 'ans':
    case 'scan':
    case 'scanProxy':
    case 'tokenStandard':
    case 'validator': {
      const configured = profile.services[service]
      if (!configured?.url) {
        throw missingServiceError(profile.name, service)
      }

      return trimTrailingSlash(configured.url)
    }
  }
}

function missingServiceError(profileName: string, service: AdapterServiceName): CantonctlError {
  return new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
    context: {profile: profileName, service},
    suggestion: `Add profiles.${profileName}.${service}.url to cantonctl.yaml or pass an explicit baseUrl.`,
  })
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
