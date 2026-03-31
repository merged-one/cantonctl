/**
 * @module commands/status
 *
 * Shows node health, version, and active parties for a Canton network.
 * Uses LedgerClient to query the JSON Ledger API and JWT module for auth.
 */

import {Command, Flags} from '@oclif/core'

import {loadConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'

export default class Status extends Command {
  static override description = 'Show node health, version, and active parties'

  static override examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status --network devnet',
    '<%= config.bin %> status --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    network: Flags.string({
      char: 'n',
      default: 'local',
      description: 'Network to query',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Status)
    const out = createOutput({json: flags.json})

    try {
      const config = await loadConfig()
      const networkName = flags.network
      const network = config.networks?.[networkName]

      if (!network) {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          context: {availableNetworks: Object.keys(config.networks ?? {}), network: networkName},
          suggestion: `Network "${networkName}" not found in cantonctl.yaml. Available: ${Object.keys(config.networks ?? {}).join(', ') || 'none'}`,
        })
      }

      const jsonApiPort = network['json-api-port'] ?? 7575
      const baseUrl = network.url ?? `http://localhost:${jsonApiPort}`

      // Generate token for local networks
      const partyNames = config.parties?.map(p => p.name) ?? []
      const token = await createSandboxToken({
        actAs: partyNames.length > 0 ? partyNames : ['admin'],
        admin: true,
        applicationId: 'cantonctl',
        readAs: partyNames,
      })

      const client = createLedgerClient({baseUrl, token})

      // Query health
      let healthy = false
      let version: string | undefined
      try {
        const versionInfo = await client.getVersion()
        healthy = true
        version = versionInfo.version as string
      } catch {
        healthy = false
      }

      // Query parties
      let parties: Array<Record<string, unknown>> = []
      if (healthy) {
        try {
          const result = await client.getParties()
          parties = result.partyDetails
        } catch {
          // Parties query may fail on some network types
        }
      }

      // Display
      if (!flags.json) {
        out.log(`Network: ${networkName}`)
        out.log('')

        if (healthy) {
          out.success(`Node healthy (v${version})`)
          out.log(`  JSON API: ${baseUrl}`)
        } else {
          out.error(`Node not reachable at ${baseUrl}`)
        }

        out.log('')
        if (parties.length > 0) {
          out.table(
            ['Party', 'ID', 'Local'],
            parties.map(p => [
              String(p.displayName ?? ''),
              String(p.identifier ?? ''),
              String(p.isLocal ?? ''),
            ]),
          )
        } else {
          out.info('No parties found')
        }
      }

      out.result({
        data: {
          healthy,
          network: networkName,
          parties: parties.map(p => ({displayName: p.displayName, identifier: p.identifier})),
          version,
        },
        success: true,
      })

      if (!healthy) {
        this.exit(1)
      }
    } catch (err) {
      if (err instanceof CantonctlError) {
        out.result({
          error: {code: err.code, message: err.message, suggestion: err.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw err
    }
  }
}
