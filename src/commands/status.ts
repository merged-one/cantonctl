/**
 * @module commands/status
 *
 * Shows node health, version, and active parties for a Canton network.
 * Supports both single-node sandbox and multi-node Docker topologies.
 *
 * In multi-node mode (when `.cantonctl/` exists), queries all participants.
 */

import {Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {loadConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {type GeneratedTopology} from '../lib/topology.js'

/** Attempt to read the generated topology metadata from .cantonctl/. */
async function detectTopology(projectDir: string): Promise<GeneratedTopology | null> {
  try {
    const confPath = path.join(projectDir, '.cantonctl', 'canton.conf')
    const composePath = path.join(projectDir, '.cantonctl', 'docker-compose.yml')
    const [confExists, composeExists] = await Promise.all([
      fs.promises.access(confPath).then(() => true).catch(() => false),
      fs.promises.access(composePath).then(() => true).catch(() => false),
    ])
    if (!confExists || !composeExists) return null

    // Parse participant ports from the compose file health check
    const composeContent = await fs.promises.readFile(composePath, 'utf8')
    const portMatches = [...composeContent.matchAll(/localhost:(\d+)\/v2\/version/g)]
    if (portMatches.length === 0) return null

    // Reconstruct participant metadata from ports
    const participants = portMatches.map((m, idx) => ({
      name: `participant${idx + 1}`,
      parties: [] as string[],
      ports: {admin: 0, jsonApi: Number.parseInt(m[1], 10), ledgerApi: 0},
    }))

    return {
      bootstrapScript: '',
      cantonConf: '',
      dockerCompose: composeContent,
      participants,
      synchronizer: {admin: 0, publicApi: 0},
    }
  } catch {
    return null
  }
}

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

      // Check for multi-node topology
      const topology = await detectTopology(process.cwd())

      if (topology && topology.participants.length > 0) {
        await this.showMultiNodeStatus(flags, config, topology, out)
      } else {
        await this.showSingleNodeStatus(flags, config, network, networkName, out)
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

  private async showMultiNodeStatus(
    flags: {json: boolean; network: string},
    config: Awaited<ReturnType<typeof loadConfig>>,
    topology: GeneratedTopology,
    out: ReturnType<typeof createOutput>,
  ): Promise<void> {
    const partyNames = config.parties?.map(p => p.name) ?? []
    const token = await createSandboxToken({
      actAs: partyNames.length > 0 ? partyNames : ['admin'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: partyNames,
    })

    const nodeStatuses: Array<{
      healthy: boolean
      name: string
      parties: Array<Record<string, unknown>>
      port: number
      version?: string
    }> = []

    for (const participant of topology.participants) {
      const baseUrl = `http://localhost:${participant.ports.jsonApi}`
      const client = createLedgerClient({baseUrl, token})

      let healthy = false
      let version: string | undefined
      let parties: Array<Record<string, unknown>> = []

      try {
        const versionInfo = await client.getVersion()
        healthy = true
        version = versionInfo.version as string
      } catch {
        healthy = false
      }

      if (healthy) {
        try {
          const result = await client.getParties()
          parties = result.partyDetails
        } catch { /* may fail */ }
      }

      nodeStatuses.push({
        healthy,
        name: participant.name,
        parties,
        port: participant.ports.jsonApi,
        version,
      })
    }

    if (!flags.json) {
      out.log('Mode: multi-node (Docker topology)')
      out.log('')

      out.table(
        ['Node', 'Status', 'Version', 'JSON API', 'Parties'],
        nodeStatuses.map(n => [
          n.name,
          n.healthy ? 'healthy' : 'unreachable',
          n.version ?? '-',
          `localhost:${n.port}`,
          n.parties.length > 0
            ? n.parties.map(p => String(p.displayName)).join(', ')
            : '-',
        ]),
      )
    }

    const allHealthy = nodeStatuses.every(n => n.healthy)
    out.result({
      data: {
        mode: 'multi-node',
        network: flags.network,
        nodes: nodeStatuses.map(n => ({
          healthy: n.healthy,
          name: n.name,
          parties: n.parties.map(p => ({displayName: p.displayName, identifier: p.identifier})),
          port: n.port,
          version: n.version,
        })),
      },
      success: allHealthy,
    })

    if (!allHealthy) this.exit(1)
  }

  private async showSingleNodeStatus(
    flags: {json: boolean; network: string},
    config: Awaited<ReturnType<typeof loadConfig>>,
    network: NonNullable<Awaited<ReturnType<typeof loadConfig>>['networks']>[string],
    networkName: string,
    out: ReturnType<typeof createOutput>,
  ): Promise<void> {
    const jsonApiPort = network['json-api-port'] ?? 7575
    const baseUrl = network.url ?? `http://localhost:${jsonApiPort}`

    const partyNames = config.parties?.map(p => p.name) ?? []
    const token = await createSandboxToken({
      actAs: partyNames.length > 0 ? partyNames : ['admin'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: partyNames,
    })

    const client = createLedgerClient({baseUrl, token})

    let healthy = false
    let version: string | undefined
    try {
      const versionInfo = await client.getVersion()
      healthy = true
      version = versionInfo.version as string
    } catch {
      healthy = false
    }

    let parties: Array<Record<string, unknown>> = []
    if (healthy) {
      try {
        const result = await client.getParties()
        parties = result.partyDetails
      } catch { /* may fail */ }
    }

    if (!flags.json) {
      out.log(`Network: ${networkName}`)
      out.log('Mode: sandbox (single-node)')
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
        mode: 'sandbox',
        network: networkName,
        parties: parties.map(p => ({displayName: p.displayName, identifier: p.identifier})),
        version,
      },
      success: true,
    })

    if (!healthy) this.exit(1)
  }
}
