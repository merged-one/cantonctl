import {CantonctlError} from './errors.js'

export type ControlPlaneOperationMode = 'apply' | 'dry-run' | 'plan'
export type ControlPlaneStepEffect = 'read' | 'write'
export type ControlPlaneStepOwner = 'cantonctl' | 'official-stack' | 'operator'
export type ControlPlaneStepStatus =
  | 'blocked'
  | 'completed'
  | 'dry-run'
  | 'failed'
  | 'manual'
  | 'pending'
  | 'ready'

export interface ControlPlanePrecondition {
  code: string
  detail: string
  status: 'block' | 'pass'
}

export interface ControlPlaneWarning {
  code: string
  detail: string
}

export interface ControlPlaneBlocker {
  code: string
  detail: string
}

export interface ControlPlanePostcondition {
  code: string
  detail: string
  status: 'fail' | 'pass' | 'warn'
}

export interface ControlPlaneRunbookItem {
  code: string
  detail: string
  owner: ControlPlaneStepOwner
  title: string
}

export interface ControlPlaneSerializedError {
  code?: string
  context?: Record<string, unknown>
  docsUrl?: string
  message: string
  suggestion?: string
}

export interface ControlPlaneStepResult {
  blockers: ControlPlaneBlocker[]
  checkpoint?: Record<string, unknown>
  data?: Record<string, unknown>
  dependencies: string[]
  detail?: string
  effect: ControlPlaneStepEffect
  error?: ControlPlaneSerializedError
  id: string
  owner: ControlPlaneStepOwner
  postconditions: ControlPlanePostcondition[]
  preconditions: ControlPlanePrecondition[]
  runbook: ControlPlaneRunbookItem[]
  status: ControlPlaneStepStatus
  title: string
  warnings: ControlPlaneWarning[]
}

export interface ControlPlaneOperationSummary {
  blocked: number
  completed: number
  dryRun: number
  failed: number
  manual: number
  pending: number
  ready: number
  warned: number
}

export interface ControlPlaneResumeState {
  canResume: boolean
  checkpoints: Array<{checkpoint: Record<string, unknown>; stepId: string}>
  completedStepIds: string[]
  nextStepId?: string
}

export interface ControlPlaneOperationResult {
  description?: string
  mode: ControlPlaneOperationMode
  operation: string
  partial: boolean
  resume: ControlPlaneResumeState
  steps: ControlPlaneStepResult[]
  success: boolean
  summary: ControlPlaneOperationSummary
}

export interface ControlPlaneStepContext<TInput, TState> {
  completedSteps: ControlPlaneStepResult[]
  input: TInput
  mode: ControlPlaneOperationMode
  signal?: AbortSignal
  state: TState
}

export interface ControlPlaneStepRunResult {
  checkpoint?: Record<string, unknown>
  data?: Record<string, unknown>
  detail?: string
}

type ControlPlaneEvaluator<TInput, TState, TResult> =
  (context: ControlPlaneStepContext<TInput, TState>) => Promise<TResult> | TResult

export interface ControlPlaneStep<TInput, TState> {
  blockers?: ControlPlaneEvaluator<TInput, TState, ControlPlaneBlocker[]>
  dependsOn?: string[]
  effect?: ControlPlaneStepEffect
  id: string
  owner?: ControlPlaneStepOwner
  postconditions?: ControlPlaneEvaluator<TInput, TState, ControlPlanePostcondition[]>
  preconditions?: ControlPlaneEvaluator<TInput, TState, ControlPlanePrecondition[]>
  run?: ControlPlaneEvaluator<TInput, TState, ControlPlaneStepRunResult | void>
  runbook?: ControlPlaneEvaluator<TInput, TState, ControlPlaneRunbookItem[]>
  title: string
  warnings?: ControlPlaneEvaluator<TInput, TState, ControlPlaneWarning[]>
}

export interface ControlPlaneOperationDefinition<TInput, TState> {
  createState?: (input: TInput) => TState
  description?: string
  operation: string
  steps: Array<ControlPlaneStep<TInput, TState>>
}

export interface ControlPlaneOperationExecuteOptions<TInput> {
  input: TInput
  mode?: ControlPlaneOperationMode
  signal?: AbortSignal
}

export interface ControlPlaneOperationRunner<TInput> {
  apply(options: Omit<ControlPlaneOperationExecuteOptions<TInput>, 'mode'>): Promise<ControlPlaneOperationResult>
  dryRun(options: Omit<ControlPlaneOperationExecuteOptions<TInput>, 'mode'>): Promise<ControlPlaneOperationResult>
  execute(options: ControlPlaneOperationExecuteOptions<TInput>): Promise<ControlPlaneOperationResult>
  plan(options: Omit<ControlPlaneOperationExecuteOptions<TInput>, 'mode'>): Promise<ControlPlaneOperationResult>
}

