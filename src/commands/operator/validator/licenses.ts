import {Flags} from '@oclif/core'

import {
  createOperatorValidatorLicenses,
  type OperatorValidatorLicensesRunner,
} from '../../../lib/operator/validator-licenses.js'
import {readString} from '../../../lib/adapters/common.js'
import {OperatorSurfaceCommand} from '../../operator-surface-command.js'

interface OperatorValidatorLicensesFlags {
  after?: number
  json: boolean
  limit?: number
  profile: string
}

export default class OperatorValidatorLicenses extends OperatorSurfaceCommand {
  static override description =
    'List validator licenses through the explicit operator Scan surface (splice-scan-external-openapi, stable-external)'

  static override examples = [
    '<%= config.bin %> operator validator licenses --profile splice-devnet',
    '<%= config.bin %> operator validator licenses --profile splice-devnet --after 25 --limit 25 --json',
  ]

  static override flags = {
    after: Flags.integer({
      description: 'Pagination token from a prior validator-license page',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    limit: Flags.integer({
      description: 'Maximum number of licenses to return',
    }),
    profile: Flags.string({
      description: 'Resolved remote profile that exposes the approved operator Scan surface',
      required: true,
    }),
  }

  protected createValidatorLicensesOperator(): OperatorValidatorLicensesRunner {
    return createOperatorValidatorLicenses()
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(OperatorValidatorLicenses)
    const out = this.outputFor(flags.json)

    await runOperatorValidatorLicensesCommand({
      createValidatorLicensesOperator: () => this.createValidatorLicensesOperator(),
      handleCommandError: (error: unknown) => this.handleCommandError(error, out),
      out,
      resolveOperatorCommandSurface: (options) => this.resolveOperatorCommandSurface(options),
    }, flags)
  }
}

async function runOperatorValidatorLicensesCommand(
  command: {
    createValidatorLicensesOperator: () => OperatorValidatorLicensesRunner
    handleCommandError: (error: unknown) => never
    out: ReturnType<OperatorValidatorLicenses['outputFor']>
    resolveOperatorCommandSurface: (options: {
      profileName: string
      surfaceId: 'validator-licenses'
    }) => ReturnType<OperatorValidatorLicenses['resolveOperatorCommandSurface']>
  },
  flags: OperatorValidatorLicensesFlags,
): Promise<void> {
  try {
    const surface = await command.resolveOperatorCommandSurface({
      profileName: flags.profile,
      surfaceId: 'validator-licenses',
    })
    const result = await command.createValidatorLicensesOperator().list({
      after: flags.after,
      limit: flags.limit,
      surface,
    })

    if (flags.json) {
      command.out.result({data: result, success: true, warnings: [...result.warnings]})
      return
    }

    command.out.info(`Operator auth: ${result.auth.credentialSource}`)
    command.out.info(`Upstream: ${result.surface.upstreamSourceIds.join(', ')} (${result.surface.stability})`)
    command.out.info(`Endpoint: ${result.endpoint}`)

    if (result.licenses.length === 0) {
      command.out.log('No validator licenses returned.')
    } else {
      command.out.table(
        ['Contract', 'Template', 'Validator', 'Created At'],
        result.licenses.map(license => [
          String(license.contractId ?? '-'),
          String(license.templateId ?? '-'),
          String(readString(license.payload ?? {}, 'validator') ?? readString(license.payload ?? {}, 'validator_party_id') ?? '-'),
          String(license.createdAt ?? '-'),
        ]),
      )
    }

    if (result.nextPageToken !== undefined) {
      command.out.info(`Next page token: ${result.nextPageToken}`)
    }

    for (const warning of result.warnings) {
      command.out.warn(warning)
    }
  } catch (error) {
    command.handleCommandError(error)
  }
}
