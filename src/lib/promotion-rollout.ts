import type {CantonctlConfig} from './config.js'
import {
  createControlPlaneOperationRunner,
  type ControlPlaneBlocker,
  type ControlPlaneOperationMode,
  type ControlPlaneOperationResult,
  type ControlPlaneRunbookItem,
  type ControlPlaneWarning,
} from './control-plane-operation.js'
import {createLifecycleDiff, type LifecycleAdvisory, type LifecycleDiff, type PromoteDiffReport} from './lifecycle/diff.js'
import {createPreflightChecks, type PreflightRunner} from './preflight/checks.js'
import type {PreflightReport} from './preflight/output.js'
import {createReadinessRunner, type ReadinessReport, type ReadinessRunner} from './readiness.js'
import {createPromotionRunbookItem} from './rollout-contract.js'

export interface PromotionRolloutOptions {
  config: CantonctlConfig
  fromProfile: string
  mode?: ControlPlaneOperationMode
  signal?: AbortSignal
  toProfile: string
}

export interface PromotionRolloutResult extends PromoteDiffReport {
  preflight?: PreflightReport
  readiness?: ReadinessReport
  rollout: ControlPlaneOperationResult
}

export interface PromotionRunner {
  run(options: PromotionRolloutOptions): Promise<PromotionRolloutResult>
}

export interface PromotionRunnerDeps {
  createLifecycleDiff?: () => LifecycleDiff
  createPreflightRunner?: () => PreflightRunner
  createReadinessRunner?: () => ReadinessRunner
}

interface PromotionState {
  comparison?: PromoteDiffReport
  preflight?: PreflightReport
  readiness?: ReadinessReport
}

