import {createScanAdapter, type ScanAdapter} from '../adapters/scan.js'
import {readNumber, readRecord} from '../adapters/common.js'
import type {CantonctlConfig} from '../config.js'
import {
  createControlPlaneOperationRunner,
  type ControlPlaneBlocker,
  type ControlPlaneOperationMode,
  type ControlPlaneOperationResult,
  type ControlPlaneRunbookItem,
  type ControlPlaneWarning,
} from '../control-plane-operation.js'
import {CantonctlError} from '../errors.js'
import type {Localnet} from '../localnet.js'
import {resolveNetworkPolicy, type NetworkPolicy} from '../preflight/network-policy.js'
import {type ProfileRuntimeResolver, createProfileRuntimeResolver, type ResolvedProfileRuntime} from '../profile-runtime.js'
import {createReadinessRunner, type ReadinessReport, type ReadinessRunner} from '../readiness.js'
import type {LifecycleAdvisory} from './diff.js'
import {
  cycleLocalnetWorkspace,
  isLocalnetLifecycleProfile,
  type LocalnetCycleResult,
} from './localnet-cycle.js'

export interface LifecycleNetworkSummary {
  checklist: string[]
  displayName: string
  name: string
  reminders: string[]
  resetExpectation: NetworkPolicy['resetExpectation']
  tier: NetworkPolicy['tier']
}

export interface UpgradeAutomationSummary {
  available: boolean
  detail: string
  kind: 'localnet-cycle' | 'manual-only'
  requiresWorkspace: boolean
}

export interface UpgradeCheckReport {
  advisories: LifecycleAdvisory[]
  auth: {
    envVarName: string
    mode: string
    source: string
  }
  automation: UpgradeAutomationSummary
  compatibility: {
    failed: number
    warned: number
  }
  migration?: {
    previousMigrationId?: number
    source: string
    warning?: string
  }
  network: LifecycleNetworkSummary
  profile: {
    kind: string
    name: string
    network: string
    tier: string
  }
  readiness?: ReadinessReport
  rollout: ControlPlaneOperationResult
  success: boolean
}

export interface UpgradeRunOptions {
  config: CantonctlConfig
  mode?: ControlPlaneOperationMode
  profileName?: string
  signal?: AbortSignal
  workspace?: string
}

export interface UpgradeRunnerDeps {
  createLocalnet?: () => Localnet
  createProfileRuntimeResolver?: () => ProfileRuntimeResolver
  createReadinessRunner?: () => ReadinessRunner
  createScanAdapter?: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
}

export interface UpgradeRunner {
  check(options: Omit<UpgradeRunOptions, 'mode'>): Promise<UpgradeCheckReport>
  run(options: UpgradeRunOptions): Promise<UpgradeCheckReport>
}

export type UpgradeChecker = UpgradeRunner

interface UpgradeAssessment {
  advisories: LifecycleAdvisory[]
  auth: UpgradeCheckReport['auth']
  compatibility: UpgradeCheckReport['compatibility']
  migration?: UpgradeCheckReport['migration']
  network: LifecycleNetworkSummary
  profile: UpgradeCheckReport['profile']
}

interface UpgradeState {
  assessment?: UpgradeAssessment
  localnet?: LocalnetCycleResult
  readiness?: ReadinessReport
}

interface UpgradeAutomationSupport {
  available: boolean
  kind: UpgradeAutomationSummary['kind']
  requiresWorkspace: boolean
  summary: UpgradeAutomationSummary
}

