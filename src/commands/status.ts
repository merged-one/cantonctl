/**
 * @module commands/status
 *
 * Shows ledger health plus profile-aware service information for networks and
 * runtime profiles.
 */

import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../lib/config.js'
import {
  inspectProfile,
  type ProfileInspection,
} from '../lib/compat.js'
import {
  createControlPlaneDriftReport,
  renderControlPlaneDriftReport,
} from '../lib/control-plane-drift.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createSandboxToken} from '../lib/jwt.js'
import {createLedgerClient, type LedgerClient} from '../lib/ledger-client.js'
import {createOutput} from '../lib/output.js'
import {
  createProfileRuntimeResolver,
  type ProfileRuntimeResolver,
  type ResolvedProfileRuntime,
} from '../lib/profile-runtime.js'
import {
  createMultiNodeStatusInventory,
  createProfileStatusInventory,
  createSingleNodeStatusInventory,
  summarizeStatusInventory,
  type RuntimeInventoryNode,
  type RuntimeInventoryService,
} from '../lib/runtime-inventory.js'
import {type GeneratedTopology, detectTopology} from '../lib/topology.js'

interface StatusFlags {
  json: boolean
  network: string
  profile?: string
}

export default class Status extends Command {
  static override description = 'Show profile-aware service health and ledger status'

