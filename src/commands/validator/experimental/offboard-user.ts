import {Args, Flags} from '@oclif/core'

import {ExperimentalValidatorCommand} from './base.js'

interface OffboardUserArgs {
  network: string
}

interface OffboardUserFlags {
  experimental: boolean
  json: boolean
  token?: string
  username: string
  'validator-url'?: string
}

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

    await runOffboardUserCommand({
      emitWarnings: (warnings) => this.emitWarnings(out, warnings),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      out,
      requireExperimentalOptIn: (enabled, commandPath) => this.requireExperimentalOptIn(enabled, commandPath),
      resolveExperimentalContext: (options) => this.resolveExperimentalContext(options),
    }, args, flags)
  }
}

async function runOffboardUserCommand(
  command: {
    emitWarnings: (warnings: readonly string[]) => void
    handleCommandError: (error: unknown) => never
    out: ReturnType<ValidatorExperimentalOffboardUser['outputFor']>
    requireExperimentalOptIn: (enabled: boolean, commandPath: string) => void
    resolveExperimentalContext: (options: {
      network: string
      token?: string
      validatorUrl?: string
    }) => ReturnType<ValidatorExperimentalOffboardUser['resolveExperimentalContext']>
  },
  args: OffboardUserArgs,
  flags: OffboardUserFlags,
): Promise<void> {
  try {
    command.requireExperimentalOptIn(flags.experimental, `validator experimental offboard-user ${args.network}`)
    const context = await command.resolveExperimentalContext({
      network: args.network,
      token: flags.token,
      validatorUrl: flags['validator-url'],
    })
    const warnings = [...context.warnings, ...context.adapter.metadata.warnings]
    if (!flags.json) command.emitWarnings(warnings)

    await context.adapter.offboardUser(flags.username)

    if (!flags.json) {
      command.out.log(`Network: ${context.network}`)
      command.out.log(`Validator: ${context.validatorUrl}`)
      command.out.log(`Offboarded user: ${flags.username}`)
    }

    command.out.result({
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
    command.handleCommandError(error)
  }
}