export function createUpgradeRunner(deps: UpgradeRunnerDeps = {}): UpgradeRunner {
  const resolveRuntime = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver())
  const createScan = deps.createScanAdapter ?? createScanAdapter
  const createReadiness = deps.createReadinessRunner ?? (() => createReadinessRunner())

  return {
    check(options) {
      return this.run({...options, mode: 'plan'})
    },

    async run(options) {
      const runtime = await resolveRuntime().resolve({config: options.config, profileName: options.profileName})
      const mode = options.mode ?? 'plan'
      const automation = describeUpgradeAutomation(runtime)
      let stateRef: UpgradeState | undefined

      const runner = createControlPlaneOperationRunner<UpgradeRunOptions, UpgradeState>({
        createState() {
          stateRef = {}
          return stateRef
        },
        description:
          'Plan-first upgrade workflow over official runtime artifacts. cantonctl plans upgrade gates, automates only supported local workspace cycling, and keeps upstream runtime ownership explicit.',
        operation: 'upgrade',
        steps: [
          {
            effect: 'read',
            id: 'inspect-upgrade-gate',
            run: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => {
              const assessment = await ensureAssessment(state, input, runtime, createScan)
              return {
                data: {
                  advisoryCount: assessment.advisories.length,
                  failed: assessment.compatibility.failed,
                  warned: assessment.compatibility.warned,
                },
                detail: summarizeAssessment(assessment),
              }
            },
            title: 'Inspect upgrade gate',
            warnings: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => collectAssessmentWarnings(
              await ensureAssessment(state, input, runtime, createScan),
            ),
          },
          {
            dependsOn: ['inspect-upgrade-gate'],
            effect: 'read',
            id: 'review-manual-upgrade-runbook',
            runbook: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => createUpgradeRunbook({
              assessment: await ensureAssessment(state, input, runtime, createScan),
              automation,
              mode,
              profileKind: runtime.profile.kind,
            }),
            title: 'Review manual upgrade runbook',
          },
          {
            dependsOn: ['inspect-upgrade-gate'],
            effect: 'read',
            id: 'validate-upgrade-plan',
            blockers: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => {
              const assessment = await ensureAssessment(state, input, runtime, createScan)
              return collectUpgradeBlockers({
                advisories: assessment.advisories,
                automation,
                mode,
                workspace: input.workspace,
              })
            },
            run: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => {
              const assessment = await ensureAssessment(state, input, runtime, createScan)
              return {
                data: {
                  automation: automation.summary.kind,
                  success: !assessment.advisories.some(advisory => advisory.severity === 'fail'),
                  workspace: input.workspace,
                },
                detail: summarizeUpgradeValidation(automation, input.workspace),
              }
            },
            title: 'Validate upgrade workflow',
          },
          ...(automation.available ? [{
            dependsOn: ['validate-upgrade-plan'],
            effect: 'write' as const,
            id: 'cycle-localnet-workspace',
            run: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => {
              const result = await cycleLocalnetWorkspace({
                createLocalnet: deps.createLocalnet,
                profile: runtime.profile,
                workspace: input.workspace!,
              })
              state.localnet = result

              return {
                checkpoint: {
                  selectedProfile: result.selectedProfile,
                  workspace: result.workspace,
                },
                data: {
                  selectedProfile: result.selectedProfile,
                  validatorHealthy: result.status.health.validatorReadyz.healthy,
                  workspace: result.workspace,
                },
                detail:
                  `Cycled the official LocalNet workspace at ${result.workspace} ` +
                  `using profile ${result.selectedProfile}.`,
              }
            },
            title: 'Cycle official LocalNet workspace',
            warnings: () => [{
              code: 'official-runtime-boundary',
              detail:
                'cantonctl only cycles the existing LocalNet workspace. Upstream version selection and compose/env edits remain owned by Quickstart/LocalNet.',
            }],
          }] : []),
          ...(mode === 'apply' && automation.available ? [{
            dependsOn: ['cycle-localnet-workspace'],
            effect: 'read' as const,
            id: 'inspect-post-upgrade-readiness',
            blockers: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => {
              const readiness = await ensureReadiness(state, input, createReadiness)
              return collectReadinessBlockers(readiness.rollout)
            },
            run: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => {
              const readiness = await ensureReadiness(state, input, createReadiness)
              return {
                data: {
                  selectedSuites: readiness.canary.selectedSuites,
                  success: readiness.success,
                },
                detail: `Post-upgrade readiness completed for ${runtime.profile.name}.`,
              }
            },
            title: 'Inspect post-upgrade readiness',
            warnings: async ({input, state}: {input: UpgradeRunOptions; state: UpgradeState}) => collectReadinessWarnings(
              await ensureReadiness(state, input, createReadiness),
            ),
          }] : []),
        ],
      })

      const rollout = mode === 'plan'
        ? await runner.plan({input: options, signal: options.signal})
        : mode === 'dry-run'
          ? await runner.dryRun({input: options, signal: options.signal})
          : await runner.apply({input: options, signal: options.signal})
      const assessment = stateRef!.assessment!

      return {
        ...assessment,
        automation: automation.summary,
        readiness: stateRef?.readiness,
        rollout,
        success: rollout.success,
      }
    },
  }
}

export const createUpgradeChecker = createUpgradeRunner