  static override examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status --network devnet',
    '<%= config.bin %> status --profile sandbox',
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
    profile: Flags.string({
      description: 'Show status for a resolved runtime profile instead of a legacy network target',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Status)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()

      if (flags.profile) {
        await this.showProfileStatus(flags, config, out)
        return
      }

      const networkName = flags.network
      const network = config.networks?.[networkName]
      if (!network) {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          context: {availableNetworks: Object.keys(config.networks ?? {}), network: networkName},
          suggestion: `Network "${networkName}" not found in cantonctl.yaml. Available: ${Object.keys(config.networks ?? {}).join(', ') || 'none'}`,
        })
      }

      const topology = await this.detectProjectTopology(process.cwd())
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

  protected createStatusLedgerClient(baseUrl?: string, token?: string): LedgerClient {
    return createLedgerClient({baseUrl: baseUrl!, token: token!})
  }

  protected async createStatusToken(config?: CantonctlConfig): Promise<string> {
    const partyNames = config?.parties?.map(party => party.name) ?? []
    return createSandboxToken({
      actAs: partyNames.length > 0 ? partyNames : ['admin'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: partyNames,
    })
  }

  protected async detectProjectTopology(cwd?: string): Promise<GeneratedTopology | null> {
    return detectTopology(cwd ?? process.cwd())
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }

  protected createProfileRuntimeResolver(): ProfileRuntimeResolver {
    return createProfileRuntimeResolver()
  }

  private async showMultiNodeStatus(
    flags: StatusFlags,
    config: CantonctlConfig,
    topology: GeneratedTopology,
    out: ReturnType<typeof createOutput>,
  ): Promise<void> {
    const token = await this.createStatusToken(config)
    const nodeStatuses: Array<{
      healthy: boolean
      name: string
      parties: Array<Record<string, unknown>>
      port: number
      version?: string
    }> = []

    for (const participant of topology.participants) {
      const baseUrl = `http://localhost:${participant.ports.jsonApi}`
      const ledgerStatus = await this.getLedgerStatus(baseUrl, token)
      nodeStatuses.push({
        healthy: ledgerStatus.healthy,
        name: participant.name,
        parties: ledgerStatus.parties,
        port: participant.ports.jsonApi,
        version: ledgerStatus.version,
      })
    }

    const allHealthy = nodeStatuses.every(node => node.healthy)
    const inspection = this.tryInspectNetworkProfile(config, flags.network)
    const inventory = createMultiNodeStatusInventory({
      inspection,
      networkName: flags.network,
      nodes: nodeStatuses as RuntimeInventoryNode[],
    })
    const services = inventory.services
    const runtime = inspection ? await this.tryResolveStatusRuntime(config, inspection.profile.name) : undefined
    const driftReport = createControlPlaneDriftReport({inventory, runtime})

    if (!flags.json) {
      out.log('Mode: multi-node (Docker topology)')
      if (inventory.profile) {
        out.log(`Profile: ${inventory.profile.name} (${inventory.profile.kind})`)
      }
      if (runtime) {
        out.log(
          `Operator auth: ${runtime.auth.operator.required ? 'required' : 'not required'} ` +
          `(${runtime.operatorCredential.source})`,
        )
      }
      out.log('')
      out.table(
        ['Node', 'Status', 'Version', 'JSON API', 'Parties'],
        nodeStatuses.map(node => [
          node.name,
          node.healthy ? 'healthy' : 'unreachable',
          node.version ?? '-',
          `localhost:${node.port}`,
          node.parties.length > 0
            ? node.parties.map(party => String(party.displayName)).join(', ')
            : '-',
        ]),
      )
      out.log('')
      this.printServiceTable(out, services)
      renderControlPlaneDriftReport(out, driftReport)
    }

    if (flags.json) {
      out.result({
        data: {
          auth: runtime ? this.summarizeRuntimeAuth(runtime) : undefined,
          capabilities: inventory.capabilities,
          drift: driftReport.items,
          inventory,
          mode: 'multi-node',
          network: flags.network,
          nodes: inventory.nodes?.map(node => ({
            healthy: node.healthy,
            name: node.name,
            parties: node.parties.map(party => ({displayName: party.displayName, identifier: party.identifier})),
            port: node.port,
            version: node.version,
          })),
          profile: inventory.profile,
          reconcile: driftReport.reconcile,
          services,
          summary: summarizeStatusInventory(services),
        },
        success: allHealthy,
      })
    }

    if (!allHealthy) {
      this.exit(1)
    }
  }

  private async showProfileStatus(
    flags: StatusFlags,
    config: CantonctlConfig,
    out: ReturnType<typeof createOutput>,
  ): Promise<void> {
    const inspection = inspectProfile(config, flags.profile)
    const {profile} = inspection

    let healthy: boolean | undefined
    let parties: Array<Record<string, unknown>> = []
    let version: string | undefined
    const ledgerService = inspection.services.find(service => service.name === 'ledger')

    if (ledgerService && this.shouldCheckLedgerHealth(profile)) {
      const token = await this.createStatusToken(config)
      const ledgerStatus = await this.getLedgerStatus(ledgerService.endpoint!, token)
      healthy = ledgerStatus.healthy
      parties = ledgerStatus.parties
      version = ledgerStatus.version
    }
    const inventory = createProfileStatusInventory({
      inspection,
      ledger: healthy === undefined || !ledgerService
        ? undefined
        : {
          endpoint: ledgerService.endpoint!,
          healthy,
          parties,
          version,
        },
    })
    const services = inventory.services
    const runtime = await this.resolveStatusRuntime(config, profile.name)
    const driftReport = createControlPlaneDriftReport({inventory, runtime})

    if (!flags.json) {
      out.log(`Profile: ${profile.name}`)
      out.log(`Kind: ${profile.kind}`)
      out.log(
        `Operator auth: ${runtime.auth.operator.required ? 'required' : 'not required'} ` +
        `(${runtime.operatorCredential.source})`,
      )
      if (profile.experimental) out.warn('Profile is marked experimental')
      out.log('')
      this.printServiceTable(out, services)
      if (version) {
        out.log('')
        out.success(`Ledger healthy (v${version})`)
      }
      if (parties.length > 0) {
        out.log('')
        out.table(
          ['Party', 'ID'],
          parties.map(party => [
            String(party.displayName ?? ''),
            String(party.identifier ?? ''),
          ]),
        )
      }
      renderControlPlaneDriftReport(out, driftReport)
    }

    if (flags.json) {
      out.result({
        data: {
          auth: this.summarizeRuntimeAuth(runtime),
          capabilities: inventory.capabilities,
          drift: driftReport.items,
          healthy,
          inventory,
          mode: 'profile',
          parties: parties.map(party => ({displayName: party.displayName, identifier: party.identifier})),
          profile: inventory.profile,
          reconcile: driftReport.reconcile,
          services,
          summary: summarizeStatusInventory(services),
          version,
        },
        success: healthy === undefined ? true : healthy,
      })
    }

    if (healthy === false) {
      this.exit(1)
    }
  }

  private async showSingleNodeStatus(
    flags: StatusFlags,
    config: CantonctlConfig,
    network: NonNullable<CantonctlConfig['networks']>[string],
    networkName: string,
    out: ReturnType<typeof createOutput>,
  ): Promise<void> {
    const baseUrl = network.url ?? `http://localhost:${network['json-api-port'] ?? 7575}`
    const token = await this.createStatusToken(config)
    const ledgerStatus = await this.getLedgerStatus(baseUrl, token)

    const inspection = this.tryInspectNetworkProfile(config, networkName)
    const inventory = createSingleNodeStatusInventory({
      inspection,
      ledger: {
        endpoint: baseUrl,
        healthy: ledgerStatus.healthy,
        parties: ledgerStatus.parties,
        version: ledgerStatus.version,
      },
      networkName,
      networkType: network.type,
    })
    const services = inventory.services
    const runtime = inspection ? await this.tryResolveStatusRuntime(config, inspection.profile.name) : undefined
    const driftReport = createControlPlaneDriftReport({inventory, runtime})

    if (!flags.json) {
      out.log(`Network: ${networkName}`)
      out.log(`Mode: ${network.type}`)
      if (inventory.profile) {
        out.log(`Profile: ${inventory.profile.name} (${inventory.profile.kind})`)
      }
      if (runtime) {
        out.log(
          `Operator auth: ${runtime.auth.operator.required ? 'required' : 'not required'} ` +
          `(${runtime.operatorCredential.source})`,
        )
      }
      out.log('')

      if (ledgerStatus.healthy) {
        out.success(`Ledger healthy (v${ledgerStatus.version})`)
      } else {
        out.error(`Ledger not reachable at ${baseUrl}`)
      }

      out.log('')
      this.printServiceTable(out, services)

      if (ledgerStatus.parties.length > 0) {
        out.log('')
        out.table(
          ['Party', 'ID', 'Local'],
          ledgerStatus.parties.map(party => [
            String(party.displayName ?? ''),
            String(party.identifier ?? ''),
            String(party.isLocal ?? ''),
          ]),
        )
      }
      renderControlPlaneDriftReport(out, driftReport)
    }

    if (flags.json) {
      out.result({
        data: {
          auth: runtime ? this.summarizeRuntimeAuth(runtime) : undefined,
          capabilities: inventory.capabilities,
          drift: driftReport.items,
          healthy: ledgerStatus.healthy,
          inventory,
          mode: network.type === 'sandbox' ? 'sandbox' : 'single-node',
          network: networkName,
          parties: ledgerStatus.parties.map(party => ({displayName: party.displayName, identifier: party.identifier})),
          profile: inventory.profile,
          reconcile: driftReport.reconcile,
          services,
          summary: summarizeStatusInventory(services),
          version: ledgerStatus.version,
        },
        success: ledgerStatus.healthy,
      })
    }

    if (!ledgerStatus.healthy) {
      this.exit(1)
    }
  }

  private async getLedgerStatus(
    baseUrl: string,
    token: string,
  ): Promise<{healthy: boolean; parties: Array<Record<string, unknown>>; version?: string}> {
    const client = this.createStatusLedgerClient(baseUrl, token)

    let healthy = false
    let version: string | undefined
    try {
      const versionInfo = await client.getVersion()
      healthy = true
      version = String(versionInfo.version ?? '')
    } catch {
      healthy = false
    }

    let parties: Array<Record<string, unknown>> = []
    if (healthy) {
      try {
        const result = await client.getParties()
        parties = result.partyDetails
      } catch {
        parties = []
      }
    }

    return {healthy, parties, version}
  }

  private printServiceTable(
    out: ReturnType<typeof createOutput>,
    services: RuntimeInventoryService[],
  ): void {
    out.table(
      ['Service', 'Status', 'Endpoint', 'Stability'],
      services.map(service => [
        service.name,
        service.status,
        service.endpoint ?? '-',
        service.stability,
      ]),
    )
  }

  private shouldCheckLedgerHealth(profile: NonNullable<CantonctlConfig['profiles']>[string]): boolean {
    const ledger = profile.services.ledger
    if (!ledger) return false
    if (!ledger.url) return true
    return /^https?:\/\/localhost(?::\d+)?/i.test(ledger.url)
      || /^https?:\/\/127\.0\.0\.1(?::\d+)?/i.test(ledger.url)
  }

  private summarizeRuntimeAuth(runtime: ResolvedProfileRuntime): {
    app: {credentialSource: string; envVarName: string; required: boolean}
    credentialSource: string
    envVarName: string
    mode: string
    operator: {
      credentialSource: string
      description: string
      envVarName: string
      prerequisites: string[]
      required: boolean
    }
    warnings: string[]
  } {
    return {
      app: {
        credentialSource: runtime.credential.source,
        envVarName: runtime.auth.app.envVarName,
        required: runtime.auth.app.required,
      },
      credentialSource: runtime.credential.source,
      envVarName: runtime.auth.envVarName,
      mode: runtime.auth.mode,
      operator: {
        credentialSource: runtime.operatorCredential.source,
        description: runtime.auth.operator.description,
        envVarName: runtime.auth.operator.envVarName,
        prerequisites: runtime.auth.operator.prerequisites,
        required: runtime.auth.operator.required,
      },
      warnings: runtime.auth.warnings,
    }
  }

  private async resolveStatusRuntime(
    config: CantonctlConfig,
    profileName: string,
  ): Promise<ResolvedProfileRuntime> {
    return this.createProfileRuntimeResolver().resolve({config, profileName})
  }

  private async tryResolveStatusRuntime(
    config: CantonctlConfig,
    profileName: string,
  ): Promise<ResolvedProfileRuntime | undefined> {
    try {
      return await this.resolveStatusRuntime(config, profileName)
    } catch {
      return undefined
    }
  }

  private tryInspectNetworkProfile(
    config: CantonctlConfig,
    networkName: string,
  ): ProfileInspection | undefined {
    const explicitProfileName = config.networkProfiles?.[networkName]
    if (explicitProfileName) {
      if (config.profiles?.[explicitProfileName]) {
        return inspectProfile(config, explicitProfileName)
      }
    }

    if (config.profiles?.[networkName]) {
      return inspectProfile(config, networkName)
    }

    if (networkName === 'local' && config['default-profile']) {
      if (config.profiles?.[config['default-profile']]) {
        return inspectProfile(config, config['default-profile'])
      }
    }

    return undefined
  }
}
