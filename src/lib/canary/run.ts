import {createAnsAdapter, type AnsAdapter} from '../adapters/ans.js'
import {createScanAdapter, type ScanAdapter} from '../adapters/scan.js'
import {createTokenStandardAdapter, type TokenStandardAdapter} from '../adapters/token-standard.js'
import {createValidatorUserAdapter, type ValidatorUserAdapter} from '../adapters/validator-user.js'
import type {CantonctlConfig} from '../config.js'
import type {NormalizedProfile} from '../config-profile.js'
import {CantonctlError} from '../errors.js'
import {type ProfileRuntimeResolver, createProfileRuntimeResolver} from '../profile-runtime.js'

export const STABLE_PUBLIC_CANARY_SUITES = [
  'scan',
  'ans',
  'token-standard',
  'validator-user',
] as const

export type StablePublicCanarySuite = typeof STABLE_PUBLIC_CANARY_SUITES[number]

export interface CanaryCheck {
  detail: string
  endpoint?: string
  status: 'fail' | 'pass'
  suite: StablePublicCanarySuite
  warnings: string[]
}

export interface CanaryReport {
  checks: CanaryCheck[]
  profile: {
    kind: string
    name: string
  }
  success: boolean
}

export interface CanaryRunner {
  run(options: {
    config: CantonctlConfig
    profileName?: string
    signal?: AbortSignal
    suites?: StablePublicCanarySuite[]
  }): Promise<CanaryReport>
}

export function selectStablePublicCanarySuites(profile: Pick<NormalizedProfile, 'services'>): StablePublicCanarySuite[] {
  const suites: StablePublicCanarySuite[] = []

  if (profile.services.scan?.url) {
    suites.push('scan')
  }

  if (profile.services.ans?.url || profile.services.scan?.url) {
    suites.push('ans')
  }

  if (profile.services.tokenStandard?.url) {
    suites.push('token-standard')
  }

  if (profile.services.validator?.url) {
    suites.push('validator-user')
  }

  return suites
}

export function createCanaryRunner(
  deps: {
    createAnsAdapter?: (options: Parameters<typeof createAnsAdapter>[0]) => AnsAdapter
    createProfileRuntimeResolver?: () => ProfileRuntimeResolver
    createScanAdapter?: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
    createTokenStandardAdapter?: (options: Parameters<typeof createTokenStandardAdapter>[0]) => TokenStandardAdapter
    createValidatorUserAdapter?: (options: Parameters<typeof createValidatorUserAdapter>[0]) => ValidatorUserAdapter
  } = {},
): CanaryRunner {
  const createAns = deps.createAnsAdapter ?? createAnsAdapter
  const resolveRuntime = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver())
  const createScan = deps.createScanAdapter ?? createScanAdapter
  const createTokenStandard = deps.createTokenStandardAdapter ?? createTokenStandardAdapter
  const createValidatorUser = deps.createValidatorUserAdapter ?? createValidatorUserAdapter

  return {
    async run(options) {
      const runtime = await resolveRuntime().resolve({
        config: options.config,
        profileName: options.profileName,
      })
      const suites = options.suites?.length ? options.suites : [...STABLE_PUBLIC_CANARY_SUITES]
      const checks: CanaryCheck[] = []

      for (const suite of suites) {
        switch (suite) {
          case 'scan':
            checks.push(await runScanCanary({createScan, runtime, signal: options.signal}))
            break
          case 'ans':
            checks.push(await runAnsCanary({createAns, createScan, runtime, signal: options.signal}))
            break
          case 'token-standard':
            checks.push(await runTokenStandardCanary({createTokenStandard, runtime, signal: options.signal}))
            break
          case 'validator-user':
            checks.push(await runValidatorUserCanary({createValidatorUser, runtime, signal: options.signal}))
            break
        }
      }

      return {
        checks,
        profile: {
          kind: runtime.profile.kind,
          name: runtime.profile.name,
        },
        success: checks.every(check => check.status === 'pass'),
      }
    },
  }
}

async function runScanCanary(options: {
  createScan: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
  runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
  signal?: AbortSignal
}): Promise<CanaryCheck> {
  if (!options.runtime.profile.services.scan?.url) {
    return {detail: 'Scan endpoint is not configured.', status: 'fail', suite: 'scan', warnings: []}
  }

  const scan = options.createScan({
    profile: options.runtime.profileContext,
    token: options.runtime.credential.token,
  })

  try {
    await scan.getDsoInfo(options.signal)
    return {
      detail: 'Stable/public scan endpoint reachable.',
      endpoint: scan.metadata.baseUrl,
      status: 'pass',
      suite: 'scan',
      warnings: [...scan.metadata.warnings],
    }
  } catch (error) {
    return failCheck('scan', error, scan.metadata.baseUrl, scan.metadata.warnings)
  }
}

