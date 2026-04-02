import {Args, Flags} from '@oclif/core'

import {ExperimentalValidatorCommand} from './base.js'

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

    try {
      this.requireExperimentalOptIn(flags.experimental, `validator experimental setup-preapproval ${args.network}`)
      const context = await this.resolveExperimentalContext({
        network: args.network,
        token: flags.token,
        validatorUrl: flags['validator-url'],
      })
      const warnings = [...context.warnings, ...context.adapter.metadata.warnings]
      if (!flags.json) this.emitWarnings(out, warnings)

      const response = await context.adapter.createExternalPartySetupProposal({
        user_party_id: flags['user-party-id'],
      })

      if (!flags.json) {
        out.log(`Network: ${context.network}`)
        out.log(`Validator: ${context.validatorUrl}`)
        out.log(`Setup proposal contract: ${response.contract_id}`)
      }

      out.result({
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
      this.handleCommandError(error, out)
    }
  }
}
