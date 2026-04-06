import {type CanaryReport, type CanaryRunner, STABLE_PUBLIC_CANARY_SUITES, createCanaryRunner, selectStablePublicCanarySuites} from './canary/run.js'
import {resolveProfile} from './compat.js'
import type {CantonctlConfig} from './config.js'
import {type PreflightRunner, createPreflightChecks} from './preflight/checks.js'
import type {PreflightReport} from './preflight/output.js'

export interface ReadinessReport {
  auth: PreflightReport['auth']
  canary: {
    checks: CanaryReport['checks']
    selectedSuites: typeof STABLE_PUBLIC_CANARY_SUITES[number][]
    skippedSuites: typeof STABLE_PUBLIC_CANARY_SUITES[number][]
    success: boolean
  }
  compatibility: PreflightReport['compatibility']
  drift: PreflightReport['drift']
  preflight: PreflightReport
  profile: PreflightReport['profile']
  reconcile: PreflightReport['reconcile']
  success: boolean
  summary: {
    failed: number
    passed: number
    skipped: number
    warned: number
  }
}

export interface ReadinessRunner {
  run(options: {config: CantonctlConfig; profileName?: string; signal?: AbortSignal}): Promise<ReadinessReport>
}

export function createReadinessRunner(
  deps: {
    createCanaryRunner?: () => CanaryRunner
    createPreflightRunner?: () => PreflightRunner
  } = {},
): ReadinessRunner {
  const createCanary = deps.createCanaryRunner ?? (() => createCanaryRunner())
  const createPreflight = deps.createPreflightRunner ?? (() => createPreflightChecks())

  return {
    async run(options) {
      const {profile} = resolveProfile(options.config, options.profileName)
      const selectedSuites = selectStablePublicCanarySuites(profile)
      const skippedSuites = STABLE_PUBLIC_CANARY_SUITES.filter(suite => !selectedSuites.includes(suite))
      const preflight = await createPreflight().run(options)
      const canary = selectedSuites.length === 0
        ? {
          checks: [],
          profile: {kind: profile.kind, name: profile.name},
          success: true,
        }
        : await createCanary().run({
          config: options.config,
          profileName: options.profileName,
          signal: options.signal,
          suites: selectedSuites,
        })

      const summary = {
        failed: preflight.checks.filter(check => check.status === 'fail').length
          + canary.checks.filter(check => check.status === 'fail').length,
        passed: preflight.checks.filter(check => check.status === 'pass').length
          + canary.checks.filter(check => check.status === 'pass').length,
        skipped: preflight.checks.filter(check => check.status === 'skip').length + skippedSuites.length,
        warned: preflight.checks.filter(check => check.status === 'warn').length
          + canary.checks.reduce((count, check) => count + check.warnings.length, 0),
      }

      return {
        auth: preflight.auth,
        canary: {
          checks: canary.checks,
          selectedSuites,
          skippedSuites,
          success: canary.success,
        },
        compatibility: preflight.compatibility,
        drift: preflight.drift,
        preflight,
        profile: preflight.profile,
        reconcile: preflight.reconcile,
        success: preflight.success && canary.success,
        summary,
      }
    },
  }
}
