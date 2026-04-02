import {Args, Command, Flags} from '@oclif/core'

import {createCompatibilityReport, type CompatibilityReport} from '../../lib/compat.js'
import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'

export default class CompatCheck extends Command {
  static override args = {
    profile: Args.string({
      description: 'Profile name (defaults to default-profile)',
      required: false,
    }),
  }

  static override description = 'Check stable-surface compatibility for a runtime profile'

  static override examples = [
    '<%= config.bin %> compat check',
    '<%= config.bin %> compat check splice-devnet',
    '<%= config.bin %> compat check sandbox --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(CompatCheck)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()
      const report = createCompatibilityReport(config, args.profile)

      if (!flags.json) {
        this.printReport(out, report)
      }

      if (flags.json) {
        out.result({
          data: report,
          success: report.failed === 0,
        })
      }

      if (report.failed > 0) {
        this.exit(1)
      }
    } catch (err) {
      if (err instanceof CantonctlError) {
        out.result({
          error: {code: err.code, message: err.message, suggestion: err.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw err
    }
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  private printReport(out: ReturnType<typeof createOutput>, report: CompatibilityReport): void {
    out.log(`Profile: ${report.profile.name}`)
    out.log(`Kind: ${report.profile.kind}`)
    out.log('')
    out.table(
      ['Check', 'Status', 'Detail'],
      report.checks.map(check => [
        check.name,
        check.status,
        check.detail,
      ]),
    )
    if (report.failed === 0) {
      out.success(`Compatibility checks passed with ${report.warned} warning${report.warned === 1 ? '' : 's'}`)
    } else {
      out.error(`${report.failed} compatibility check${report.failed === 1 ? '' : 's'} failed`)
    }
  }
}
