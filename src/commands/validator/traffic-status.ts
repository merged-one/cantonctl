import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

interface ValidatorTrafficStatusFlags {
  json: boolean
  profile?: string
  token?: string
  'tracking-id': string
  'validator-url'?: string
}

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

    await runValidatorTrafficStatusCommand({
      createStableSplice: () => this.createStableSplice(),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      maybeLoadProfileContext: (options) => this.maybeLoadProfileContext(options),
      out,
    }, flags)
  }
}

async function runValidatorTrafficStatusCommand(
  command: {
    createStableSplice: () => ReturnType<ValidatorTrafficStatus['createStableSplice']>
    handleCommandError: (error: unknown) => never
    maybeLoadProfileContext: (options: {
      needsProfile: boolean
      profileName?: string
    }) => ReturnType<ValidatorTrafficStatus['maybeLoadProfileContext']>
    out: ReturnType<ValidatorTrafficStatus['outputFor']>
  },
  flags: ValidatorTrafficStatusFlags,
): Promise<void> {
  try {
    const profile = await command.maybeLoadProfileContext({
      needsProfile: !flags['validator-url'],
      profileName: flags.profile,
    })
    const result = await command.createStableSplice().getTrafficRequestStatus({
      profile,
      token: flags.token,
      trackingId: flags['tracking-id'],
      validatorBaseUrl: flags['validator-url'],
    })

    if (flags.json) {
      command.out.result({data: result, success: true, warnings: [...result.warnings]})
      return
    }

    command.out.log(`Tracking id: ${result.trackingId}`)
    command.out.log(`Status: ${String(result.status.status ?? 'unknown')}`)
    command.out.log(JSON.stringify(result.status, null, 2))
    for (const warning of result.warnings) {
      command.out.warn(warning)
    }
  } catch (error) {
    command.handleCommandError(error)
  }
}
