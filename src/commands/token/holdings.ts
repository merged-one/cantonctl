import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

export default class TokenHoldings extends StableSurfaceCommand {
  static override description = 'List token holdings via the stable holding Daml interface'

  static override examples = [
    '<%= config.bin %> token holdings --profile splice-devnet --party Alice',
    '<%= config.bin %> token holdings --ledger-url https://ledger.example.com --party Alice --token eyJ... --json',
  ]

  static override flags = {
    'instrument-admin': Flags.string({
      description: 'Optional instrument admin party filter',
    }),
    'instrument-id': Flags.string({
      description: 'Optional instrument id filter',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    'ledger-url': Flags.string({
      description: 'Explicit ledger JSON API base URL override',
    }),
    party: Flags.string({
      description: 'Party whose visible holdings should be queried',
      required: true,
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes ledger',
    }),
    token: Flags.string({
      description: 'JWT bearer token for the ledger query',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(TokenHoldings)
    const out = this.outputFor(flags.json)

    try {
      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['ledger-url'],
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().listTokenHoldings({
        instrumentAdmin: flags['instrument-admin'],
        instrumentId: flags['instrument-id'],
        ledgerBaseUrl: flags['ledger-url'],
        party: flags.party,
        profile,
        token: flags.token,
      })

      if (flags.json) {
        out.result({data: result, success: true, warnings: [...result.warnings]})
        return
      }

      out.table(
        ['Contract', 'Owner', 'Instrument', 'Amount'],
        result.holdings.map(holding => [
          String(holding.contractId ?? '-'),
          String(holding.owner ?? '-'),
          `${holding.instrumentId?.admin ?? '?'}:${holding.instrumentId?.id ?? '?'}`,
          String(holding.amount ?? '-'),
        ]),
      )
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
