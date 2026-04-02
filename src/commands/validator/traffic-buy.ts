import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

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

    try {
      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['validator-url'],
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().createTrafficBuy({
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
        out.result({data: result, success: true, warnings: [...result.warnings]})
        return
      }

      out.log(`Tracking id: ${result.trackingId}`)
      out.log(`Request contract: ${result.requestContractId}`)
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
