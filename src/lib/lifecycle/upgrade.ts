import {createScanAdapter, type ScanAdapter} from '../adapters/scan.js'
import type {CantonctlConfig} from '../config.js'
import {CantonctlError} from '../errors.js'
import {type ProfileRuntimeResolver, createProfileRuntimeResolver} from '../profile-runtime.js'
import {readNumber, readRecord} from '../adapters/common.js'
import {resolveNetworkPolicy} from '../preflight/network-policy.js'
import type {LifecycleAdvisory} from './diff.js'

export interface UpgradeCheckReport {
  advisories: LifecycleAdvisory[]
  auth: {
    envVarName: string
    mode: string
    source: string
  }
  compatibility: {
    failed: number
    warned: number
  }
  migration?: {
    previousMigrationId?: number
    source: string
    warning?: string
  }
  profile: {
    kind: string
    name: string
    network: string
    tier: string
  }
  success: boolean
}

export interface UpgradeCheckerDeps {
  createProfileRuntimeResolver?: () => ProfileRuntimeResolver
  createScanAdapter?: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
}

export interface UpgradeChecker {
  check(options: {config: CantonctlConfig; profileName?: string; signal?: AbortSignal}): Promise<UpgradeCheckReport>
}

export function createUpgradeChecker(deps: UpgradeCheckerDeps = {}): UpgradeChecker {
  const resolveRuntime = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver())
  const createScan = deps.createScanAdapter ?? createScanAdapter

  return {
    async check(options) {
      const runtime = await resolveRuntime().resolve({config: options.config, profileName: options.profileName})
      const policy = resolveNetworkPolicy({networkName: runtime.networkName, profile: runtime.profile})
      const advisories: LifecycleAdvisory[] = []
      let migration: UpgradeCheckReport['migration']

      if (runtime.compatibility.failed > 0) {
        advisories.push({
          code: 'version-line',
          message: `${runtime.compatibility.failed} compatibility check(s) failed against the pinned stable/public baseline.`,
          severity: 'fail',
        })
      }

      if (runtime.profile.kind === 'splice-localnet' && !runtime.profile.services.localnet?.version) {
        advisories.push({
          code: 'version-line',
          message: 'splice-localnet profile does not pin a LocalNet version line.',
          severity: 'warn',
        })
      }

      if (runtime.credential.source === 'missing') {
        advisories.push({
          code: 'auth-material',
          message: `No auth material resolved for ${runtime.networkName}. Provide ${runtime.auth.envVarName} or store credentials before upgrade checks.`,
          severity: 'fail',
        })
      }

      if (runtime.auth.experimental) {
        advisories.push({
          code: 'experimental-target',
          message: `Auth mode ${runtime.auth.mode} is experimental or operator-managed. Reconfirm upgrade steps with the operator.`,
          severity: 'warn',
        })
      }

      if (!runtime.profile.services.scan?.url) {
        advisories.push({
          code: 'scan-missing',
          message: 'Stable/public scan is not configured for this profile, so migration checks are incomplete.',
          severity: 'fail',
        })
      } else {
        try {
          const scan = createScan({
            profile: runtime.profileContext,
            token: runtime.credential.token,
          })
          const dsoInfo = await scan.getDsoInfo(options.signal)
          const record = readRecord(dsoInfo as Record<string, unknown>, 'migration') ?? (dsoInfo as Record<string, unknown>)
          const migrationId = readNumber(record, 'migration_id') ?? readNumber(record, 'migrationId')
          const previousMigrationId = readNumber(record, 'previous_migration_id') ?? readNumber(record, 'previousMigrationId')
          migration = migrationId !== undefined
            ? {
              previousMigrationId,
              source: scan.metadata.baseUrl,
            }
            : {
              source: scan.metadata.baseUrl,
              warning: 'Migration metadata was not present in the scan response.',
            }
        } catch (error) {
          advisories.push({
            code: 'migration-policy',
            message: error instanceof CantonctlError
              ? `Could not read migration metadata from scan: ${error.message}`
              : 'Could not read migration metadata from scan.',
            severity: 'warn',
          })
        }
      }

      if (policy.tier === 'devnet' || policy.tier === 'testnet') {
        advisories.push({
          code: 'reset-sensitive',
          message: `${policy.displayName} may reset. Recheck migration-sensitive state and onboarding material after every upgrade.`,
          severity: 'warn',
        })
      }

      if (policy.tier === 'mainnet') {
        advisories.push({
          code: 'migration-policy',
          message: 'MainNet upgrades should preserve migration continuity. Take backups and investigate any discontinuity before rollout.',
          severity: 'info',
        })
      }

      if (policy.tier !== 'local') {
        advisories.push({
          code: 'sponsor-reminder',
          message: 'Confirm sponsor-owned inputs, onboarding secrets, and validator allowlisting before upgrade rollout.',
          severity: 'warn',
        })
      }

      return {
        advisories,
        auth: {
          envVarName: runtime.auth.envVarName,
          mode: runtime.auth.mode,
          source: runtime.credential.source,
        },
        compatibility: {
          failed: runtime.compatibility.failed,
          warned: runtime.compatibility.warned,
        },
        migration,
        profile: {
          kind: runtime.profile.kind,
          name: runtime.profile.name,
          network: runtime.networkName,
          tier: policy.tier,
        },
        success: !advisories.some(advisory => advisory.severity === 'fail'),
      }
    },
  }
}

