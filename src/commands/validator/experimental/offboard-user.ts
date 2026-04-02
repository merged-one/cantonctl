import {Args, Flags} from '@oclif/core'

import {ExperimentalValidatorCommand} from './base.js'

export default class ValidatorExperimentalOffboardUser extends ExperimentalValidatorCommand {
  static override args = {
    network: Args.string({
      description: 'Network with a validator-internal operator surface',
      required: true,
    }),
  }

  static override description =
    'EXPERIMENTAL operator-only: offboard a user through validator-internal admin APIs'

  static override examples = [
    '<%= config.bin %> validator experimental offboard-user devnet --username alice --experimental',
    '<%= config.bin %> validator experimental offboard-user devnet --username alice --token eyJ... --experimental --json',
  ]

  static override flags = {
    experimental: Flags.boolean({
      default: false,
      description: 'Acknowledge the operator-only validator-internal contract',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    token: Flags.string({
      description: 'Operator JWT bearer token',
    }),
    username: Flags.string({
      description: 'User name to offboard',
      required: true,
    }),
    'validator-url': Flags.string({
      description: 'Explicit validator base URL override',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ValidatorExperimentalOffboardUser)
    const out = this.outputFor(flags.json)

    try {
      this.requireExperimentalOptIn(flags.experimental, `validator experimental offboard-user ${args.network}`)
      const context = await this.resolveExperimentalContext({
        network: args.network,
        token: flags.token,
        validatorUrl: flags['validator-url'],
      })
      const warnings = [...context.warnings, ...context.adapter.metadata.warnings]
      if (!flags.json) this.emitWarnings(out, warnings)

      await context.adapter.offboardUser(flags.username)

      if (!flags.json) {
        out.log(`Network: ${context.network}`)
        out.log(`Validator: ${context.validatorUrl}`)
        out.log(`Offboarded user: ${flags.username}`)
      }

      out.result({
        data: {
          mode: context.authProfile.mode,
          network: context.network,
          offboarded: true,
          user: flags.username,
          validatorUrl: context.validatorUrl,
        },
        success: true,
        warnings: flags.json ? warnings : undefined,
      })
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