async function runAnsCanary(options: {
  createAns: (options: Parameters<typeof createAnsAdapter>[0]) => AnsAdapter
  createScan: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
  runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
  signal?: AbortSignal
}): Promise<CanaryCheck> {
  if (options.runtime.profile.services.ans?.url) {
    const ans = options.createAns({
      profile: options.runtime.profileContext,
      token: options.runtime.credential.token,
    })
    try {
      await ans.listEntries(options.signal)
      return {
        detail: 'Stable/public ANS endpoint reachable.',
        endpoint: ans.metadata.baseUrl,
        status: 'pass',
        suite: 'ans',
        warnings: [...ans.metadata.warnings],
      }
    } catch (error) {
      return failCheck('ans', error, ans.metadata.baseUrl, ans.metadata.warnings)
    }
  }

  if (!options.runtime.profile.services.scan?.url) {
    return {detail: 'ANS and scan endpoints are not configured.', status: 'fail', suite: 'ans', warnings: []}
  }

  const scan = options.createScan({
    profile: options.runtime.profileContext,
    token: options.runtime.credential.token,
  })

  try {
    await scan.listAnsEntries({pageSize: 1}, options.signal)
    return {
      detail: 'Stable/public ANS data reachable through scan.',
      endpoint: scan.metadata.baseUrl,
      status: 'pass',
      suite: 'ans',
      warnings: [...scan.metadata.warnings],
    }
  } catch (error) {
    return failCheck('ans', error, scan.metadata.baseUrl, scan.metadata.warnings)
  }
}

async function runTokenStandardCanary(options: {
  createTokenStandard: (options: Parameters<typeof createTokenStandardAdapter>[0]) => TokenStandardAdapter
  runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
  signal?: AbortSignal
}): Promise<CanaryCheck> {
  if (!options.runtime.profile.services.tokenStandard?.url) {
    return {detail: 'Token Standard endpoint is not configured.', status: 'fail', suite: 'token-standard', warnings: []}
  }

  const tokenStandard = options.createTokenStandard({
    profile: options.runtime.profileContext,
    token: options.runtime.credential.token,
  })

  try {
    await tokenStandard.families.metadata.requestJson<{tokens?: unknown[]}>({
      method: 'GET',
      path: '/v1/tokens',
      signal: options.signal,
    })
    return {
      detail: 'Stable/public token metadata endpoint reachable.',
      endpoint: tokenStandard.metadata.baseUrl,
      status: 'pass',
      suite: 'token-standard',
      warnings: [...tokenStandard.metadata.warnings],
    }
  } catch (error) {
    return failCheck('token-standard', error, tokenStandard.metadata.baseUrl, tokenStandard.metadata.warnings)
  }
}

async function runValidatorUserCanary(options: {
  createValidatorUser: (options: Parameters<typeof createValidatorUserAdapter>[0]) => ValidatorUserAdapter
  runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
  signal?: AbortSignal
}): Promise<CanaryCheck> {
  if (!options.runtime.profile.services.validator?.url) {
    return {detail: 'Validator-user endpoint is not configured.', status: 'fail', suite: 'validator-user', warnings: []}
  }

  if (!options.runtime.credential.token) {
    return {
      detail: `No token available for validator-user checks. Set ${options.runtime.auth.envVarName} first.`,
      status: 'fail',
      suite: 'validator-user',
      warnings: [],
    }
  }

  const validatorUser = options.createValidatorUser({
    profile: options.runtime.profileContext,
    token: options.runtime.credential.token,
  })

  try {
    await validatorUser.getBuyTrafficRequestStatus('cantonctl-canary', options.signal)
    return {
      detail: 'Stable/public validator-user endpoint reachable.',
      endpoint: validatorUser.metadata.baseUrl,
      status: 'pass',
      suite: 'validator-user',
      warnings: [...validatorUser.metadata.warnings],
    }
  } catch (error) {
    return failCheck('validator-user', error, validatorUser.metadata.baseUrl, validatorUser.metadata.warnings)
  }
}

function failCheck(
  suite: StablePublicCanarySuite,
  error: unknown,
  endpoint?: string,
  warnings: readonly string[] = [],
): CanaryCheck {
  return {
    detail: error instanceof CantonctlError ? error.message : error instanceof Error ? error.message : 'Request failed',
    endpoint,
    status: 'fail',
    suite,
    warnings: [...warnings],
  }
}
