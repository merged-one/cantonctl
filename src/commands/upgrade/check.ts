import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError} from '../../lib/errors.js'
import {createUpgradeChecker, type UpgradeChecker} from '../../lib/lifecycle/upgrade.js'
import {createOutput} from '../../lib/output.js'

export default class UpgradeCheck extends Command {
  static override description = 'Run advisory upgrade checks for a profile'

  static override examples = [
    '<%= config.bin %> upgrade check --profile splice-devnet',
    '<%= config.bin %> upgrade check --profile splice-mainnet --json',
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
    const {flags} = await this.parse(UpgradeCheck)
    const out = createOutput({json: flags.json})

    try {
      const report = await this.createUpgradeChecker().check({
        config: await this.loadProjectConfig(),
        profileName: flags.profile,
      })

      if (!flags.json) {
        out.log(`Profile: ${report.profile.name} (${report.profile.tier})`)
        out.log(`Auth: ${report.auth.mode} (${report.auth.source})`)
        out.log('')
        out.table(
          ['Severity', 'Code', 'Message'],
          report.advisories.map(advisory => [advisory.severity, advisory.code, advisory.message]),
        )
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

  protected createUpgradeChecker(): UpgradeChecker {
    return createUpgradeChecker()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

