import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {createDefaultLocalnet} from '../../lib/lifecycle/localnet-cycle.js'
import {createResetRunner, type ResetChecklistReport, type ResetRunner} from '../../lib/lifecycle/reset.js'
import {createOutput, type OutputWriter} from '../../lib/output.js'
import {createReadinessRunner, type ReadinessRunner} from '../../lib/readiness.js'

export default class ResetChecklist extends Command {
  static override description = 'Plan or execute a reset workflow for a network tier or resolved profile'

  static override examples = [
    '<%= config.bin %> reset checklist --network devnet',
    '<%= config.bin %> reset checklist --profile splice-localnet --workspace ../quickstart --apply',
    '<%= config.bin %> reset checklist --network mainnet --json',
  ]

  static override flags = {
    apply: Flags.boolean({
      default: false,
      description: 'Execute supported reset automation in apply mode',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Execute live reset validation without mutating steps',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    network: Flags.string({
      description: 'Network tier',
      options: ['devnet', 'testnet', 'mainnet'],
    }),
    plan: Flags.boolean({
      default: false,
      description: 'Produce a reset plan without live runtime actions',
    }),
    profile: Flags.string({
      description: 'Resolved profile name for profile-aware reset workflows',
    }),
    workspace: Flags.string({
      description: 'Path to the official LocalNet workspace for supported local reset automation',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ResetChecklist)
    const out = createOutput({json: flags.json})

    try {
      const config = flags.profile ? await this.loadProjectConfig() : undefined
      const report = await this.createResetRunner().run({
        config,
        mode: resolveResetMode(flags),
        network: flags.network as 'devnet' | 'mainnet' | 'testnet' | undefined,
        profileName: flags.profile,
        projectDir: process.cwd(),
        workspace: flags.workspace,
      })

      if (!flags.json) {
        renderResetWorkflow(out, report)
      }

      out.result({
        data: flags.json ? report : undefined,
        success: report.success,
      })

      if (!report.success) {
        this.exit(1)
      }
    } catch (error) {
      if (error instanceof CantonctlError) {
        out.result({
          error: {code: error.code, message: error.message, suggestion: error.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw error
    }
  }

  protected createLocalnet() {
    return createDefaultLocalnet()
  }

  protected createReadinessRunner(): ReadinessRunner {
    return createReadinessRunner()
  }

  protected createResetRunner(): ResetRunner {
    return createResetRunner({
      createLocalnet: () => this.createLocalnet(),
      createReadinessRunner: () => this.createReadinessRunner(),
    })
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

export function renderResetWorkflow(
  out: Pick<OutputWriter, 'error' | 'info' | 'log' | 'success' | 'table' | 'warn'>,
  report: ResetChecklistReport,
): void {
  out.log(`Target: ${report.target.name} (${report.target.kind})`)
  out.log(`Mode: ${report.rollout.mode}`)
  out.log(`Reset expectation: ${report.resetExpectation}`)
  out.log(`Automation: ${report.automation.kind}`)

  out.log('')
  out.table(
    ['Severity', 'Checklist'],
    report.checklist.map(item => [item.severity, item.text]),
  )

  out.log('')
  out.table(
    ['Step', 'Status', 'Owner', 'Detail'],
    report.rollout.steps.map(step => [
      step.title,
      step.status,
      step.owner,
      step.detail ?? step.blockers[0]?.detail ?? '-',
    ]),
  )

  for (const reminder of report.network.reminders) {
    out.warn(`Reminder: ${reminder}`)
  }

  for (const step of report.rollout.steps) {
    for (const warning of step.warnings) {
      out.warn(`${step.title}: ${warning.detail}`)
    }
    for (const item of step.runbook) {
      out.info(`${item.title}: ${item.detail}`)
    }
  }

  if (report.success) {
    out.success(`Reset ${report.rollout.mode === 'plan' ? 'plan' : 'workflow'} completed.`)
  } else {
    out.error('Reset workflow found blocking issues.')
  }
}

function resolveResetMode(flags: {
  apply: boolean
  'dry-run': boolean
  network?: string
  plan: boolean
  profile?: string
}): 'apply' | 'dry-run' | 'plan' {
  if (Boolean(flags.network) === Boolean(flags.profile)) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      suggestion: 'Choose exactly one of --network or --profile.',
    })
  }

  const selectedModes = [
    flags.plan ? 'plan' : undefined,
    flags['dry-run'] ? 'dry-run' : undefined,
    flags.apply ? 'apply' : undefined,
  ].filter(Boolean)

  if (selectedModes.length > 1) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      suggestion: 'Choose only one of --plan, --dry-run, or --apply.',
    })
  }

  if (flags.apply) {
    return 'apply'
  }

  if (flags['dry-run']) {
    return 'dry-run'
  }

  return 'plan'
}
