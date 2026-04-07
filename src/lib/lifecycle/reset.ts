import type {CantonctlConfig} from '../config.js'
import {
  createControlPlaneOperationRunner,
  type ControlPlaneBlocker,
  type ControlPlaneOperationMode,
  type ControlPlaneOperationResult,
  type ControlPlaneRunbookItem,
  type ControlPlaneWarning,
} from '../control-plane-operation.js'
import {
  createDiagnosticsAuditStore,
  createResetAuditRecord,
  persistDiagnosticsAuditRecord,
  type DiagnosticsAuditStore,
} from '../diagnostics/audit.js'
import {CantonctlError, ErrorCode} from '../errors.js'
import type {Localnet} from '../localnet.js'
import {resolveNetworkPolicy, type NetworkPolicy} from '../preflight/network-policy.js'
import {type ProfileRuntimeResolver, createProfileRuntimeResolver, type ResolvedProfileRuntime} from '../profile-runtime.js'
import {createReadinessRunner, type ReadinessReport, type ReadinessRunner} from '../readiness.js'
import {
  cycleLocalnetWorkspace,
  isLocalnetLifecycleProfile,
  type LocalnetCycleResult,
} from './localnet-cycle.js'
import type {LifecycleNetworkSummary, UpgradeAutomationSummary} from './upgrade.js'

export interface ResetChecklistItem {
  severity: 'info' | 'warn'
  text: string
}

export interface ResetChecklistTarget {
  kind: 'network' | 'profile'
  name: string
}

export interface ResetChecklistReport {
  automation: UpgradeAutomationSummary
  checklist: ResetChecklistItem[]
  network: LifecycleNetworkSummary
  profile?: {
    kind: string
    name: string
    network: string
    tier: string
  }
  readiness?: ReadinessReport
  resetExpectation: NetworkPolicy['resetExpectation']
  rollout: ControlPlaneOperationResult
  success: boolean
  target: ResetChecklistTarget
}

export interface ResetRunOptions {
  config?: CantonctlConfig
  mode?: ControlPlaneOperationMode
  network?: 'devnet' | 'mainnet' | 'testnet'
  profileName?: string
  projectDir?: string
  signal?: AbortSignal
  workspace?: string
}

export interface ResetRunnerDeps {
  createAuditStore?: () => DiagnosticsAuditStore
  createLocalnet?: () => Localnet
  createProfileRuntimeResolver?: () => ProfileRuntimeResolver
  createReadinessRunner?: () => ReadinessRunner
}

export interface ResetRunner {
  createChecklist(options: Omit<ResetRunOptions, 'mode'>): Promise<ResetChecklistReport>
  run(options: ResetRunOptions): Promise<ResetChecklistReport>
}

export type ResetHelper = ResetRunner

interface ResetState {
  localnet?: LocalnetCycleResult
  readiness?: ReadinessReport
}

interface ResetTargetContext {
  checklist: ResetChecklistItem[]
  network: LifecycleNetworkSummary
  profile?: ResetChecklistReport['profile']
  runtimeProfile?: Pick<ResolvedProfileRuntime['profile'], 'kind' | 'name' | 'services'>
  target: ResetChecklistTarget
}

interface ResetAutomationSupport {
  available: boolean
  summary: UpgradeAutomationSummary
}

