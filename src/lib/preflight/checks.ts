import {createScanAdapter, type ScanAdapter, type ScanAdapterOptions} from '../adapters/scan.js'
import type {CantonctlConfig} from '../config.js'
import {createControlPlaneDriftReport} from '../control-plane-drift.js'
import {CantonctlError, ErrorCode} from '../errors.js'
import {type ProfileRuntimeResolver, createProfileRuntimeResolver} from '../profile-runtime.js'
import {createPreflightRolloutContract} from '../rollout-contract.js'
import {type PreflightCheck, type PreflightReport, summarizePreflightDetail} from './output.js'
import {resolveNetworkPolicy, type NetworkPolicy} from './network-policy.js'

export interface PreflightDeps {
  createProfileRuntimeResolver?: () => ProfileRuntimeResolver
  createScanAdapter?: (options: ScanAdapterOptions) => ScanAdapter
  fetch?: typeof globalThis.fetch
  lookupEgressIp?: (options: {fetch: typeof globalThis.fetch; signal?: AbortSignal}) => Promise<string | undefined>
}

export interface PreflightRunner {
  run(options: {config: CantonctlConfig; profileName?: string; signal?: AbortSignal}): Promise<PreflightReport>
}

export function createPreflightChecks(deps: PreflightDeps = {}): PreflightRunner {
  const resolveRuntime = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver())
  const createScan = deps.createScanAdapter ?? createScanAdapter
  const fetchFn = deps.fetch ?? globalThis.fetch
  const lookupEgressIp = deps.lookupEgressIp ?? defaultLookupEgressIp

  return {
    async run(options) {
      const runtime = await resolveRuntime().resolve({
        config: options.config,
        profileName: options.profileName,
      })
      const policy = resolveNetworkPolicy({
        networkName: runtime.networkName,
        profile: runtime.profile,
      })
      const checks: PreflightCheck[] = []

      checks.push({
        category: 'profile',
        detail: summarizePreflightDetail(runtime),
        name: 'Profile resolution',
        status: runtime.profile.experimental ? 'warn' : 'pass',
      })

      checks.push({
        category: 'profile',
        detail: runtime.compatibility.failed === 0
          ? runtime.compatibility.warned === 0
            ? 'Compatibility baseline matches the pinned stable/public expectations.'
            : `Compatibility baseline passed with ${runtime.compatibility.warned} warning(s).`
          : `${runtime.compatibility.failed} compatibility check(s) failed.`,
        name: 'Compatibility baseline',
        status: runtime.compatibility.failed > 0 ? 'fail' : runtime.compatibility.warned > 0 ? 'warn' : 'pass',
      })

      checks.push({
        category: 'auth',
        detail: `${runtime.auth.description} ${runtime.auth.envVarName}`,
        name: 'Auth mode',
        status: runtime.auth.experimental ? 'warn' : 'pass',
      })

      checks.push({
        category: 'auth',
        detail: buildCredentialDetail(runtime),
        name: 'App credential material',
        status: runtime.credential.source === 'missing' ? 'fail' : 'pass',
      })

      checks.push({
        category: 'auth',
        detail: buildOperatorCredentialDetail(runtime),
        name: 'Operator credential material',
        status: runtime.auth.operator.required && runtime.operatorCredential.source === 'missing' ? 'fail' : 'pass',
      })

      checks.push(await scanReachabilityCheck({
        createScan,
        runtime,
        signal: options.signal,
      }))

      const egressIp = await lookupEgressIp({fetch: fetchFn, signal: options.signal})
      checks.push({
        category: 'egress',
        detail: egressIp
          ? `Visible as ${egressIp}. Reconfirm allowlisting with the target operator.`
          : 'Could not determine egress IP visibility from this host.',
        name: 'Egress IP visibility',
        status: egressIp ? 'pass' : 'warn',
      })

      checks.push(...await runOptionalHealthChecks({
        fetch: fetchFn,
        policy,
        runtime,
        signal: options.signal,
      }))

      const success = checks.every(check => check.status !== 'fail')
      const driftReport = createControlPlaneDriftReport({
        checks,
        inventory: runtime.inventory,
        runtime,
      })
      const rollout = createPreflightRolloutContract({
        checks,
        profile: {
          experimental: runtime.profile.experimental,
          kind: runtime.profile.kind,
          name: runtime.profile.name,
        },
        reconcile: driftReport.reconcile,
      })

      return {
        auth: {
          app: {
            credentialSource: runtime.credential.source,
            envVarName: runtime.auth.app.envVarName,
            required: runtime.auth.app.required,
          },
          credentialSource: runtime.credential.source,
          envVarName: runtime.auth.envVarName,
          mode: runtime.auth.mode,
          operator: {
            credentialSource: runtime.operatorCredential.source,
            description: runtime.auth.operator.description,
            envVarName: runtime.auth.operator.envVarName,
            prerequisites: runtime.auth.operator.prerequisites,
            required: runtime.auth.operator.required,
          },
          warnings: runtime.auth.warnings,
        },
        checks,
        compatibility: {
          failed: runtime.compatibility.failed,
          passed: runtime.compatibility.passed,
          warned: runtime.compatibility.warned,
        },
        drift: driftReport.items,
        egressIp,
        inventory: runtime.inventory,
        network: {
          checklist: policy.checklist,
          name: runtime.networkName,
          reminders: policy.reminders,
          resetExpectation: policy.resetExpectation,
          tier: policy.tier,
        },
        profile: {
          experimental: runtime.profile.experimental,
          kind: runtime.profile.kind,
          name: runtime.profile.name,
        },
        reconcile: driftReport.reconcile,
        rollout,
        success,
      }
    },
  }
}

