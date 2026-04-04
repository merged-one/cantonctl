import {Args, Flags} from '@oclif/core'

import {ExperimentalValidatorCommand} from './base.js'

interface ExternalPartyGenerateArgs {
  network: string
}

interface ExternalPartyGenerateFlags {
  experimental: boolean
  json: boolean
  'party-hint': string
  'public-key': string
  token?: string
  'validator-url'?: string
}

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

    await runExternalPartyGenerateCommand({
      emitWarnings: (warnings) => this.emitWarnings(out, warnings),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      out,
      requireExperimentalOptIn: (enabled, commandPath) => this.requireExperimentalOptIn(enabled, commandPath),
      resolveExperimentalContext: (options) => this.resolveExperimentalContext(options),
    }, args, flags)
  }
}

async function runExternalPartyGenerateCommand(
  command: {
    emitWarnings: (warnings: readonly string[]) => void
    handleCommandError: (error: unknown) => never
    out: ReturnType<ValidatorExperimentalExternalPartyGenerate['outputFor']>
    requireExperimentalOptIn: (enabled: boolean, commandPath: string) => void
    resolveExperimentalContext: (options: {
      network: string
      token?: string
      validatorUrl?: string
    }) => ReturnType<ValidatorExperimentalExternalPartyGenerate['resolveExperimentalContext']>
  },
  args: ExternalPartyGenerateArgs,
  flags: ExternalPartyGenerateFlags,
): Promise<void> {
  try {
    command.requireExperimentalOptIn(flags.experimental, `validator experimental external-party-generate ${args.network}`)
    const context = await command.resolveExperimentalContext({
      network: args.network,
      token: flags.token,
      validatorUrl: flags['validator-url'],
    })
    const warnings = [...context.warnings, ...context.adapter.metadata.warnings]
    if (!flags.json) command.emitWarnings(warnings)

    const response = await context.adapter.generateExternalPartyTopology({
      party_hint: flags['party-hint'],
      public_key: flags['public-key'],
    })

    if (!flags.json) {
      command.out.log(`Network: ${context.network}`)
      command.out.log(`Validator: ${context.validatorUrl}`)
      command.out.log(`Party ID: ${response.party_id}`)
      command.out.log(`Topology transactions: ${response.topology_txs.length}`)
    }

    command.out.result({
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
    command.handleCommandError(error)
  }
}
