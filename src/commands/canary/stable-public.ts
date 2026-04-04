import {Command, Flags} from '@oclif/core'

import {createCanaryRunner, STABLE_PUBLIC_CANARY_SUITES, type CanaryRunner} from '../../lib/canary/run.js'
import {renderCanaryReport} from '../../lib/canary/report.js'
import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'

export default class CanaryStablePublic extends Command {
  static override description = 'Run stable/public canaries against a resolved profile'

  static override examples = [
    '<%= config.bin %> canary stable-public --profile splice-devnet',
    '<%= config.bin %> canary stable-public --profile splice-devnet --suite scan --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      description: 'Profile name (defaults to default-profile)',
    }),
    suite: Flags.string({
      description: 'Restrict to one or more stable/public suites',
      multiple: true,
      options: [...STABLE_PUBLIC_CANARY_SUITES],
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CanaryStablePublic)
    const out = createOutput({json: flags.json})

    try {
      const report = await this.createRunner().run({
        config: await this.loadProjectConfig(),
        profileName: flags.profile,
        suites: flags.suite as typeof STABLE_PUBLIC_CANARY_SUITES[number][] | undefined,
      })

      if (!flags.json) {
        renderCanaryReport(out, report)
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

  protected createRunner(): CanaryRunner {
    return createCanaryRunner()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