async function ensureAssessment(
  state: UpgradeState,
  input: UpgradeRunOptions,
  runtime: ResolvedProfileRuntime,
  createScan: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter,
): Promise<UpgradeAssessment> {
  if (!state.assessment) {
    state.assessment = await assessUpgrade(runtime, createScan, input.signal)
  }

  return state.assessment
}

async function ensureReadiness(
  state: UpgradeState,
  input: UpgradeRunOptions,
  createReadiness: () => ReadinessRunner,
): Promise<ReadinessReport> {
  if (!state.readiness) {
    state.readiness = await createReadiness().run({
      config: input.config,
      profileName: input.profileName,
      signal: input.signal,
    })
  }

  return state.readiness
}

async function assessUpgrade(
  runtime: ResolvedProfileRuntime,
  createScan: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter,
  signal: AbortSignal | undefined,
): Promise<UpgradeAssessment> {
  const policy = resolveNetworkPolicy({networkName: runtime.networkName, profile: runtime.profile})
  const advisories: LifecycleAdvisory[] = []
  let migration: UpgradeAssessment['migration']

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
      message: policy.tier === 'local'
        ? 'Stable/public scan is not configured for this local profile, so migration checks are informational only.'
        : 'Stable/public scan is not configured for this profile, so migration checks are incomplete.',
      severity: policy.tier === 'local' ? 'warn' : 'fail',
    })
  } else {
    try {
      const scan = createScan({
        profile: runtime.profileContext,
        token: runtime.credential.token,
      })
      const dsoInfo = await scan.getDsoInfo(signal)
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
    network: toNetworkSummary(runtime.networkName, policy),
    profile: {
      kind: runtime.profile.kind,
      name: runtime.profile.name,
      network: runtime.networkName,
      tier: policy.tier,
    },
  }
}

function describeUpgradeAutomation(runtime: ResolvedProfileRuntime): UpgradeAutomationSupport {
  if (isLocalnetLifecycleProfile(runtime.profile)) {
    return {
      available: true,
      kind: 'localnet-cycle',
      requiresWorkspace: true,
      summary: {
        available: true,
        detail:
          'After upstream LocalNet version or config changes are prepared, cantonctl can cycle and validate the official LocalNet workspace.',
        kind: 'localnet-cycle',
        requiresWorkspace: true,
      },
    }
  }

  return {
    available: false,
    kind: 'manual-only',
    requiresWorkspace: false,
    summary: {
      available: false,
      detail: runtime.profile.kind === 'remote-validator' || runtime.profile.kind === 'remote-sv-network'
        ? 'Remote upgrade mutation remains operator-owned. cantonctl plans the gate and keeps the manual boundary explicit.'
        : 'This runtime does not expose a supported upgrade apply primitive. cantonctl keeps the workflow plan-first and manual-only.',
      kind: 'manual-only',
      requiresWorkspace: false,
    },
  }
}

function toNetworkSummary(name: string, policy: NetworkPolicy): LifecycleNetworkSummary {
  return {
    checklist: [...policy.checklist],
    displayName: policy.displayName,
    name,
    reminders: [...policy.reminders],
    resetExpectation: policy.resetExpectation,
    tier: policy.tier,
  }
}

function summarizeAssessment(assessment: UpgradeAssessment): string {
  return `${assessment.profile.name} (${assessment.network.displayName}) has ${assessment.advisories.length} upgrade advisory item(s).`
}

function summarizeUpgradeValidation(
  automation: UpgradeAutomationSupport,
  workspace: string | undefined,
): string {
  if (automation.available && workspace) {
    return `Upgrade workflow is ready to use ${workspace} for the supported LocalNet cycle step.`
  }

  return 'Upgrade workflow stays manual-only after planning because this target does not expose a supported apply step.'
}

function collectAssessmentWarnings(assessment: UpgradeAssessment): ControlPlaneWarning[] {
  return [
    ...assessment.network.reminders.map((detail, index) => ({
      code: `network-reminder-${index}`,
      detail,
    })),
    ...assessment.advisories
      .filter(advisory => advisory.severity !== 'fail')
      .map(advisory => ({code: advisory.code, detail: advisory.message})),
  ]
}

