import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {createOutput, type OutputWriter} from '../../lib/output.js'
import {
  createPromotionRunner,
  type PromotionRolloutResult,
  type PromotionRunner,
} from '../../lib/promotion-rollout.js'

export default class PromoteDiff extends Command {
  static override description = 'Plan or execute a profile-to-profile promotion rollout'

  static override examples = [
    '<%= config.bin %> promote diff --from splice-devnet --to splice-testnet',
    '<%= config.bin %> promote diff --from splice-devnet --to splice-testnet --dry-run',
    '<%= config.bin %> promote diff --from splice-testnet --to splice-mainnet --apply --json',
  ]

  static override flags = {
    apply: Flags.boolean({
      default: false,
      description: 'Execute the live rollout gate in apply mode',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Execute the live rollout gate without mutating steps',
    }),
    from: Flags.string({
      description: 'Source profile',
      required: true,
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    plan: Flags.boolean({
      default: false,
      description: 'Produce a promotion rollout plan without live runtime checks',
    }),
    to: Flags.string({
      description: 'Target profile',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(PromoteDiff)
    const out = createOutput({json: flags.json})

    try {
      const report = await this.createPromotionRunner().run({
        config: await this.loadProjectConfig(),
        fromProfile: flags.from,
        mode: resolvePromotionMode(flags),
        projectDir: process.cwd(),
        toProfile: flags.to,
      })

      if (!flags.json) {
        renderPromotionRollout(out, report)
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

  protected createPromotionRunner(): PromotionRunner {
    return createPromotionRunner()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

export function renderPromotionRollout(
  out: Pick<OutputWriter, 'error' | 'info' | 'log' | 'success' | 'table' | 'warn'>,
  report: PromotionRolloutResult,
): void {
  out.log(`From: ${report.from.name} (${report.from.tier})`)
  out.log(`To: ${report.to.name} (${report.to.tier})`)
  out.log(`Mode: ${report.rollout.mode}`)
  if (report.preflight) {
    out.log(`Target preflight: ${report.preflight.success ? 'pass' : 'fail'}`)
  }
  if (report.readiness) {
    out.log(`Target readiness: ${report.readiness.success ? 'pass' : 'fail'}`)
  }

  out.log('')
  out.table(
    ['Service', 'Change', 'From', 'To'],
    report.services.map(service => [
      service.name,
      service.change,
      service.from ?? '-',
      service.to ?? '-',
    ]),
  )

  if (report.advisories.length > 0) {
    out.log('')
    out.table(
      ['Severity', 'Code', 'Message'],
      report.advisories.map(advisory => [advisory.severity, advisory.code, advisory.message]),
    )
  }

  if (report.rollout.steps.length > 0) {
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
    out.success(`Promotion ${report.rollout.mode === 'plan' ? 'plan' : 'rollout'} completed.`)
  } else {
    out.error('Promotion rollout found blocking issues.')
  }
}

function resolvePromotionMode(flags: {
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
