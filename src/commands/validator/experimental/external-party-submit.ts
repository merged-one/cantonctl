import {Args, Flags} from '@oclif/core'

import {CantonctlError, ErrorCode} from '../../../lib/errors.js'
import {ExperimentalValidatorCommand} from './base.js'

interface ParsedSignedTopologyTx {
  signed_hash: string
  topology_tx: string
}

interface ExternalPartySubmitArgs {
  network: string
}

interface ExternalPartySubmitFlags {
  experimental: boolean
  json: boolean
  'public-key': string
  'signed-topology-tx': string[]
  token?: string
  'validator-url'?: string
}

export default class ValidatorExperimentalExternalPartySubmit extends ExperimentalValidatorCommand {
  static override args = {
    network: Args.string({
      description: 'Network with a validator-internal operator surface',
      required: true,
    }),
  }

  static override description =
    'EXPERIMENTAL operator-only: submit signed external-party topology transactions'

  static override examples = [
    '<%= config.bin %> validator experimental external-party-submit devnet --public-key <hex> --signed-topology-tx <base64tx>:<hexsig> --experimental',
    '<%= config.bin %> validator experimental external-party-submit devnet --public-key <hex> --signed-topology-tx <base64tx>:<hexsig> --token eyJ... --experimental --json',
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
    'public-key': Flags.string({
      description: 'Hex-encoded ed25519 public key',
      required: true,
    }),
    'signed-topology-tx': Flags.string({
      description: 'Repeatable <base64-topology-tx>:<hex-signature> entry',
      multiple: true,
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
    const {args, flags} = await this.parse(ValidatorExperimentalExternalPartySubmit)
    const out = this.outputFor(flags.json)

    await runExternalPartySubmitCommand({
      emitWarnings: (warnings) => this.emitWarnings(out, warnings),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      out,
      requireExperimentalOptIn: (enabled, commandPath) => this.requireExperimentalOptIn(enabled, commandPath),
      resolveExperimentalContext: (options) => this.resolveExperimentalContext(options),
    }, args, flags)
  }
}

async function runExternalPartySubmitCommand(
  command: {
    emitWarnings: (warnings: readonly string[]) => void
    handleCommandError: (error: unknown) => never
    out: ReturnType<ValidatorExperimentalExternalPartySubmit['outputFor']>
    requireExperimentalOptIn: (enabled: boolean, commandPath: string) => void
    resolveExperimentalContext: (options: {
      network: string
      token?: string
      validatorUrl?: string
    }) => ReturnType<ValidatorExperimentalExternalPartySubmit['resolveExperimentalContext']>
  },
  args: ExternalPartySubmitArgs,
  flags: ExternalPartySubmitFlags,
): Promise<void> {
  try {
    command.requireExperimentalOptIn(flags.experimental, `validator experimental external-party-submit ${args.network}`)
    const context = await command.resolveExperimentalContext({
      network: args.network,
      token: flags.token,
      validatorUrl: flags['validator-url'],
    })
    const warnings = [...context.warnings, ...context.adapter.metadata.warnings]
    if (!flags.json) command.emitWarnings(warnings)

    const response = await context.adapter.submitExternalPartyTopology({
      public_key: flags['public-key'],
      signed_topology_txs: flags['signed-topology-tx'].map(parseSignedTopologyTx),
    })

    if (!flags.json) {
      command.out.log(`Network: ${context.network}`)
      command.out.log(`Validator: ${context.validatorUrl}`)
      command.out.log(`Submitted topology for party: ${response.party_id}`)
    }

    command.out.result({
      data: {
        mode: context.authProfile.mode,
        network: context.network,
        partyId: response.party_id,
        submitted: true,
        validatorUrl: context.validatorUrl,
      },
      success: true,
      warnings: flags.json ? warnings : undefined,
    })
  } catch (error) {
    command.handleCommandError(error)
  }
}

function parseSignedTopologyTx(value: string): ParsedSignedTopologyTx {
  const delimiter = value.indexOf(':')
  if (delimiter === -1) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {value},
      suggestion:
        'Each --signed-topology-tx value must use the format <base64-topology-tx>:<hex-signature>.',
    })
  }

  const topology_tx = value.slice(0, delimiter)
  const signed_hash = value.slice(delimiter + 1)
  if (!topology_tx || !signed_hash) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {value},
      suggestion:
        'Each --signed-topology-tx value must include both the base64 topology transaction and its hex signature.',
    })
  }

  return {signed_hash, topology_tx}
}
