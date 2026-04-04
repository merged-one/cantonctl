import {Args, Flags} from '@oclif/core'

import {ExperimentalValidatorCommand} from './base.js'

interface SetupPreapprovalArgs {
  network: string
}

interface SetupPreapprovalFlags {
  experimental: boolean
  json: boolean
  token?: string
  'user-party-id': string
  'validator-url'?: string
}

export default class ValidatorExperimentalSetupPreapproval extends ExperimentalValidatorCommand {
  static override args = {
    network: Args.string({
      description: 'Network with a validator-internal operator surface',
      required: true,
    }),
  }

  static override description =
    'EXPERIMENTAL operator-only: create an external-party setup proposal for transfer preapproval'

  static override examples = [
    '<%= config.bin %> validator experimental setup-preapproval devnet --user-party-id Alice::1220 --experimental',
    '<%= config.bin %> validator experimental setup-preapproval devnet --user-party-id Alice::1220 --token eyJ... --experimental --json',
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
    'user-party-id': Flags.string({
      description: 'External user party id that should receive the setup proposal',
      required: true,
    }),
    'validator-url': Flags.string({
      description: 'Explicit validator base URL override',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ValidatorExperimentalSetupPreapproval)
    const out = this.outputFor(flags.json)

    await runSetupPreapprovalCommand({
      emitWarnings: (warnings) => this.emitWarnings(out, warnings),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      out,
      requireExperimentalOptIn: (enabled, commandPath) => this.requireExperimentalOptIn(enabled, commandPath),
      resolveExperimentalContext: (options) => this.resolveExperimentalContext(options),
    }, args, flags)
  }
}

async function runSetupPreapprovalCommand(
  command: {
    emitWarnings: (warnings: readonly string[]) => void
    handleCommandError: (error: unknown) => never
    out: ReturnType<ValidatorExperimentalSetupPreapproval['outputFor']>
    requireExperimentalOptIn: (enabled: boolean, commandPath: string) => void
    resolveExperimentalContext: (options: {
      network: string
      token?: string
      validatorUrl?: string
    }) => ReturnType<ValidatorExperimentalSetupPreapproval['resolveExperimentalContext']>
  },
  args: SetupPreapprovalArgs,
  flags: SetupPreapprovalFlags,
): Promise<void> {
  try {
    command.requireExperimentalOptIn(flags.experimental, `validator experimental setup-preapproval ${args.network}`)
    const context = await command.resolveExperimentalContext({
      network: args.network,
      token: flags.token,
      validatorUrl: flags['validator-url'],
    })
    const warnings = [...context.warnings, ...context.adapter.metadata.warnings]
    if (!flags.json) command.emitWarnings(warnings)

    const response = await context.adapter.createExternalPartySetupProposal({
      user_party_id: flags['user-party-id'],
    })

    if (!flags.json) {
      command.out.log(`Network: ${context.network}`)
      command.out.log(`Validator: ${context.validatorUrl}`)
      command.out.log(`Setup proposal contract: ${response.contract_id}`)
    }

    command.out.result({
      data: {
        contractId: response.contract_id,
        mode: context.authProfile.mode,
        network: context.network,
        userPartyId: flags['user-party-id'],
        validatorUrl: context.validatorUrl,
      },
      success: true,
      warnings: flags.json ? warnings : undefined,
    })
  } catch (error) {
    command.handleCommandError(error)
  }
}
