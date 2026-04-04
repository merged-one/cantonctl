import type {CantonctlConfig} from '../config.js'
import type {ServiceName} from '../config-profile.js'
import {type ProfileRuntimeResolver, createProfileRuntimeResolver} from '../profile-runtime.js'
import {resolveNetworkPolicy} from '../preflight/network-policy.js'

export type LifecycleSeverity = 'fail' | 'info' | 'warn'

export interface LifecycleAdvisory {
  code:
    | 'auth-material'
    | 'experimental-target'
    | 'migration-policy'
    | 'network-tier'
    | 'reset-sensitive'
    | 'scan-missing'
    | 'sponsor-reminder'
    | 'version-line'
  message: string
  severity: LifecycleSeverity
}

export interface ServiceDiff {
  change: 'added' | 'changed' | 'removed' | 'unchanged'
  from?: string
  name: ServiceName
  to?: string
}

export interface PromoteDiffReport {
  advisories: LifecycleAdvisory[]
  from: {
    experimental: boolean
    kind: string
    name: string
    network: string
    tier: string
  }
  services: ServiceDiff[]
  success: boolean
  summary: {failed: number; info: number; warned: number}
  to: {
    experimental: boolean
    kind: string
    name: string
    network: string
    tier: string
  }
}

export interface LifecycleDiffDeps {
  createProfileRuntimeResolver?: () => ProfileRuntimeResolver
}

export interface LifecycleDiff {
  compare(options: {
    config: CantonctlConfig
    fromProfile: string
    toProfile: string
  }): Promise<PromoteDiffReport>
}

const SERVICE_NAMES: ServiceName[] = [
  'ledger',
  'scan',
  'scanProxy',
  'validator',
  'tokenStandard',
  'ans',
  'auth',
  'localnet',
]

export function createLifecycleDiff(deps: LifecycleDiffDeps = {}): LifecycleDiff {
  const resolveRuntime = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver())

  return {
    async compare(options) {
      const runtime = resolveRuntime()
      const from = await runtime.resolve({config: options.config, profileName: options.fromProfile})
      const to = await runtime.resolve({config: options.config, profileName: options.toProfile})
      const fromPolicy = resolveNetworkPolicy({networkName: from.networkName, profile: from.profile})
      const toPolicy = resolveNetworkPolicy({networkName: to.networkName, profile: to.profile})
      const services = SERVICE_NAMES.map((name) => {
        const fromValue = serviceValue(from.profile.services[name])
        const toValue = serviceValue(to.profile.services[name])
        return {
          change: fromValue === toValue
            ? 'unchanged'
            : !fromValue && toValue
              ? 'added'
              : fromValue && !toValue
                ? 'removed'
                : 'changed',
          from: fromValue,
          name,
          to: toValue,
        } satisfies ServiceDiff
      }).filter(service => service.from || service.to)
      const advisories: LifecycleAdvisory[] = []

      if (fromPolicy.tier !== toPolicy.tier) {
        advisories.push({
          code: 'network-tier',
          message: `Promotion crosses network tiers from ${fromPolicy.displayName} to ${toPolicy.displayName}. Reconfirm runbooks before rollout.`,
          severity: 'warn',
        })
      }

      if (to.profile.experimental) {
        advisories.push({
          code: 'experimental-target',
          message: `Target profile "${to.profile.name}" is marked experimental.`,
          severity: 'warn',
        })
      }

      if (!to.profile.services.scan?.url) {
        advisories.push({
          code: 'scan-missing',
          message: 'Target profile does not expose a stable/public scan endpoint.',
          severity: 'fail',
        })
      }

      if (to.credential.source === 'missing') {
        advisories.push({
          code: 'auth-material',
          message: `No auth material resolved for ${to.networkName}. Provide ${to.auth.envVarName} or store credentials before promotion.`,
          severity: 'fail',
        })
      }

      if (to.profile.services.localnet?.version && from.profile.services.localnet?.version
        && to.profile.services.localnet.version !== from.profile.services.localnet.version) {
        advisories.push({
          code: 'version-line',
          message: `LocalNet version line changes from ${from.profile.services.localnet.version} to ${to.profile.services.localnet.version}.`,
          severity: 'warn',
        })
      }

      if (toPolicy.resetExpectation === 'resets-expected') {
        advisories.push({
          code: 'reset-sensitive',
          message: `${toPolicy.displayName} may reset. Reconfirm migration-sensitive data, balances, and onboarding state before rollout.`,
          severity: 'warn',
        })
        advisories.push({
          code: 'migration-policy',
          message: `Migration IDs on ${toPolicy.displayName} should be treated as reset-sensitive advisory data.`,
          severity: 'warn',
        })
      } else if (toPolicy.resetExpectation === 'no-resets-expected') {
        advisories.push({
          code: 'migration-policy',
          message: `${toPolicy.displayName} is expected not to reset. Investigate any migration-id discontinuity before rollout.`,
          severity: 'info',
        })
      }

      if (toPolicy.tier !== 'local') {
        advisories.push({
          code: 'sponsor-reminder',
          message: 'Confirm sponsor-owned inputs, onboarding secrets, and allowlisting with the target operator before rollout.',
          severity: 'warn',
        })
      }

      return {
        advisories,
        from: {
          experimental: from.profile.experimental,
          kind: from.profile.kind,
          name: from.profile.name,
          network: from.networkName,
          tier: fromPolicy.tier,
        },
        services,
        success: !advisories.some(advisory => advisory.severity === 'fail'),
        summary: {
          failed: advisories.filter(advisory => advisory.severity === 'fail').length,
          info: advisories.filter(advisory => advisory.severity === 'info').length,
          warned: advisories.filter(advisory => advisory.severity === 'warn').length,
        },
        to: {
          experimental: to.profile.experimental,
          kind: to.profile.kind,
          name: to.profile.name,
          network: to.networkName,
          tier: toPolicy.tier,
        },
      }
    },
  }
}

function serviceValue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return typeof record.url === 'string'
    ? record.url
    : typeof record.kind === 'string'
      ? record.kind
      : typeof record.version === 'string'
        ? record.version
        : JSON.stringify(record)
}

