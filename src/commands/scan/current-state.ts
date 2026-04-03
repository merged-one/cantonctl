import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

interface ScanCurrentStateFlags {
  json: boolean
  profile?: string
  'scan-proxy-url'?: string
  'scan-url'?: string
}

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

    await runScanCurrentStateCommand({
      createStableSplice: () => this.createStableSplice(),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      maybeLoadProfileContext: (options) => this.maybeLoadProfileContext(options),
      out,
    }, flags)
  }
}

async function runScanCurrentStateCommand(
  command: {
    createStableSplice: () => ReturnType<ScanCurrentState['createStableSplice']>
    handleCommandError: (error: unknown) => never
    maybeLoadProfileContext: (options: {
      needsProfile: boolean
      profileName?: string
    }) => ReturnType<ScanCurrentState['maybeLoadProfileContext']>
    out: ReturnType<ScanCurrentState['outputFor']>
  },
  flags: ScanCurrentStateFlags,
): Promise<void> {
  try {
    const profile = await command.maybeLoadProfileContext({
      needsProfile: !flags['scan-url'] && !flags['scan-proxy-url'],
      profileName: flags.profile,
    })
    const result = await command.createStableSplice().getScanCurrentState({
      profile,
      scanBaseUrl: flags['scan-url'],
      scanProxyBaseUrl: flags['scan-proxy-url'],
    })

    if (flags.json) {
      command.out.result({data: result, success: true, warnings: [...result.warnings]})
      return
    }

    command.out.log(`Source: ${result.source}`)
    command.out.log(`Endpoint: ${result.endpoint}`)
    command.out.log(`DSO party: ${String(result.dsoInfo.dso_party_id ?? '-')}`)
    command.out.table(
      ['Round Set', 'Count'],
      [
        ['Open mining rounds', String(result.openMiningRounds.length)],
        ['Issuing mining rounds', String(result.issuingMiningRounds.length)],
      ],
    )
    for (const warning of result.warnings) {
      command.out.warn(warning)
    }
  } catch (error) {
    command.handleCommandError(error)
  }
}