export function createControlPlaneOperationRunner<TInput, TState>(
  definition: ControlPlaneOperationDefinition<TInput, TState>,
): ControlPlaneOperationRunner<TInput> {
  return {
    apply(options) {
      return executeOperation(definition, {...options, mode: 'apply'})
    },

    dryRun(options) {
      return executeOperation(definition, {...options, mode: 'dry-run'})
    },

    execute(options) {
      return executeOperation(definition, options)
    },

    plan(options) {
      return executeOperation(definition, {...options, mode: 'plan'})
    },
  }
}

async function executeOperation<TInput, TState>(
  definition: ControlPlaneOperationDefinition<TInput, TState>,
  options: ControlPlaneOperationExecuteOptions<TInput>,
): Promise<ControlPlaneOperationResult> {
  const mode = options.mode ?? 'apply'
  const state = definition.createState
    ? definition.createState(options.input)
    : {} as TState
  const completedSteps: ControlPlaneStepResult[] = []
  let stopReason: {id: string; status: 'blocked' | 'failed'} | undefined

  throwIfAborted(options.signal)

  for (const step of definition.steps) {
    if (mode !== 'plan' && stopReason) {
      completedSteps.push(createPendingStep(step, stopReason))
      continue
    }

    try {
      throwIfAborted(options.signal)

      const context = {
        completedSteps,
        input: options.input,
        mode,
        signal: options.signal,
        state,
      } satisfies ControlPlaneStepContext<TInput, TState>

      const preconditions = await evaluate(step.preconditions, context)
      const warnings = await evaluate(step.warnings, context)
      const blockers = await evaluate(step.blockers, context)
      const runbook = await evaluate(step.runbook, context)
      const unresolvedDependencies = mode === 'plan'
        ? []
        : (step.dependsOn ?? []).filter(
            dependency => !completedSteps.some(
              completed => completed.id === dependency && completed.status === 'completed',
            ),
          )

      if (mode === 'plan') {
        completedSteps.push({
          blockers,
          dependencies: step.dependsOn ?? [],
          effect: step.effect ?? 'read',
          id: step.id,
          owner: step.owner ?? 'cantonctl',
          postconditions: [],
          preconditions,
          runbook,
          status: runbook.length > 0 && !step.run
            ? 'manual'
            : hasBlockingPrecondition(preconditions) || blockers.length > 0
              ? 'blocked'
              : 'ready',
          title: step.title,
          warnings,
        })
        continue
      }

      if (unresolvedDependencies.length > 0) {
        completedSteps.push({
          blockers,
          dependencies: unresolvedDependencies,
          detail: `Waiting for ${formatDependencies(unresolvedDependencies)} before "${step.title}".`,
          effect: step.effect ?? 'read',
          id: step.id,
          owner: step.owner ?? 'cantonctl',
          postconditions: [],
          preconditions,
          runbook,
          status: 'pending',
          title: step.title,
          warnings,
        })
        continue
      }

      if (hasBlockingPrecondition(preconditions) || blockers.length > 0) {
        const blockedStep: ControlPlaneStepResult = {
          blockers,
          dependencies: step.dependsOn ?? [],
          effect: step.effect ?? 'read',
          id: step.id,
          owner: step.owner ?? 'cantonctl',
          postconditions: [],
          preconditions,
          runbook,
          status: 'blocked',
          title: step.title,
          warnings,
        }
        completedSteps.push(blockedStep)
        stopReason = {id: step.id, status: 'blocked'}
        continue
      }

      if (runbook.length > 0 && !step.run) {
        completedSteps.push({
          blockers,
          dependencies: step.dependsOn ?? [],
          effect: step.effect ?? 'read',
          id: step.id,
          owner: step.owner ?? 'cantonctl',
          postconditions: [],
          preconditions,
          runbook,
          status: 'manual',
          title: step.title,
          warnings,
        })
        continue
      }

      if (mode === 'dry-run' && (step.effect ?? 'read') === 'write') {
        completedSteps.push({
          blockers,
          dependencies: step.dependsOn ?? [],
          detail: `Skipped mutating step "${step.title}" in dry-run mode.`,
          effect: 'write',
          id: step.id,
          owner: step.owner ?? 'cantonctl',
          postconditions: [],
          preconditions,
          runbook,
          status: 'dry-run',
          title: step.title,
          warnings,
        })
        continue
      }

      const runResult = step.run ? await step.run(context) : undefined
      const postconditions = await evaluate(step.postconditions, context)
      const failedPostconditions = postconditions.filter(postcondition => postcondition.status === 'fail')

      if (failedPostconditions.length > 0) {
        const failedStep: ControlPlaneStepResult = {
          blockers,
          checkpoint: runResult?.checkpoint,
          data: runResult?.data,
          dependencies: step.dependsOn ?? [],
          detail: runResult?.detail,
          effect: step.effect ?? 'read',
          error: {
            message: failedPostconditions.map(postcondition => postcondition.detail).join(' '),
          },
          id: step.id,
          owner: step.owner ?? 'cantonctl',
          postconditions,
          preconditions,
          runbook,
          status: 'failed',
          title: step.title,
          warnings,
        }
        completedSteps.push(failedStep)
        stopReason = {id: step.id, status: 'failed'}
        continue
      }

      completedSteps.push({
        blockers,
        checkpoint: runResult?.checkpoint,
        data: runResult?.data,
        dependencies: step.dependsOn ?? [],
        detail: runResult?.detail,
        effect: step.effect ?? 'read',
        id: step.id,
        owner: step.owner ?? 'cantonctl',
        postconditions,
        preconditions,
        runbook,
        status: 'completed',
        title: step.title,
        warnings,
      })
    } catch (error) {
      if (isAbortFailure(error, options.signal)) {
        throw error
      }

      const failedStep: ControlPlaneStepResult = {
        blockers: [],
        dependencies: step.dependsOn ?? [],
        effect: step.effect ?? 'read',
        error: serializeError(error),
        id: step.id,
        owner: step.owner ?? 'cantonctl',
        postconditions: [],
        preconditions: [],
        runbook: [],
        status: 'failed',
        title: step.title,
        warnings: [],
      }
      completedSteps.push(failedStep)
      if (mode !== 'plan') {
        stopReason = {id: step.id, status: 'failed'}
      }
    }
  }

  return {
    description: definition.description,
    mode,
    operation: definition.operation,
    partial: completedSteps.some(step => step.status === 'completed')
      && completedSteps.some(step => step.status !== 'completed'),
    resume: buildResumeState(completedSteps, mode),
    steps: completedSteps,
    success: !completedSteps.some(step => step.status === 'blocked' || step.status === 'failed'),
    summary: summarizeSteps(completedSteps),
  }
}

