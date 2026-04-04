import {Command, Flags} from '@oclif/core'

import {createResetHelper, type ResetHelper} from '../../lib/lifecycle/reset.js'
import {createOutput} from '../../lib/output.js'

export default class ResetChecklist extends Command {
  static override description = 'Show advisory reset checklist items for a network tier'

  static override examples = [
    '<%= config.bin %> reset checklist --network devnet',
    '<%= config.bin %> reset checklist --network mainnet --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    network: Flags.string({
      description: 'Network tier',
      options: ['devnet', 'testnet', 'mainnet'],
      required: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ResetChecklist)
    const out = createOutput({json: flags.json})
    const report = this.createResetHelper().createChecklist({
      network: flags.network as 'devnet' | 'mainnet' | 'testnet',
    })

    if (!flags.json) {
      out.log(`Network: ${report.network}`)
      out.log(`Reset expectation: ${report.resetExpectation}`)
      out.log('')
      out.table(
        ['Severity', 'Checklist'],
        report.checklist.map(item => [item.severity, item.text]),
      )
    }

    out.result({
      data: flags.json ? report : undefined,
      success: true,
    })
  }

  protected createResetHelper(): ResetHelper {
    return createResetHelper()
  }
}

