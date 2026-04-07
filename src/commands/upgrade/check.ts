import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {createDefaultLocalnet} from '../../lib/lifecycle/localnet-cycle.js'
import {createUpgradeRunner, type UpgradeCheckReport, type UpgradeRunner} from '../../lib/lifecycle/upgrade.js'
import {createOutput, type OutputWriter} from '../../lib/output.js'
import {createReadinessRunner, type ReadinessRunner} from '../../lib/readiness.js'

export default class UpgradeCheck extends Command {
  static override description = 'Plan or execute an upgrade workflow for a resolved profile'

  static override examples = [
    '<%= config.bin %> upgrade check --profile splice-devnet',
    '<%= config.bin %> upgrade check --profile splice-localnet --workspace ../quickstart --dry-run',
    '<%= config.bin %> upgrade check --profile splice-mainnet --json',
  ]

  static override flags = {
    apply: Flags.boolean({
      default: false,
      description: 'Execute supported upgrade automation in apply mode',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Execute live upgrade validation without mutating steps',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    plan: Flags.boolean({
      default: false,
      description: 'Produce an upgrade plan without live runtime actions',
    }),
    profile: Flags.string({
      description: 'Profile name (defaults to default-profile)',
    }),
    workspace: Flags.string({
      description: 'Path to the official LocalNet workspace for supported local upgrade automation',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(UpgradeCheck)
    const out = createOutput({json: flags.json})

    try {
      const report = await this.createUpgradeRunner().run({
        config: await this.loadProjectConfig(),
        mode: resolveUpgradeMode(flags),
        profileName: flags.profile,
        projectDir: process.cwd(),
        workspace: flags.workspace,
      })

      if (!flags.json) {
        renderUpgradeWorkflow(out, report)
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

  protected createUpgradeRunner(): UpgradeRunner {
    return createUpgradeRunner({
      createLocalnet: () => this.createLocalnet(),
      createReadinessRunner: () => this.createReadinessRunner(),
    })
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

export function renderUpgradeWorkflow(
  out: Pick<OutputWriter, 'error' | 'info' | 'log' | 'success' | 'table' | 'warn'>,
  report: UpgradeCheckReport,
): void {
  out.log(`Profile: ${report.profile.name} (${report.profile.tier})`)
  out.log(`Mode: ${report.rollout.mode}`)
  out.log(`Auth: ${report.auth.mode} (${report.auth.source})`)
  out.log(`Automation: ${report.automation.kind}`)
  out.log(`Reset expectation: ${report.network.resetExpectation}`)

  out.log('')
  out.table(
    ['Severity', 'Code', 'Message'],
    report.advisories.map(advisory => [advisory.severity, advisory.code, advisory.message]),
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
    out.success(`Upgrade ${report.rollout.mode === 'plan' ? 'plan' : 'workflow'} completed.`)
  } else {
    out.error('Upgrade workflow found blocking issues.')
  }
}

function resolveUpgradeMode(flags: {
  apply: boolean
  'dry-run': boolean
  plan: boolean
}): 'apply' | 'dry-run' | 'plan' {
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
