import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

interface TokenTransferFlags {
  amount: string
  'execute-before'?: string
  'input-holding-cid'?: string[]
  'instrument-admin': string
  'instrument-id': string
  json: boolean
  'ledger-url'?: string
  profile?: string
  receiver: string
  'requested-at'?: string
  sender: string
  token?: string
  'token-standard-url'?: string
}

export default class TokenTransfer extends StableSurfaceCommand {
  static override description = 'Transfer tokens via the stable token-standard transfer factory flow'

  static override examples = [
    '<%= config.bin %> token transfer --profile splice-devnet --sender Alice --receiver Bob --amount 10.0 --instrument-admin Registry --instrument-id USD --token eyJ...',
    '<%= config.bin %> token transfer --ledger-url https://ledger.example.com --token-standard-url https://tokens.example.com --sender Alice --receiver Bob --amount 10.0 --instrument-admin Registry --instrument-id USD --token eyJ... --json',
  ]

  static override flags = {
    amount: Flags.string({
      description: 'Decimal token amount to transfer',
      required: true,
    }),
    'execute-before': Flags.string({
      description: 'Optional ISO timestamp after which the transfer should no longer execute',
    }),
    'input-holding-cid': Flags.string({
      description: 'Optional holding contract ids to use as explicit transfer inputs',
      multiple: true,
    }),
    'instrument-admin': Flags.string({
      description: 'Instrument admin party',
      required: true,
    }),
    'instrument-id': Flags.string({
      description: 'Instrument identifier',
      required: true,
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    'ledger-url': Flags.string({
      description: 'Explicit ledger JSON API base URL override',
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes ledger and tokenStandard',
    }),
    receiver: Flags.string({
      description: 'Receiver party',
      required: true,
    }),
    'requested-at': Flags.string({
      description: 'Optional ISO timestamp to use as the request time',
    }),
    sender: Flags.string({
      description: 'Sender party',
      required: true,
    }),
    token: Flags.string({
      description: 'JWT bearer token for token-standard and ledger calls',
    }),
    'token-standard-url': Flags.string({
      description: 'Explicit token-standard base URL override',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(TokenTransfer)
    const out = this.outputFor(flags.json)

    await runTokenTransferCommand({
      createStableSplice: () => this.createStableSplice(),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      maybeLoadProfileContext: (options) => this.maybeLoadProfileContext(options),
      out,
    }, flags)
  }
}

async function runTokenTransferCommand(
  command: {
    createStableSplice: () => ReturnType<TokenTransfer['createStableSplice']>
    handleCommandError: (error: unknown) => never
    maybeLoadProfileContext: (options: {
      needsProfile: boolean
      profileName?: string
    }) => ReturnType<TokenTransfer['maybeLoadProfileContext']>
    out: ReturnType<TokenTransfer['outputFor']>
  },
  flags: TokenTransferFlags,
): Promise<void> {
  try {
    const profile = await command.maybeLoadProfileContext({
      needsProfile: !flags['ledger-url'] || !flags['token-standard-url'],
      profileName: flags.profile,
    })
    const result = await command.createStableSplice().transferToken({
      amount: flags.amount,
      executeBefore: flags['execute-before'],
      inputHoldingCids: flags['input-holding-cid'],
      instrumentAdmin: flags['instrument-admin'],
      instrumentId: flags['instrument-id'],
      ledgerBaseUrl: flags['ledger-url'],
      profile,
      receiver: flags.receiver,
      requestedAt: flags['requested-at'],
      sender: flags.sender,
      token: flags.token,
      tokenStandardBaseUrl: flags['token-standard-url'],
    })

    if (flags.json) {
      command.out.result({data: result, success: true, warnings: [...result.warnings]})
      return
    }

    command.out.log(`Transfer kind: ${result.transferKind}`)
    command.out.log(`Factory: ${result.factoryId}`)
    command.out.log(`Ledger endpoint: ${result.endpoint.ledger}`)
    command.out.log(`Registry endpoint: ${result.endpoint.tokenStandard}`)
    for (const warning of result.warnings) {
      command.out.warn(warning)
    }
  } catch (error) {
    command.handleCommandError(error)
  }
}
