import type {CanaryCheck} from './canary/run.js'
import type {ControlPlaneReconcileAction} from './control-plane-drift.js'
import type {
  ControlPlaneBlocker,
  ControlPlaneOperationResult,
  ControlPlaneOperationSummary,
  ControlPlaneRunbookItem,
  ControlPlaneStepOwner,
  ControlPlaneStepResult,
  ControlPlaneWarning,
} from './control-plane-operation.js'
import type {PreflightCheck, PreflightReport} from './preflight/output.js'

export function createPreflightRolloutContract(report: Pick<PreflightReport, 'checks' | 'profile' | 'reconcile'>): ControlPlaneOperationResult {
  const steps = [
    ...report.checks.map((check, index) => createPreflightCheckStep(check, index)),
    ...report.reconcile.supportedActions.map((action, index) => createSupportedActionStep(action, index)),
    ...report.reconcile.runbook.map((action, index) => createRunbookStep(action, index)),
  ]

  return createStaticOperation({
    description: `Read-only preflight gate for ${report.profile.name}.`,
    operation: 'preflight',
    steps,
  })
}

export function createReadinessRolloutContract(options: {
  canary: {checks: CanaryCheck[]}
  preflight: Pick<PreflightReport, 'profile' | 'rollout'>
}): ControlPlaneOperationResult {
  const steps = [
    ...options.preflight.rollout.steps.map(step => ({...step})),
    ...options.canary.checks.map((check, index) => createCanaryCheckStep(check, index)),
  ]

  return createStaticOperation({
    description: `Read-only readiness gate for ${options.preflight.profile.name}.`,
    operation: 'readiness',
    steps,
  })
}

function createStaticOperation(options: {
  description: string
  operation: string
  steps: ControlPlaneStepResult[]
}): ControlPlaneOperationResult {
  const summary = summarizeSteps(options.steps)

  return {
    description: options.description,
    mode: 'dry-run',
    operation: options.operation,
    partial: false,
    resume: {
      canResume: false,
      checkpoints: [],
      completedStepIds: [],
      nextStepId: undefined,
    },
    steps: options.steps,
    success: summary.blocked === 0 && summary.failed === 0,
    summary,
  }
}

function summarizeSteps(steps: ControlPlaneStepResult[]): ControlPlaneOperationSummary {
  return {
    blocked: steps.filter(step => step.status === 'blocked').length,
    completed: steps.filter(step => step.status === 'completed').length,
    dryRun: steps.filter(step => step.status === 'dry-run').length,
    failed: steps.filter(step => step.status === 'failed').length,
    manual: steps.filter(step => step.status === 'manual').length,
    pending: steps.filter(step => step.status === 'pending').length,
    ready: steps.filter(step => step.status === 'ready').length,
    warned: steps.reduce((count, step) => count + step.warnings.length, 0),
  }
}

function createPreflightCheckStep(check: PreflightCheck, index: number): ControlPlaneStepResult {
  return {
    blockers: check.status === 'fail'
      ? [createBlocker(`${check.category}-${slugify(check.name)}-failed`, check.detail)]
      : [],
    data: {
      category: check.category,
      endpoint: check.endpoint,
      status: check.status,
    },
    dependencies: [],
    detail: check.detail,
    effect: 'read',
    id: `preflight-${index}-${slugify(check.name)}`,
    owner: 'cantonctl',
    postconditions: [],
    preconditions: [],
    runbook: [],
    status: check.status === 'fail' ? 'blocked' : 'completed',
    title: check.name,
    warnings: check.status === 'warn'
      ? [createWarning(`${check.category}-${slugify(check.name)}-warning`, check.detail)]
      : [],
  }
}

function createCanaryCheckStep(check: CanaryCheck, index: number): ControlPlaneStepResult {
  return {
    blockers: check.status === 'fail'
      ? [createBlocker(`${slugify(check.suite)}-canary-failed`, check.detail)]
      : [],
    data: {
      endpoint: check.endpoint,
      status: check.status,
      suite: check.suite,
    },
    dependencies: [],
    detail: check.detail,
    effect: 'read',
    id: `canary-${index}-${slugify(check.suite)}`,
    owner: 'cantonctl',
    postconditions: [],
    preconditions: [],
    runbook: [],
    status: check.status === 'fail' ? 'blocked' : 'completed',
    title: `Canary ${check.suite}`,
    warnings: check.warnings.map((warning, warningIndex) => createWarning(
      `${slugify(check.suite)}-warning-${warningIndex}`,
      warning,
    )),
  }
}

function createSupportedActionStep(action: ControlPlaneReconcileAction, index: number): ControlPlaneStepResult {
  return {
    blockers: [],
    data: {
      command: action.command,
      targets: action.targets,
    },
    dependencies: [],
    detail: action.command
      ? `${action.detail} Command: ${action.command}`
      : action.detail,
    effect: 'write',
    id: `supported-action-${index}-${slugify(action.code)}`,
    owner: action.owner,
    postconditions: [],
    preconditions: [],
    runbook: [],
    status: 'ready',
    title: action.title,
    warnings: [],
  }
}

function createRunbookStep(action: ControlPlaneReconcileAction, index: number): ControlPlaneStepResult {
  return {
    blockers: [],
    data: {
      command: action.command,
      targets: action.targets,
    },
    dependencies: [],
    detail: action.detail,
    effect: 'write',
    id: `manual-action-${index}-${slugify(action.code)}`,
    owner: action.owner,
    postconditions: [],
    preconditions: [],
    runbook: [createRunbookItem(action)],
    status: 'manual',
    title: action.title,
    warnings: [],
  }
}

function createRunbookItem(action: ControlPlaneReconcileAction): ControlPlaneRunbookItem {
  return {
    code: action.code,
    detail: action.command ? `${action.detail} Command: ${action.command}` : action.detail,
    owner: action.owner,
    title: action.title,
  }
}

function createBlocker(code: string, detail: string): ControlPlaneBlocker {
  return {code, detail}
}

function createWarning(code: string, detail: string): ControlPlaneWarning {
  return {code, detail}
}

export function createPromotionRunbookItem(options: {
  code: string
  detail: string
  owner?: ControlPlaneStepOwner
  title: string
}): ControlPlaneRunbookItem {
  return {
    code: options.code,
    detail: options.detail,
    owner: options.owner ?? 'official-stack',
    title: options.title,
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
