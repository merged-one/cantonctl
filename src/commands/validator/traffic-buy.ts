import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

interface ValidatorTrafficBuyFlags {
  'domain-id': string
  'expires-at'?: string
  json: boolean
  profile?: string
  'receiving-validator-party-id': string
  token?: string
  'tracking-id'?: string
  'traffic-amount': number
  'validator-url'?: string
}

export default class ValidatorTrafficBuy extends StableSurfaceCommand {
  static override description = 'Create a stable validator-user traffic purchase request'

  static override examples = [
    '<%= config.bin %> validator traffic-buy --profile splice-devnet --receiving-validator-party-id AliceValidator --domain-id domain::1 --traffic-amount 4096 --token eyJ...',
    '<%= config.bin %> validator traffic-buy --validator-url https://validator.example.com/api/validator --receiving-validator-party-id AliceValidator --domain-id domain::1 --traffic-amount 4096 --token eyJ... --json',
  ]

  static override flags = {
    'domain-id': Flags.string({
      description: 'Domain id to purchase traffic for',
      required: true,
    }),
    'expires-at': Flags.string({
      description: 'Optional ISO expiry timestamp for the request',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes validator',
    }),
    'receiving-validator-party-id': Flags.string({
      description: 'Validator party id that will receive the traffic top-up',
      required: true,
    }),
    token: Flags.string({
      description: 'JWT bearer token for the validator-user request',
    }),
    'tracking-id': Flags.string({
      description: 'Optional idempotency key for the request',
    }),
    'traffic-amount': Flags.integer({
      description: 'Traffic amount in bytes',
      required: true,
    }),
    'validator-url': Flags.string({
      description: 'Explicit validator base URL override',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ValidatorTrafficBuy)
    const out = this.outputFor(flags.json)

    await runValidatorTrafficBuyCommand({
      createStableSplice: () => this.createStableSplice(),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      maybeLoadProfileContext: (options) => this.maybeLoadProfileContext(options),
      out,
    }, flags)
  }
}

async function runValidatorTrafficBuyCommand(
  command: {
    createStableSplice: () => ReturnType<ValidatorTrafficBuy['createStableSplice']>
    handleCommandError: (error: unknown) => never
    maybeLoadProfileContext: (options: {
      needsProfile: boolean
      profileName?: string
    }) => ReturnType<ValidatorTrafficBuy['maybeLoadProfileContext']>
    out: ReturnType<ValidatorTrafficBuy['outputFor']>
  },
  flags: ValidatorTrafficBuyFlags,
): Promise<void> {
  try {
    const profile = await command.maybeLoadProfileContext({
      needsProfile: !flags['validator-url'],
      profileName: flags.profile,
    })
    const result = await command.createStableSplice().createTrafficBuy({
      domainId: flags['domain-id'],
      expiresAt: flags['expires-at'],
      profile,
      receivingValidatorPartyId: flags['receiving-validator-party-id'],
      token: flags.token,
      trackingId: flags['tracking-id'],
      trafficAmount: flags['traffic-amount'],
      validatorBaseUrl: flags['validator-url'],
    })

    if (flags.json) {
      command.out.result({data: result, success: true, warnings: [...result.warnings]})
      return
    }

    command.out.log(`Tracking id: ${result.trackingId}`)
    command.out.log(`Request contract: ${result.requestContractId}`)
    for (const warning of result.warnings) {
      command.out.warn(warning)
    }
  } catch (error) {
    command.handleCommandError(error)
  }
}
