import * as fs from 'node:fs'
import * as path from 'node:path'

import type {
  ControlPlaneOperationMode,
  ControlPlaneOperationResult,
  ControlPlaneStepEffect,
  ControlPlaneStepOwner,
  ControlPlaneStepStatus,
} from '../control-plane-operation.js'
import type {DeployResult} from '../deployer.js'
import type {PromotionRolloutResult} from '../promotion-rollout.js'
import type {ResetChecklistReport} from '../lifecycle/reset.js'
import type {UpgradeCheckReport} from '../lifecycle/upgrade.js'

const REDACTED = '[REDACTED]'
const SENSITIVE_KEYS = [
  /token$/i,
  /secret$/i,
  /password$/i,
  /authorization$/i,
  /cookie$/i,
] as const

export interface DiagnosticsAuditStep {
  blockers: Array<{code: string; detail: string}>
  detail?: string
  effect: ControlPlaneStepEffect
  id: string
  owner: ControlPlaneStepOwner
  runbook: Array<{code: string; detail: string; owner: ControlPlaneStepOwner; title: string}>
  status: ControlPlaneStepStatus
  title: string
  warnings: Array<{code: string; detail: string}>
}

export interface DiagnosticsAuditRecord {
  command: 'deploy' | 'promote diff' | 'reset checklist' | 'upgrade check'
  context: Record<string, unknown>
  mode: ControlPlaneOperationMode
  recordedAt: string
  rollout: {
    operation: string
    partial: boolean
    steps: DiagnosticsAuditStep[]
    success: boolean
    summary: ControlPlaneOperationResult['summary']
  }
  schemaVersion: 1
  success: boolean
}

export interface DiagnosticsAuditStore {
  readLastOperation(options: {projectDir: string}): Promise<DiagnosticsAuditRecord | undefined>
  writeLastOperation(options: {projectDir: string; record: DiagnosticsAuditRecord}): Promise<{file: string}>
}

export async function persistDiagnosticsAuditRecord(options: {
  createAuditStore?: () => DiagnosticsAuditStore
  projectDir?: string
  record: DiagnosticsAuditRecord
}): Promise<void> {
  try {
    await (options.createAuditStore ?? (() => createDiagnosticsAuditStore()))().writeLastOperation({
      projectDir: options.projectDir ?? process.cwd(),
      record: options.record,
    })
  } catch {
    // Diagnostics audit persistence is support-oriented and must not block the primary workflow.
  }
}

export function createDiagnosticsAuditStore(
  deps: {
    fs?: Pick<typeof fs, 'promises' | 'readFileSync' | 'writeFileSync'>
    path?: typeof path
  } = {},
): DiagnosticsAuditStore {
  const fsImpl = deps.fs ?? fs
  const pathImpl = deps.path ?? path

  return {
    async readLastOperation(options) {
      try {
        return JSON.parse(
          fsImpl.readFileSync(lastOperationPath(options.projectDir, pathImpl), 'utf8'),
        ) as DiagnosticsAuditRecord
      } catch {
        return undefined
      }
    },

    async writeLastOperation(options) {
      const file = lastOperationPath(options.projectDir, pathImpl)
      await fsImpl.promises.mkdir(pathImpl.dirname(file), {recursive: true})
      fsImpl.writeFileSync(file, `${JSON.stringify(redactSupportArtifact(options.record), null, 2)}\n`, 'utf8')
      return {file}
    },
  }
}

export function createDeployAuditRecord(
  result: DeployResult,
  recordedAt = new Date().toISOString(),
): DiagnosticsAuditRecord {
  return createAuditRecord({
    command: 'deploy',
    context: {
      artifact: result.artifact,
      auth: result.auth,
      fanOut: result.fanOut,
      profile: result.profile,
      requestedTarget: result.requestedTarget,
      targets: result.targets.map(target => ({
        baseUrl: target.baseUrl,
        endpointSource: target.endpointSource,
        id: target.id,
        label: target.label,
        managementClass: target.managementClass,
        packageId: target.packageId,
        participant: target.participant,
        status: target.status,
      })),
    },
    recordedAt,
    rollout: result,
  })
}

export function createPromotionAuditRecord(
  result: PromotionRolloutResult,
  recordedAt = new Date().toISOString(),
): DiagnosticsAuditRecord {
  return createAuditRecord({
    command: 'promote diff',
    context: {
      advisories: result.advisories,
      from: result.from,
      serviceChanges: result.services.filter(service => service.change !== 'unchanged'),
      to: result.to,
    },
    recordedAt,
    rollout: result.rollout,
  })
}

export function createResetAuditRecord(
  result: ResetChecklistReport,
  recordedAt = new Date().toISOString(),
): DiagnosticsAuditRecord {
  return createAuditRecord({
    command: 'reset checklist',
    context: {
      automation: result.automation,
      checklist: result.checklist,
      network: result.network,
      profile: result.profile,
      readiness: result.readiness
        ? {
          selectedSuites: result.readiness.canary.selectedSuites,
          success: result.readiness.success,
          summary: result.readiness.rollout.summary,
        }
        : undefined,
      resetExpectation: result.resetExpectation,
      target: result.target,
    },
    recordedAt,
    rollout: result.rollout,
  })
}

export function createUpgradeAuditRecord(
  result: UpgradeCheckReport,
  recordedAt = new Date().toISOString(),
): DiagnosticsAuditRecord {
  return createAuditRecord({
    command: 'upgrade check',
    context: {
      advisories: result.advisories,
      automation: result.automation,
      auth: result.auth,
      compatibility: result.compatibility,
      migration: result.migration,
      network: result.network,
      profile: result.profile,
      readiness: result.readiness
        ? {
          selectedSuites: result.readiness.canary.selectedSuites,
          success: result.readiness.success,
          summary: result.readiness.rollout.summary,
        }
        : undefined,
    },
    recordedAt,
    rollout: result.rollout,
  })
}

export function redactSupportArtifact<T>(value: T): T {
  return redactValue(value) as T
}

function createAuditRecord(options: {
  command: DiagnosticsAuditRecord['command']
  context: Record<string, unknown>
  recordedAt: string
  rollout: Pick<ControlPlaneOperationResult, 'mode' | 'operation' | 'partial' | 'steps' | 'success' | 'summary'>
}): DiagnosticsAuditRecord {
  return {
    command: options.command,
    context: options.context,
    mode: options.rollout.mode,
    recordedAt: options.recordedAt,
    rollout: {
      operation: options.rollout.operation,
      partial: options.rollout.partial,
      steps: options.rollout.steps.map(step => ({
        blockers: step.blockers.map(blocker => ({...blocker})),
        detail: step.detail,
        effect: step.effect,
        id: step.id,
        owner: step.owner,
        runbook: step.runbook.map(item => ({...item})),
        status: step.status,
        title: step.title,
        warnings: step.warnings.map(warning => ({...warning})),
      })),
      success: options.rollout.success,
      summary: {...options.rollout.summary},
    },
    schemaVersion: 1,
    success: options.rollout.success,
  }
}

function lastOperationPath(projectDir: string, pathImpl: typeof path): string {
  return pathImpl.join(projectDir, '.cantonctl', 'control-plane', 'last-operation.json')
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item))
  }

  if (typeof value === 'string') {
    return /^Bearer\s+/i.test(value) ? REDACTED : value
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactValue(entry),
    ]),
  )
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.some(pattern => pattern.test(key))
}
