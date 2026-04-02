import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

export default class ScanCurrentState extends StableSurfaceCommand {
  static override description = 'Read current stable public Scan state from scan or scan-proxy'

  static override examples = [
    '<%= config.bin %> scan current-state --profile splice-devnet',
    '<%= config.bin %> scan current-state --scan-proxy-url https://validator.example.com/api/validator --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes scan or scanProxy',
    }),
    'scan-proxy-url': Flags.string({
      description: 'Explicit scan-proxy base URL override',
    }),
    'scan-url': Flags.string({
      description: 'Explicit scan base URL override',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ScanCurrentState)
    const out = this.outputFor(flags.json)

    try {
      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['scan-url'] && !flags['scan-proxy-url'],
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().getScanCurrentState({
        profile,
        scanBaseUrl: flags['scan-url'],
        scanProxyBaseUrl: flags['scan-proxy-url'],
      })

      if (flags.json) {
        out.result({data: result, success: true, warnings: [...result.warnings]})
        return
      }

      out.log(`Source: ${result.source}`)
      out.log(`Endpoint: ${result.endpoint}`)
      out.log(`DSO party: ${String(result.dsoInfo.dso_party_id ?? '-')}`)
      out.table(
        ['Round Set', 'Count'],
        [
          ['Open mining rounds', String(result.openMiningRounds.length)],
          ['Issuing mining rounds', String(result.issuingMiningRounds.length)],
        ],
      )
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