export function createResetRunner(deps: ResetRunnerDeps = {}): ResetRunner {
  const createAuditStore = deps.createAuditStore ?? (() => createDiagnosticsAuditStore())
  const resolveRuntime = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver())
  const createReadiness = deps.createReadinessRunner ?? (() => createReadinessRunner())

  return {
    createChecklist(options) {
      return this.run({...options, mode: 'plan'})
    },

    async run(options) {
      const context = await resolveResetTargetContext(options, resolveRuntime)
      const automation = describeResetAutomation(context.runtimeProfile)
      const mode = options.mode ?? 'plan'
      let stateRef: ResetState | undefined

      const runner = createControlPlaneOperationRunner<ResetRunOptions, ResetState>({
        createState() {
          stateRef = {}
          return stateRef
        },
        description:
          'Plan-first reset workflow that keeps remote resets manual, preserves network-tier reminders in the JSON contract, and automates only supported local workspace cycling.',
        operation: 'reset',
        steps: [
          {
            effect: 'read',
            id: 'inspect-reset-policy',
            run: async () => ({
              data: {
                checklistCount: context.checklist.length,
                resetExpectation: context.network.resetExpectation,
                target: context.target.name,
              },
              detail: summarizeResetPolicy(context),
            }),
            title: 'Inspect reset policy',
            warnings: async () => collectResetWarnings(context),
          },
          {
            dependsOn: ['inspect-reset-policy'],
            effect: 'read',
            id: 'review-manual-reset-runbook',
            runbook: async () => createResetRunbook(context, automation),
            title: 'Review manual reset runbook',
          },
          {
            dependsOn: ['inspect-reset-policy'],
            effect: 'read',
            id: 'validate-reset-workflow',
            blockers: async ({input}: {input: ResetRunOptions}) => collectResetBlockers({
              automation,
              mode,
              workspace: input.workspace,
            }),
            run: async ({input}: {input: ResetRunOptions}) => ({
              data: {
                automation: automation.summary.kind,
                workspace: input.workspace,
              },
              detail: summarizeResetValidation(context, automation, input.workspace),
            }),
            title: 'Validate reset workflow',
          },
          ...(automation.available ? [{
            dependsOn: ['validate-reset-workflow'],
            effect: 'write' as const,
            id: 'cycle-localnet-workspace',
            run: async ({input, state}: {input: ResetRunOptions; state: ResetState}) => {
              const result = await cycleLocalnetWorkspace({
                createLocalnet: deps.createLocalnet,
                profile: context.runtimeProfile!,
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
                'cantonctl only cycles the existing LocalNet workspace. Upstream state reset decisions remain owned by Quickstart/LocalNet.',
            }],
          }] : []),
          ...(mode === 'apply' && automation.available ? [{
            dependsOn: ['cycle-localnet-workspace'],
            effect: 'read' as const,
            id: 'inspect-post-reset-readiness',
            blockers: async ({input, state}: {input: ResetRunOptions; state: ResetState}) => {
              const readiness = await ensureReadiness(state, input, createReadiness)
              return collectReadinessBlockers(readiness.rollout)
            },
            run: async ({input, state}: {input: ResetRunOptions; state: ResetState}) => {
              const readiness = await ensureReadiness(state, input, createReadiness)
              return {
                data: {
                  selectedSuites: readiness.canary.selectedSuites,
                  success: readiness.success,
                },
                detail: `Post-reset readiness completed for ${context.target.name}.`,
              }
            },
            title: 'Inspect post-reset readiness',
            warnings: async ({input, state}: {input: ResetRunOptions; state: ResetState}) => collectReadinessWarnings(
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

      const result = {
        automation: automation.summary,
        checklist: context.checklist,
        network: context.network,
        profile: context.profile,
        readiness: stateRef?.readiness,
        resetExpectation: context.network.resetExpectation,
        rollout,
        success: rollout.success,
        target: context.target,
      }

      await persistDiagnosticsAuditRecord({
        createAuditStore,
        projectDir: options.projectDir,
        record: createResetAuditRecord(result),
      })

      return result
    },
  }
}

export const createResetHelper = createResetRunner

async function resolveResetTargetContext(
  options: ResetRunOptions,
  resolveRuntime: () => ProfileRuntimeResolver,
): Promise<ResetTargetContext> {
  if (options.profileName) {
    if (!options.config) {
      throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
        suggestion: 'Provide a loaded cantonctl config when running a profile-based reset workflow.',
      })
    }

    const runtime = await resolveRuntime().resolve({config: options.config, profileName: options.profileName})
    const policy = resolveNetworkPolicy({networkName: runtime.networkName, profile: runtime.profile})
    return {
      checklist: toChecklist(policy),
      network: toNetworkSummary(runtime.networkName, policy),
      profile: {
        kind: runtime.profile.kind,
        name: runtime.profile.name,
        network: runtime.networkName,
        tier: policy.tier,
      },
      runtimeProfile: runtime.profile,
      target: {
        kind: 'profile',
        name: runtime.profile.name,
      },
    }
  }

  if (!options.network) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      suggestion: 'Choose either --profile or --network for reset checklist.',
    })
  }

  const policy = resolveNetworkPolicy({
    networkName: options.network,
    profile: {kind: 'remote-validator', name: options.network},
  })

  return {
    checklist: toChecklist(policy),
    network: toNetworkSummary(options.network, policy),
    target: {
      kind: 'network',
      name: options.network,
    },
  }
}

function describeResetAutomation(
  profile: ResetTargetContext['runtimeProfile'],
): ResetAutomationSupport {
  if (profile && isLocalnetLifecycleProfile(profile)) {
    return {
      available: true,
      summary: {
        available: true,
        detail:
          'cantonctl can cycle and validate the official LocalNet workspace after you confirm the reset boundary and provide --workspace.',
        kind: 'localnet-cycle',
        requiresWorkspace: true,
      },
    }
  }

  return {
    available: false,
    summary: {
      available: false,
      detail: profile
        ? 'This target does not expose a supported reset apply primitive. cantonctl keeps the reset workflow manual-only.'
        : 'Network-tier reset planning is advisory and boundary-aware. Remote reset execution remains manual.',
      kind: 'manual-only',
      requiresWorkspace: false,
    },
  }
}

function toChecklist(policy: NetworkPolicy): ResetChecklistItem[] {
  return policy.checklist.map(text => ({
    severity: policy.resetExpectation === 'no-resets-expected' ? 'info' as const : 'warn' as const,
    text,
  }))
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

function summarizeResetPolicy(context: ResetTargetContext): string {
  return `${context.target.name} carries ${context.checklist.length} reset checklist item(s) with ${context.network.displayName} expectations.`
}

function collectResetWarnings(context: ResetTargetContext): ControlPlaneWarning[] {
  return context.network.reminders.map((detail, index) => ({
    code: `network-reminder-${index}`,
    detail,
  }))
}

function collectResetBlockers(options: {
  automation: ResetAutomationSupport
  mode: ControlPlaneOperationMode
  workspace?: string
}): ControlPlaneBlocker[] {
  const blockers: ControlPlaneBlocker[] = []

  if (options.mode !== 'plan' && options.automation.available && !options.workspace) {
    blockers.push({
      code: 'workspace-required',
      detail: 'Provide --workspace to let cantonctl cycle the official LocalNet workspace in live reset modes.',
    })
  }

  if (options.mode === 'apply' && !options.automation.available) {
    blockers.push({
      code: 'apply-unsupported',
      detail: 'Reset apply is not supported for this target. Follow the emitted manual runbook instead.',
    })
  }

  return blockers
}

function summarizeResetValidation(
  context: ResetTargetContext,
  automation: ResetAutomationSupport,
  workspace: string | undefined,
): string {
  if (automation.available && workspace) {
    return `Reset workflow is ready to use ${workspace} for the supported LocalNet cycle step.`
  }

  return 'Reset workflow stays manual-only for this target.'
}

function createResetRunbook(
  context: ResetTargetContext,
  automation: ResetAutomationSupport,
): ControlPlaneRunbookItem[] {
  const owner = context.network.tier === 'local' ? 'official-stack' as const : 'operator' as const
  const items = context.checklist.map((item, index) => ({
    code: `network-checklist-${index}`,
    detail: item.text,
    owner,
    title: `Review ${context.network.displayName} reset expectation`,
  }))

  if (automation.available) {
    items.unshift({
      code: 'localnet-reset-boundary',
      detail:
        'Decide whether local state should be discarded or preserved inside the official LocalNet workspace before cantonctl performs the supported cycle step.',
      owner: 'official-stack',
      title: 'Confirm LocalNet reset boundary',
    })
  } else if (context.profile) {
    items.unshift({
      code: 'manual-reset-runbook',
      detail: 'Use the owning runtime or operator runbook to perform the reset. cantonctl will not hide remote or destructive side effects.',
      owner,
      title: 'Run the owning reset procedure',
    })
  }

  return items
}

async function ensureReadiness(
  state: ResetState,
  input: ResetRunOptions,
  createReadiness: () => ReadinessRunner,
): Promise<ReadinessReport> {
  if (!state.readiness) {
    state.readiness = await createReadiness().run({
      config: input.config!,
      profileName: input.profileName!,
      signal: input.signal,
    })
  }

  return state.readiness
}

function collectReadinessBlockers(rollout: ControlPlaneOperationResult): ControlPlaneBlocker[] {
  return rollout.steps
    .filter(step => step.status === 'blocked' || step.status === 'failed')
    .flatMap((step) => step.blockers.length > 0
      ? step.blockers
      : [{
        code: `readiness-${step.id}`,
        detail: step.detail ?? `${step.title} blocked the reset workflow.`,
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