function buildResumeState(
  steps: ControlPlaneStepResult[],
  mode: ControlPlaneOperationMode,
): ControlPlaneResumeState {
  const completedStepIds = steps
    .filter(step => step.status === 'completed')
    .map(step => step.id)
  const checkpoints = steps
    .filter(step => step.status === 'completed' && step.checkpoint)
    .map(step => ({checkpoint: step.checkpoint!, stepId: step.id}))
  const nextStepId = mode === 'apply'
    ? steps.find(step => step.status !== 'completed')?.id
    : undefined

  return {
    canResume: mode === 'apply' && completedStepIds.length > 0
      && steps.some(step => step.status === 'blocked' || step.status === 'failed' || step.status === 'pending'),
    checkpoints,
    completedStepIds,
    nextStepId,
  }
}

function createPendingStep<TInput, TState>(
  step: ControlPlaneStep<TInput, TState>,
  stopReason: {id: string; status: 'blocked' | 'failed'},
): ControlPlaneStepResult {
  return {
    blockers: [],
    dependencies: step.dependsOn ?? [],
    detail: `Not attempted after "${stopReason.id}" ${stopReason.status === 'failed' ? 'failed' : 'was blocked'}.`,
    effect: step.effect ?? 'read',
    id: step.id,
    owner: step.owner ?? 'cantonctl',
    postconditions: [],
    preconditions: [],
    runbook: [],
    status: 'pending',
    title: step.title,
    warnings: [],
  }
}

async function evaluate<TInput, TState, TResult>(
  evaluator: ControlPlaneEvaluator<TInput, TState, TResult> | undefined,
  context: ControlPlaneStepContext<TInput, TState>,
): Promise<TResult> {
  if (!evaluator) {
    return [] as TResult
  }

  throwIfAborted(context.signal)
  return evaluator(context)
}

function formatDependencies(dependencies: string[]): string {
  return dependencies.map(dependency => `"${dependency}"`).join(', ')
}

function hasBlockingPrecondition(preconditions: ControlPlanePrecondition[]): boolean {
  return preconditions.some(precondition => precondition.status === 'block')
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted && error === signal.reason) {
    return true
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return true
  }

  return false
}

function serializeError(error: unknown): ControlPlaneSerializedError {
  if (error instanceof CantonctlError) {
    const serialized = error.toJSON()
    return {
      code: serialized.code as string | undefined,
      context: serialized.context as Record<string, unknown> | undefined,
      docsUrl: serialized.docsUrl as string | undefined,
      message: error.message,
      suggestion: serialized.suggestion as string | undefined,
    }
  }

  if (error instanceof Error) {
    return {message: error.message}
  }

  return {message: 'Control-plane operation step failed.'}
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
    warned: steps.reduce(
      (count, step) => count + step.warnings.length + step.postconditions.filter(postcondition => postcondition.status === 'warn').length,
      0,
    ),
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal) {
    return
  }

  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted()
    return
  }

  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('The operation was aborted.')
  }
}