export function createPromotionRunner(
  deps: PromotionRunnerDeps = {},
): PromotionRunner {
  const createDiff = deps.createLifecycleDiff ?? (() => createLifecycleDiff())
  const createPreflight = deps.createPreflightRunner ?? (() => createPreflightChecks())
  const createReadiness = deps.createReadinessRunner ?? (() => createReadinessRunner())

  return {
    async run(options) {
      let stateRef: PromotionState | undefined
      const runner = createControlPlaneOperationRunner<PromotionRolloutOptions, PromotionState>({
        createState() {
          stateRef = {}
          return stateRef
        },
        description:
          'Profile-to-profile promotion workflow over stable/public rollout gates. The command compares the source and target profiles, runs live target gates when requested, and separates automated inspection from manual upstream runbooks.',
        operation: 'promotion',
        steps: [
          {
            effect: 'read',
            id: 'inspect-profile-diff',
            run: async ({input, state}) => {
              const comparison = await ensureComparison(state, input, createDiff)
              return {
                data: {
                  advisoryCount: comparison.advisories.length,
                  changedServices: comparison.services.filter(service => service.change !== 'unchanged').length,
                },
                detail: summarizeComparison(comparison),
              }
            },
            title: 'Inspect source and target profiles',
            warnings: async ({input, state}) => collectComparisonWarnings(await ensureComparison(state, input, createDiff)),
          },
          {
            dependsOn: ['inspect-profile-diff'],
            effect: 'read',
            id: 'inspect-target-preflight',
            run: async ({input, state}) => {
              const report = await ensurePreflight(state, input, createPreflight)
              return {
                data: {
                  blocked: report.rollout.summary.blocked,
                  ready: report.rollout.summary.ready,
                  success: report.success,
                },
                detail: summarizePreflight(report),
              }
            },
            title: 'Inspect target preflight gate',
            warnings: async (context) => {
              if (context.mode === 'plan') {
                return []
              }

              return collectPreflightWarnings(await ensurePreflight(context.state, context.input, createPreflight))
            },
          },
          {
            dependsOn: ['inspect-target-preflight'],
            effect: 'read',
            id: 'inspect-target-readiness',
            run: async ({input, state}) => {
              const report = await ensureReadiness(state, input, createReadiness)
              return {
                data: {
                  blocked: report.rollout.summary.blocked,
                  selectedSuites: report.canary.selectedSuites,
                  success: report.success,
                },
                detail: summarizeReadiness(report),
              }
            },
            title: 'Inspect target readiness gate',
            warnings: async (context) => {
              if (context.mode === 'plan') {
                return []
              }

              return collectReadinessWarnings(await ensureReadiness(context.state, context.input, createReadiness))
            },
          },
          {
            dependsOn: ['inspect-target-readiness'],
            effect: 'write',
            id: 'manual-promotion-runbook',
            runbook: async (context) => {
              const comparison = await ensureComparison(context.state, context.input, createDiff)
              const items = createComparisonRunbook(comparison.advisories)

              if (context.mode === 'plan') {
                return items
              }

              const preflight = await ensurePreflight(context.state, context.input, createPreflight)
              return [
                ...items,
                ...preflight.reconcile.runbook.map(action => ({
                  code: action.code,
                  detail: action.command ? `${action.detail} Command: ${action.command}` : action.detail,
                  owner: action.owner,
                  title: action.title,
                })),
              ]
            },
            title: 'Review manual promotion runbook',
          },
          {
            dependsOn: ['inspect-target-readiness'],
            effect: 'read',
            id: 'validate-rollout',
            blockers: async (context) => {
              const comparison = await ensureComparison(context.state, context.input, createDiff)
              const blockers = collectComparisonBlockers(comparison)

              if (context.mode === 'plan') {
                return blockers
              }

              const preflight = await ensurePreflight(context.state, context.input, createPreflight)
              const readiness = await ensureReadiness(context.state, context.input, createReadiness)

              return [
                ...blockers,
                ...collectReportBlockers(preflight.rollout, 'preflight'),
                ...collectReportBlockers(readiness.rollout, 'readiness'),
              ]
            },
            run: async ({input, mode, state}) => {
              const readiness = await ensureReadiness(state, input, createReadiness)
              return {
                data: {
                  success: readiness.success,
                  targetProfile: input.toProfile,
                },
                detail: `Promotion rollout gates passed for ${input.toProfile}.`,
              }
            },
            title: 'Validate rollout gate',
          },
        ],
      })

      const mode = options.mode ?? 'plan'
      const rollout = mode === 'plan'
        ? await runner.plan({input: options, signal: options.signal})
        : mode === 'dry-run'
          ? await runner.dryRun({input: options, signal: options.signal})
          : await runner.apply({input: options, signal: options.signal})
      const comparison = stateRef?.comparison ?? await createDiff().compare({
        config: options.config,
        fromProfile: options.fromProfile,
        toProfile: options.toProfile,
      })

      return {
        ...comparison,
        preflight: stateRef?.preflight,
        readiness: stateRef?.readiness,
        rollout,
        success: rollout.success,
      }
    },
  }
}

async function ensureComparison(
  state: PromotionState,
  input: PromotionRolloutOptions,
  createDiff: () => LifecycleDiff,
): Promise<PromoteDiffReport> {
  if (!state.comparison) {
    state.comparison = await createDiff().compare({
      config: input.config,
      fromProfile: input.fromProfile,
      toProfile: input.toProfile,
    })
  }

  return state.comparison
}

async function ensurePreflight(
  state: PromotionState,
  input: PromotionRolloutOptions,
  createPreflight: () => PreflightRunner,
): Promise<PreflightReport> {
  if (!state.preflight) {
    state.preflight = await createPreflight().run({
      config: input.config,
      profileName: input.toProfile,
      signal: input.signal,
    })
  }

  return state.preflight
}

async function ensureReadiness(
  state: PromotionState,
  input: PromotionRolloutOptions,
  createReadiness: () => ReadinessRunner,
): Promise<ReadinessReport> {
  if (!state.readiness) {
    state.readiness = await createReadiness().run({
      config: input.config,
      profileName: input.toProfile,
      signal: input.signal,
    })
  }

  return state.readiness
}