async function scanReachabilityCheck(options: {
  createScan: (opts: ScanAdapterOptions) => ScanAdapter
  runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
  signal?: AbortSignal
}): Promise<PreflightCheck> {
  if (!options.runtime.profile.services.scan?.url) {
    if (
      options.runtime.profile.kind === 'sandbox'
      || options.runtime.profile.kind === 'canton-multi'
      || options.runtime.profile.kind === 'splice-localnet'
    ) {
      return {
        category: 'scan',
        detail: 'No stable/public scan endpoint configured for this local profile.',
        name: 'Scan reachability',
        status: 'skip',
      }
    }

    return {
      category: 'scan',
      detail: 'A stable/public scan endpoint is required for the default preflight path.',
      name: 'Scan reachability',
      status: 'fail',
    }
  }

  const scan = options.createScan({
    profile: options.runtime.profileContext,
    token: options.runtime.credential.token,
  })

  try {
    await scan.getDsoInfo(options.signal)
    return {
      category: 'scan',
      detail: `Reachable via ${scan.metadata.baseUrl}`,
      endpoint: scan.metadata.baseUrl,
      name: 'Scan reachability',
      status: 'pass',
    }
  } catch (error) {
    if (error instanceof CantonctlError) {
      return {
        category: 'scan',
        detail: error.message,
        endpoint: scan.metadata.baseUrl,
        name: 'Scan reachability',
        status: error.code === ErrorCode.SERVICE_AUTH_FAILED ? 'fail' : 'fail',
      }
    }

    throw error
  }
}

async function runOptionalHealthChecks(options: {
  fetch: typeof globalThis.fetch
  policy: NetworkPolicy
  runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
  signal?: AbortSignal
}): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = []
  const healthServices = [
    {baseUrl: options.runtime.profile.services.auth?.url ?? options.runtime.profile.services.auth?.issuer, name: 'Auth'},
    {baseUrl: options.runtime.profile.services.scan?.url, name: 'Scan'},
    {baseUrl: options.runtime.profile.services.validator?.url, name: 'Validator'},
  ]

  for (const service of healthServices) {
    if (!service.baseUrl || options.policy.tier === 'local') {
      continue
    }

    for (const kind of ['readyz', 'livez'] as const) {
      checks.push(await probeHealthEndpoint({
        baseUrl: service.baseUrl,
        fetch: options.fetch,
        name: `${service.name} ${kind}`,
        signal: options.signal,
        token: options.runtime.credential.token,
      }))
    }
  }

  return checks
}

async function probeHealthEndpoint(options: {
  baseUrl: string
  fetch: typeof globalThis.fetch
  name: string
  signal?: AbortSignal
  token?: string
}): Promise<PreflightCheck> {
  const endpoint = new URL(options.baseUrl)
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + `/${options.name.toLowerCase().endsWith('readyz') ? 'readyz' : 'livez'}`

  try {
    const response = await options.fetch(endpoint.toString(), {
      headers: options.token ? {Authorization: `Bearer ${options.token}`} : undefined,
      method: 'GET',
      signal: options.signal,
    })

    if (response.status === 404) {
      return {
        category: 'health',
        detail: 'Endpoint not exposed by this service.',
        endpoint: endpoint.toString(),
        name: options.name,
        status: 'skip',
      }
    }

    if (response.status === 401 || response.status === 403) {
      return {
        category: 'health',
        detail: `Health endpoint requires auth (HTTP ${response.status}).`,
        endpoint: endpoint.toString(),
        name: options.name,
        status: 'warn',
      }
    }

    return {
      category: 'health',
      detail: response.ok ? 'Healthy.' : `HTTP ${response.status}`,
      endpoint: endpoint.toString(),
      name: options.name,
      status: response.ok ? 'pass' : response.status >= 500 ? 'warn' : 'warn',
    }
  } catch (error) {
    return {
      category: 'health',
      detail: error instanceof Error ? error.message : 'Request failed',
      endpoint: endpoint.toString(),
      name: options.name,
      status: 'warn',
    }
  }
}

function buildCredentialDetail(runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>): string {
  if (runtime.credential.source === 'missing') {
    return (
      `No token available for ${runtime.networkName}. ` +
      `Set ${runtime.auth.app.envVarName} or store a credential with cantonctl auth login.`
    )
  }

  return `${runtime.credential.source} credentials ready for ${runtime.networkName}.`
}

function buildOperatorCredentialDetail(runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>): string {
  if (!runtime.auth.operator.required) {
    return runtime.auth.operator.description
  }

  if (runtime.operatorCredential.source === 'missing') {
    return (
      `No operator credential available for ${runtime.networkName}. ` +
      `Set ${runtime.auth.operator.envVarName} or store a credential with cantonctl auth login ${runtime.networkName} --scope operator.`
    )
  }

  return `${runtime.operatorCredential.source} operator credentials ready for ${runtime.networkName}.`
}

async function defaultLookupEgressIp(options: {
  fetch: typeof globalThis.fetch
  signal?: AbortSignal
}): Promise<string | undefined> {
  try {
    const response = await options.fetch('https://api.ipify.org?format=json', {
      method: 'GET',
      signal: options.signal,
    })

    if (!response.ok) {
      return undefined
    }

    const body = await response.json() as {ip?: unknown}
    return typeof body.ip === 'string' ? body.ip : undefined
  } catch {
    return undefined
  }
}
