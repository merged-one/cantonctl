import {
  renderControlPlaneDriftReport,
  type ControlPlaneDriftItem,
  type ControlPlaneDriftReconcilePlan,
} from '../control-plane-drift.js'
import type {ControlPlaneOperationResult} from '../control-plane-operation.js'
import type {OutputWriter} from '../output.js'
import type {ResolvedProfileRuntime} from '../profile-runtime.js'
import {summarizeCredentialSource} from '../profile-runtime.js'
import type {RuntimeInventory} from '../runtime-inventory.js'
import type {NetworkPolicy} from './network-policy.js'

export type PreflightCheckStatus = 'fail' | 'pass' | 'skip' | 'warn'

export interface PreflightCheck {
  category: 'auth' | 'egress' | 'health' | 'profile' | 'scan'
  detail: string
  endpoint?: string
  name: string
  status: PreflightCheckStatus
}

export interface PreflightReport {
  auth: {
    app: {
      credentialSource: ResolvedProfileRuntime['credential']['source']
      envVarName: string
      required: boolean
    }
    credentialSource: ResolvedProfileRuntime['credential']['source']
    envVarName: string
    mode: ResolvedProfileRuntime['auth']['mode']
    operator: {
      credentialSource: ResolvedProfileRuntime['operatorCredential']['source']
      description: string
      envVarName: string
      prerequisites: string[]
      required: boolean
    }
    warnings: string[]
  }
  checks: PreflightCheck[]
  compatibility: {
    failed: number
    passed: number
    warned: number
  }
  drift: ControlPlaneDriftItem[]
  egressIp?: string
  inventory: RuntimeInventory
  network: {
    checklist: string[]
    name: string
    reminders: string[]
    resetExpectation: NetworkPolicy['resetExpectation']
    tier: NetworkPolicy['tier']
  }
  profile: {
    experimental: boolean
    kind: ResolvedProfileRuntime['profile']['kind']
    name: string
  }
  reconcile: ControlPlaneDriftReconcilePlan
  rollout: ControlPlaneOperationResult
  success: boolean
}

export function renderPreflightReport(out: OutputWriter, report: PreflightReport): void {
  out.log(`Profile: ${report.profile.name}`)
  out.log(`Kind: ${report.profile.kind}`)
  out.log(`Network: ${report.network.name} (${report.network.tier})`)
  out.log(`Auth mode: ${report.auth.mode} (${report.auth.credentialSource})`)
  out.log(
    `Operator auth: ${report.auth.operator.required ? 'required' : 'not required'} ` +
    `(${report.auth.operator.credentialSource})`,
  )
  if (report.egressIp) {
    out.log(`Egress IP: ${report.egressIp}`)
  }
  if (report.profile.experimental) {
    out.warn('Profile is marked experimental')
  }
  out.log('')
  out.table(
    ['Check', 'Status', 'Detail'],
    report.checks.map(check => [check.name, check.status, check.detail]),
  )

  renderControlPlaneDriftReport(out, {items: report.drift, reconcile: report.reconcile})

  if (report.network.reminders.length > 0) {
    out.log('')
    for (const reminder of report.network.reminders) {
      out.info(`Reminder: ${reminder}`)
    }
  }

  if (report.auth.warnings.length > 0) {
    out.log('')
    for (const warning of report.auth.warnings) {
      out.warn(warning)
    }
  }

  if (report.auth.operator.prerequisites.length > 0) {
    out.log('')
    for (const prerequisite of report.auth.operator.prerequisites) {
      out.info(`Operator prerequisite: ${prerequisite}`)
    }
  }

  if (report.success) {
    out.success(
      `Preflight passed with ${report.compatibility.warned} compatibility warning${report.compatibility.warned === 1 ? '' : 's'} and ${report.checks.filter(check => check.status === 'warn').length} advisory warning${report.checks.filter(check => check.status === 'warn').length === 1 ? '' : 's'}.`,
    )
  } else {
    out.error('Preflight found blocking issues.')
  }
}

export function summarizePreflightDetail(runtime: ResolvedProfileRuntime): string {
  return `${runtime.profile.name} (${runtime.profile.kind}) using ${summarizeCredentialSource(runtime.credential)}`
}
