import {createScanAdapter, type ScanAdapter} from '../adapters/scan.js'
import {CantonctlError} from '../errors.js'
import type {CantonctlConfig} from '../config.js'
import {type ProfileRuntimeResolver, createProfileRuntimeResolver} from '../profile-runtime.js'

export interface DiagnosticsSnapshot {
  auth: {
    envVarName: string
    mode: string
    source: string
  }
  compatibility: {
    failed: number
    passed: number
    warned: number
  }
  health: Array<{
    detail: string
    endpoint: string
    name: string
    status: 'auth-required' | 'healthy' | 'not-exposed' | 'unreachable'
  }>
  metrics: Array<{
    detail: string
    endpoint: string
    service: 'auth' | 'scan' | 'validator'
    status: 'auth-required' | 'available' | 'not-exposed' | 'unreachable'
  }>
  profile: {
    experimental: boolean
    kind: string
    name: string
    network: string
  }
  services: Array<{
    endpoint?: string
    name: string
    stability: string
  }>
  validatorLiveness?: {
    approvedValidatorCount: number
    endpoint: string
    sampleSize: number
  }
}

export interface DiagnosticsCollectorDeps {
  createProfileRuntimeResolver?: () => ProfileRuntimeResolver
  createScanAdapter?: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
  fetch?: typeof globalThis.fetch
}

export interface DiagnosticsCollector {
  collect(options: {config: CantonctlConfig; profileName?: string; signal?: AbortSignal}): Promise<DiagnosticsSnapshot>
}

export function createDiagnosticsCollector(deps: DiagnosticsCollectorDeps = {}): DiagnosticsCollector {
  const resolveRuntime = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver())
  const createScan = deps.createScanAdapter ?? createScanAdapter
  const fetchFn = deps.fetch ?? globalThis.fetch

  return {
    async collect(options) {
      const runtime = await resolveRuntime().resolve({
        config: options.config,
        profileName: options.profileName,
      })

      return {
        auth: {
          envVarName: runtime.auth.envVarName,
          mode: runtime.auth.mode,
          source: runtime.credential.source,
        },
        compatibility: {
          failed: runtime.compatibility.failed,
          passed: runtime.compatibility.passed,
          warned: runtime.compatibility.warned,
        },
        health: await collectHealth({
          fetch: fetchFn,
          profile: runtime.profile,
          signal: options.signal,
          token: runtime.credential.token,
        }),
        metrics: await collectMetrics({
          fetch: fetchFn,
          profile: runtime.profile,
          signal: options.signal,
          token: runtime.credential.token,
        }),
        profile: {
          experimental: runtime.profile.experimental,
          kind: runtime.profile.kind,
          name: runtime.profile.name,
          network: runtime.networkName,
        },
        services: runtime.compatibility.services.map(service => ({
          endpoint: service.endpoint,
          name: service.name,
          stability: service.stability,
        })),
        validatorLiveness: runtime.profile.services.scan?.url
          ? await collectValidatorLiveness({
            createScan,
            runtime,
            signal: options.signal,
          })
          : undefined,
      }
    },
  }
}

async function collectHealth(options: {
  fetch: typeof globalThis.fetch
  profile: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>['profile']
  signal?: AbortSignal
  token?: string
}): Promise<DiagnosticsSnapshot['health']> {
  const checks: DiagnosticsSnapshot['health'] = []

  for (const [name, baseUrl] of [
    ['auth', options.profile.services.auth?.url ?? options.profile.services.auth?.issuer],
    ['scan', options.profile.services.scan?.url],
    ['validator', options.profile.services.validator?.url],
  ] as const) {
    if (!baseUrl) continue

    for (const suffix of ['readyz', 'livez'] as const) {
      const endpoint = joinPath(baseUrl, suffix)

      try {
        const response = await options.fetch(endpoint, {
          headers: options.token ? {Authorization: `Bearer ${options.token}`} : undefined,
          method: 'GET',
          signal: options.signal,
        })
        checks.push({
          detail: response.status === 404
            ? 'Endpoint not exposed.'
            : response.status === 401 || response.status === 403
              ? `HTTP ${response.status}`
              : response.ok
                ? 'Healthy.'
                : `HTTP ${response.status}`,
          endpoint,
          name: `${name}-${suffix}`,
          status: response.status === 404
            ? 'not-exposed'
            : response.status === 401 || response.status === 403
              ? 'auth-required'
              : response.ok
                ? 'healthy'
                : 'unreachable',
        })
      } catch (error) {
        checks.push({
          detail: error instanceof Error ? error.message : 'Request failed',
          endpoint,
          name: `${name}-${suffix}`,
          status: 'unreachable',
        })
      }
    }
  }

  return checks
}

async function collectMetrics(options: {
  fetch: typeof globalThis.fetch
  profile: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>['profile']
  signal?: AbortSignal
  token?: string
}): Promise<DiagnosticsSnapshot['metrics']> {
  const metrics: DiagnosticsSnapshot['metrics'] = []

  for (const [service, baseUrl] of [
    ['auth', options.profile.services.auth?.url ?? options.profile.services.auth?.issuer],
    ['scan', options.profile.services.scan?.url],
    ['validator', options.profile.services.validator?.url],
  ] as const) {
    if (!baseUrl) continue

    const endpoint = joinPath(baseUrl, 'metrics')

    try {
      const response = await options.fetch(endpoint, {
        headers: options.token ? {Authorization: `Bearer ${options.token}`} : undefined,
        method: 'GET',
        signal: options.signal,
      })

      metrics.push({
        detail: response.status === 404
          ? 'Metrics endpoint not exposed.'
          : response.status === 401 || response.status === 403
            ? `HTTP ${response.status}`
            : response.ok
              ? 'Metrics endpoint reachable.'
              : `HTTP ${response.status}`,
        endpoint,
        service,
        status: response.status === 404
          ? 'not-exposed'
          : response.status === 401 || response.status === 403
            ? 'auth-required'
            : response.ok
              ? 'available'
              : 'unreachable',
      })
    } catch (error) {
      metrics.push({
        detail: error instanceof Error ? error.message : 'Request failed',
        endpoint,
        service,
        status: 'unreachable',
      })
    }
  }

  return metrics
}

async function collectValidatorLiveness(options: {
  createScan: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
  runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
  signal?: AbortSignal
}): Promise<DiagnosticsSnapshot['validatorLiveness'] | undefined> {
  const scan = options.createScan({
    profile: options.runtime.profileContext,
    token: options.runtime.credential.token,
  })

  try {
    const response = await scan.listValidatorLicenses({limit: 10}, options.signal)
    const licenses = Array.isArray((response as Record<string, unknown>).validator_licenses)
      ? (response as Record<string, unknown>).validator_licenses as unknown[]
      : []
    return {
      approvedValidatorCount: licenses.length,
      endpoint: scan.metadata.baseUrl,
      sampleSize: licenses.length,
    }
  } catch (error) {
    if (error instanceof CantonctlError) {
      return {
        approvedValidatorCount: 0,
        endpoint: scan.metadata.baseUrl,
        sampleSize: 0,
      }
    }

    throw error
  }
}

function joinPath(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl)
  url.pathname = url.pathname.replace(/\/+$/, '') + `/${suffix}`
  return url.toString()
}

