import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

export default class ValidatorTrafficStatus extends StableSurfaceCommand {
  static override description = 'Check the status of a stable validator-user traffic request'

  static override examples = [
    '<%= config.bin %> validator traffic-status --profile splice-devnet --tracking-id traffic-123 --token eyJ...',
    '<%= config.bin %> validator traffic-status --validator-url https://validator.example.com/api/validator --tracking-id traffic-123 --token eyJ... --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes validator',
    }),
    token: Flags.string({
      description: 'JWT bearer token for the validator-user request',
    }),
    'tracking-id': Flags.string({
      description: 'Tracking id returned from validator traffic-buy',
      required: true,
    }),
    'validator-url': Flags.string({
      description: 'Explicit validator base URL override',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ValidatorTrafficStatus)
    const out = this.outputFor(flags.json)

    try {
      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['validator-url'],
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().getTrafficRequestStatus({
        profile,
        token: flags.token,
        trackingId: flags['tracking-id'],
        validatorBaseUrl: flags['validator-url'],
      })

      if (flags.json) {
        out.result({data: result, success: true, warnings: [...result.warnings]})
        return
      }

      out.log(`Tracking id: ${result.trackingId}`)
      out.log(`Status: ${String(result.status.status ?? 'unknown')}`)
      out.log(JSON.stringify(result.status, null, 2))
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