function collectUpgradeBlockers(options: {
  advisories: LifecycleAdvisory[]
  automation: UpgradeAutomationSupport
  mode: ControlPlaneOperationMode
  workspace?: string
}): ControlPlaneBlocker[] {
  const blockers: ControlPlaneBlocker[] = options.advisories
    .filter(advisory => advisory.severity === 'fail')
    .map((advisory) => ({code: advisory.code, detail: advisory.message}))

  if (options.mode !== 'plan' && options.automation.available && !options.workspace) {
    blockers.push({
      code: 'workspace-required',
      detail: 'Provide --workspace to let cantonctl cycle the official LocalNet workspace in live upgrade modes.',
    })
  }

  if (options.mode === 'apply' && !options.automation.available) {
    blockers.push({
      code: 'apply-unsupported',
      detail: 'Upgrade apply is not supported for this target. Follow the emitted manual runbook instead.',
    })
  }

  return blockers
}

function createUpgradeRunbook(options: {
  assessment: UpgradeAssessment
  automation: UpgradeAutomationSupport
  mode: ControlPlaneOperationMode
  profileKind: ResolvedProfileRuntime['profile']['kind']
}): ControlPlaneRunbookItem[] {
  const items = options.assessment.advisories.flatMap((advisory) => advisoryToRunbookItem(advisory))

  if (options.automation.available) {
    items.unshift({
      code: 'localnet-upstream-change',
      detail: options.mode === 'plan'
        ? 'Update the official LocalNet workspace version/config outside cantonctl, then use --workspace to let cantonctl cycle and validate it.'
        : 'Quickstart/LocalNet remains the source of truth for version and compose/env changes. Prepare that upstream change before the automated cycle step runs.',
      owner: 'official-stack',
      title: 'Prepare upstream LocalNet change',
    })
  } else if (options.profileKind === 'remote-validator' || options.profileKind === 'remote-sv-network') {
    items.unshift({
      code: 'remote-upgrade-runbook',
      detail: 'Coordinate the runtime upgrade with the target operator. cantonctl will not mutate remote runtime ownership boundaries directly.',
      owner: 'operator',
      title: 'Run operator-owned upgrade procedure',
    })
  } else {
    items.unshift({
      code: 'local-runtime-runbook',
      detail: 'Use the owning local runtime workflow to restart or recreate this environment after any upstream upgrade step.',
      owner: 'cantonctl',
      title: 'Use the owning local runtime workflow',
    })
  }

  return dedupeRunbookItems(items)
}

function advisoryToRunbookItem(advisory: LifecycleAdvisory): ControlPlaneRunbookItem[] {
  switch (advisory.code) {
    case 'reset-sensitive':
      return [{
        code: advisory.code,
        detail: advisory.message,
        owner: 'official-stack',
        title: 'Confirm reset-sensitive assumptions',
      }]
    case 'migration-policy':
      return [{
        code: advisory.code,
        detail: advisory.message,
        owner: 'official-stack',
        title: 'Review migration continuity',
      }]
    case 'sponsor-reminder':
      return [{
        code: advisory.code,
        detail: advisory.message,
        owner: 'operator',
        title: 'Confirm sponsor-owned inputs',
      }]
    case 'experimental-target':
      return [{
        code: advisory.code,
        detail: advisory.message,
        owner: 'operator',
        title: 'Review experimental target',
      }]
    case 'version-line':
      return [{
        code: advisory.code,
        detail: advisory.message,
        owner: 'official-stack',
        title: 'Review pinned version line',
      }]
    case 'scan-missing':
      return [{
        code: advisory.code,
        detail: advisory.message,
        owner: 'official-stack',
        title: 'Accept limited migration visibility',
      }]
    default:
      return []
  }
}

function dedupeRunbookItems(items: ControlPlaneRunbookItem[]): ControlPlaneRunbookItem[] {
  return [...new Map(
    items.map(item => [`${item.code}:${item.title}:${item.detail}`, item]),
  ).values()]
}

function collectReadinessBlockers(rollout: ControlPlaneOperationResult): ControlPlaneBlocker[] {
  return rollout.steps
    .filter(step => step.status === 'blocked' || step.status === 'failed')
    .flatMap((step) => step.blockers.length > 0
      ? step.blockers
      : [{
        code: `readiness-${step.id}`,
        detail: step.detail ?? `${step.title} blocked the upgrade workflow.`,
      }])
}

function collectReadinessWarnings(report: ReadinessReport): ControlPlaneWarning[] {
  return report.canary.checks.flatMap((check, checkIndex) =>
    check.warnings.map((warning, warningIndex) => ({
      code: `canary-${slugify(check.suite)}-${checkIndex}-warning-${warningIndex}`,
      detail: warning,
    })),
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