function summarizeComparison(report: PromoteDiffReport): string {
  const changedServices = report.services.filter(service => service.change !== 'unchanged').length
  return `${report.from.name} -> ${report.to.name} changes ${changedServices} service surface(s) with ${report.advisories.length} advisory item(s).`
}

function summarizePreflight(report: PreflightReport): string {
  return report.success
    ? `Target preflight passed for ${report.profile.name} with ${report.rollout.summary.ready} supported reconcile action(s).`
    : `Target preflight found blocking issues for ${report.profile.name}.`
}

function summarizeReadiness(report: ReadinessReport): string {
  return report.success
    ? `Target readiness passed for ${report.profile.name} across ${report.canary.selectedSuites.length} canary suite(s).`
    : `Target readiness found blocking issues for ${report.profile.name}.`
}

function collectComparisonWarnings(report: PromoteDiffReport): ControlPlaneWarning[] {
  return report.advisories
    .filter(advisory => advisory.severity !== 'fail')
    .map((advisory) => ({
      code: advisory.code,
      detail: advisory.message,
    }))
}

function collectPreflightWarnings(report: PreflightReport): ControlPlaneWarning[] {
  return [
    ...report.checks
      .filter(check => check.status === 'warn')
      .map((check) => ({code: `preflight-${slugify(check.name)}-warning`, detail: check.detail})),
    ...report.auth.warnings.map((warning, index) => ({
      code: `auth-warning-${index}`,
      detail: warning,
    })),
  ]
}

function collectReadinessWarnings(report: ReadinessReport): ControlPlaneWarning[] {
  return report.canary.checks.flatMap((check, checkIndex) =>
    check.warnings.map((warning, warningIndex) => ({
      code: `canary-${slugify(check.suite)}-${checkIndex}-warning-${warningIndex}`,
      detail: warning,
    })),
  )
}

function collectComparisonBlockers(report: PromoteDiffReport): ControlPlaneBlocker[] {
  return report.advisories
    .filter(advisory => advisory.severity === 'fail')
    .map((advisory) => ({
      code: advisory.code,
      detail: advisory.message,
    }))
}

function collectReportBlockers(
  rollout: ControlPlaneOperationResult,
  prefix: string,
): ControlPlaneBlocker[] {
  return rollout.steps
    .filter(step => step.status === 'blocked' || step.status === 'failed')
    .flatMap((step) => step.blockers.length > 0
      ? step.blockers
      : [{
        code: `${prefix}-${step.id}`,
        detail: step.detail ?? `${step.title} blocked the rollout gate.`,
      }])
}

function createComparisonRunbook(advisories: LifecycleAdvisory[]): ControlPlaneRunbookItem[] {
  return advisories.flatMap((advisory) => {
    switch (advisory.code) {
      case 'network-tier':
        return [createPromotionRunbookItem({
          code: advisory.code,
          detail: advisory.message,
          title: 'Review cross-tier promotion runbook',
        })]
      case 'reset-sensitive':
        return [createPromotionRunbookItem({
          code: advisory.code,
          detail: advisory.message,
          title: 'Confirm reset-sensitive assumptions',
        })]
      case 'migration-policy':
        return [createPromotionRunbookItem({
          code: advisory.code,
          detail: advisory.message,
          title: 'Review migration continuity',
        })]
      case 'sponsor-reminder':
        return [createPromotionRunbookItem({
          code: advisory.code,
          detail: advisory.message,
          title: 'Confirm sponsor-owned inputs',
        })]
      case 'version-line':
        return [createPromotionRunbookItem({
          code: advisory.code,
          detail: advisory.message,
          title: 'Review LocalNet version line',
        })]
      case 'experimental-target':
        return [createPromotionRunbookItem({
          code: advisory.code,
          detail: advisory.message,
          title: 'Review experimental target',
        })]
      default:
        return []
    }
  })
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
