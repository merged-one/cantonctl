import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError} from '../../lib/errors.js'
import {createLifecycleDiff, type LifecycleDiff} from '../../lib/lifecycle/diff.js'
import {createOutput} from '../../lib/output.js'

export default class PromoteDiff extends Command {
  static override description = 'Compare two profiles before promotion'

  static override examples = [
    '<%= config.bin %> promote diff --from splice-devnet --to splice-testnet',
    '<%= config.bin %> promote diff --from splice-testnet --to splice-mainnet --json',
  ]

  static override flags = {
    from: Flags.string({
      description: 'Source profile',
      required: true,
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
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
      const report = await this.createLifecycleDiff().compare({
        config: await this.loadProjectConfig(),
        fromProfile: flags.from,
        toProfile: flags.to,
      })

      if (!flags.json) {
        out.log(`From: ${report.from.name} (${report.from.tier})`)
        out.log(`To: ${report.to.name} (${report.to.tier})`)
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

  protected createLifecycleDiff(): LifecycleDiff {
    return createLifecycleDiff()
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}

