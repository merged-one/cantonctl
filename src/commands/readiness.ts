import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {CantonctlError} from '../lib/errors.js'
import {createOutput, type OutputWriter} from '../lib/output.js'
import {createReadinessRunner, type ReadinessReport, type ReadinessRunner} from '../lib/readiness.js'

export default class Readiness extends Command {
  static override description = 'Run the composed readiness gate for a resolved profile'

  static override examples = [
    '<%= config.bin %> readiness --profile splice-devnet',
    '<%= config.bin %> readiness --profile splice-devnet --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      description: 'Profile name (defaults to default-profile)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Readiness)
    const out = createOutput({json: flags.json})

    try {
      const report = await this.createRunner().run({
        config: await this.loadProjectConfig(),
        profileName: flags.profile,
      })

      if (!flags.json) {
        renderReadinessReport(out, report)
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

  protected createRunner(): ReadinessRunner {
    return createReadinessRunner()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

export function renderReadinessReport(out: OutputWriter, report: ReadinessReport): void {
  out.log(`Profile: ${report.profile.name}`)
  out.log(`Kind: ${report.profile.kind}`)
  out.log(`Network: ${report.preflight.network.name} (${report.preflight.network.tier})`)
  out.log(`Canary suites: ${report.canary.selectedSuites.join(', ') || 'none'}`)
  out.log('')
  out.table(
    ['Phase', 'Check', 'Status', 'Detail'],
    [
      ...report.preflight.checks.map(check => ['preflight', check.name, check.status, check.detail]),
      ...report.canary.checks.map(check => ['canary', check.suite, check.status, check.detail]),
    ],
  )

  for (const warning of report.auth.warnings) {
    out.warn(warning)
  }

  for (const check of report.canary.checks) {
    for (const warning of check.warnings) {
      out.warn(`${check.suite}: ${warning}`)
    }
  }

  if (report.success) {
    out.success(
      `Readiness passed with ${report.summary.warned} warning${report.summary.warned === 1 ? '' : 's'} and ${report.summary.skipped} skipped item${report.summary.skipped === 1 ? '' : 's'}.`,
    )
  } else {
    out.error('Readiness found blocking issues.')
  }
}
