import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {CantonctlError} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import {createPreflightChecks, type PreflightRunner} from '../lib/preflight/checks.js'
import {renderPreflightReport} from '../lib/preflight/output.js'

export default class Preflight extends Command {
  static override description = 'Run the current read-only readiness checks for a resolved profile'

  static override examples = [
    '<%= config.bin %> preflight --profile splice-devnet',
    '<%= config.bin %> preflight --profile splice-testnet --json',
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
    const {flags} = await this.parse(Preflight)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()
      const report = await this.createPreflight().run({
        config,
        profileName: flags.profile,
      })

      if (!flags.json) {
        renderPreflightReport(out, report)
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

  protected createPreflight(): PreflightRunner {
    return createPreflightChecks()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}
