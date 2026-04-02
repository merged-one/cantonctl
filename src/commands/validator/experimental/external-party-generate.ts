import {Args, Flags} from '@oclif/core'

import {ExperimentalValidatorCommand} from './base.js'

export default class ValidatorExperimentalExternalPartyGenerate extends ExperimentalValidatorCommand {
  static override args = {
    network: Args.string({
      description: 'Network with a validator-internal operator surface',
      required: true,
    }),
  }

  static override description =
    'EXPERIMENTAL operator-only: generate external-party topology transactions'

  static override examples = [
    '<%= config.bin %> validator experimental external-party-generate devnet --party-hint alice --public-key <hex> --experimental',
    '<%= config.bin %> validator experimental external-party-generate devnet --party-hint alice --public-key <hex> --token eyJ... --experimental --json',
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
    'party-hint': Flags.string({
      description: 'Party hint used to derive the external party id',
      required: true,
    }),
    'public-key': Flags.string({
      description: 'Hex-encoded ed25519 public key',
      required: true,
    }),
    token: Flags.string({
      description: 'Operator JWT bearer token',
    }),
    'validator-url': Flags.string({
      description: 'Explicit validator base URL override',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ValidatorExperimentalExternalPartyGenerate)
    const out = this.outputFor(flags.json)

    try {
      this.requireExperimentalOptIn(flags.experimental, `validator experimental external-party-generate ${args.network}`)
      const context = await this.resolveExperimentalContext({
        network: args.network,
        token: flags.token,
        validatorUrl: flags['validator-url'],
      })
      const warnings = [...context.warnings, ...context.adapter.metadata.warnings]
      if (!flags.json) this.emitWarnings(out, warnings)

      const response = await context.adapter.generateExternalPartyTopology({
        party_hint: flags['party-hint'],
        public_key: flags['public-key'],
      })

      if (!flags.json) {
        out.log(`Network: ${context.network}`)
        out.log(`Validator: ${context.validatorUrl}`)
        out.log(`Party ID: ${response.party_id}`)
        out.log(`Topology transactions: ${response.topology_txs.length}`)
      }

      out.result({
        data: {
          mode: context.authProfile.mode,
          network: context.network,
          partyId: response.party_id,
          topologyTxs: response.topology_txs,
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
