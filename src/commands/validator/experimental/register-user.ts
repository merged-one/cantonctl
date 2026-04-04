import {Args, Flags} from '@oclif/core'

import {ExperimentalValidatorCommand} from './base.js'

interface RegisterUserArgs {
  network: string
}

interface RegisterUserFlags {
  'create-party-if-missing': boolean
  experimental: boolean
  json: boolean
  name: string
  'party-id'?: string
  token?: string
  'validator-url'?: string
}

export default class ValidatorExperimentalRegisterUser extends ExperimentalValidatorCommand {
  static override args = {
    network: Args.string({
      description: 'Network with a validator-internal operator surface',
      required: true,
    }),
  }

  static override description =
    'EXPERIMENTAL operator-only: register a user through validator-internal onboarding'

  static override examples = [
    '<%= config.bin %> validator experimental register-user devnet --name alice --experimental',
    '<%= config.bin %> validator experimental register-user devnet --name alice --party-id Alice::1220 --create-party-if-missing --token eyJ... --experimental --json',
  ]

  static override flags = {
    'create-party-if-missing': Flags.boolean({
      default: false,
      description: 'Create the requested party id if it does not already exist on the ledger',
    }),
    experimental: Flags.boolean({
      default: false,
      description: 'Acknowledge the operator-only validator-internal contract',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    name: Flags.string({
      description: 'User name to onboard',
      required: true,
    }),
    'party-id': Flags.string({
      description: 'Optional existing or desired party id for the user',
    }),
    token: Flags.string({
      description: 'Operator JWT bearer token',
    }),
    'validator-url': Flags.string({
      description: 'Explicit validator base URL override',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ValidatorExperimentalRegisterUser)
    const out = this.outputFor(flags.json)

    await runRegisterUserCommand({
      emitWarnings: (warnings) => this.emitWarnings(out, warnings),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      out,
      requireExperimentalOptIn: (enabled, commandPath) => this.requireExperimentalOptIn(enabled, commandPath),
      resolveExperimentalContext: (options) => this.resolveExperimentalContext(options),
    }, args, flags)
  }
}

async function runRegisterUserCommand(
  command: {
    emitWarnings: (warnings: readonly string[]) => void
    handleCommandError: (error: unknown) => never
    out: ReturnType<ValidatorExperimentalRegisterUser['outputFor']>
    requireExperimentalOptIn: (enabled: boolean, commandPath: string) => void
    resolveExperimentalContext: (options: {
      network: string
      token?: string
      validatorUrl?: string
    }) => ReturnType<ValidatorExperimentalRegisterUser['resolveExperimentalContext']>
  },
  args: RegisterUserArgs,
  flags: RegisterUserFlags,
): Promise<void> {
  try {
    command.requireExperimentalOptIn(flags.experimental, `validator experimental register-user ${args.network}`)
    const context = await command.resolveExperimentalContext({
      network: args.network,
      token: flags.token,
      validatorUrl: flags['validator-url'],
    })
    const warnings = [...context.warnings, ...context.adapter.metadata.warnings]
    if (!flags.json) command.emitWarnings(warnings)

    const response = await context.adapter.onboardUser({
      createPartyIfMissing: flags['create-party-if-missing'],
      name: flags.name,
      party_id: flags['party-id'],
    })

    if (!flags.json) {
      command.out.log(`Network: ${context.network}`)
      command.out.log(`Validator: ${context.validatorUrl}`)
      command.out.log(`User: ${flags.name}`)
      command.out.log(`Party ID: ${response.party_id}`)
    }

    command.out.result({
      data: {
        mode: context.authProfile.mode,
        network: context.network,
        partyId: response.party_id,
        user: flags.name,
        validatorUrl: context.validatorUrl,
      },
      success: true,
      warnings: flags.json ? warnings : undefined,
    })
  } catch (error) {
    command.handleCommandError(error)
  }
}
