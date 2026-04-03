/**
 * @module serve
 *
 * Canton IDE Protocol Server — the generic backend that any IDE client
 * (browser playground, VS Code extension, Neovim plugin) connects to.
 *
 * Exposes a REST + WebSocket API backed by existing cantonctl libraries
 * (builder, test-runner, ledger-client, dev-server). The protocol is
 * documented at docs/reference/serve.md.
 *
 * Clients:
 * - `cantonctl playground` — serves the browser UI + starts this server
 * - `cantonctl serve` — headless mode (no UI, just the API)
 * - VS Code extension — connects to a running serve instance
 *
 * @example
 * ```ts
 * const server = createServeServer(deps)
 * await server.start({ port: 4000, projectDir: '/my-app' })
 * // Any IDE client connects to http://localhost:4000
 * ```
 */

import cors from 'cors'
import express, {type Request, type Response} from 'express'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import {WebSocketServer, type WebSocket} from 'ws'

import type {Builder} from './builder.js'
import {type CompatibilityReport, createCompatibilityReport as createCompatibilityReportDefault, listProfiles, resolveProfile, summarizeProfileServices, type ProfileListEntry, type ProfileServiceSummary} from './compat.js'
import {loadConfig as loadConfigDefault, type CantonctlConfig} from './config.js'
import type {NormalizedProfile, ServiceName} from './config-profile.js'
import {createCredentialStore} from './credential-store.js'
import {parseDamlSource, type DamlTemplate} from './daml-parser.js'
import {CantonctlError, ErrorCode} from './errors.js'
import {createBackendWithFallback} from './keytar-backend.js'
import {detectTopology} from './topology.js'
import type {OutputWriter} from './output.js'
import {createStableSplice as createStableSpliceDefault, resolveStableSpliceProfile, type StableSplice} from './splice-public.js'
import type {TestRunner} from './test-runner.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServeServerDeps {
  builder: Builder
  output: OutputWriter
  testRunner: TestRunner
  /** Factory for creating ledger clients — called with baseUrl + token. */
  createLedgerClient: (opts: {baseUrl: string; token: string}) => LedgerClientLike
  createCompatibilityReport?: (config: CantonctlConfig, profileName?: string) => CompatibilityReport
  createStableSplice?: () => StableSplice
  /** Factory for creating sandbox JWTs. */
  createToken: (opts: {actAs: string[]; admin: boolean; applicationId: string; readAs: string[]}) => Promise<string>
  loadProjectConfig?: (options: {dir: string}) => Promise<CantonctlConfig>
  probeService?: (request: ServiceProbeRequest) => Promise<ServiceProbeResult>
  resolveProfileToken?: (options: {
    config: CantonctlConfig
    fallbackToken: string
    profileName: string
  }) => Promise<string | undefined>
}

export interface LedgerClientLike {
  getVersion(signal?: AbortSignal): Promise<Record<string, unknown>>
  getParties(signal?: AbortSignal): Promise<{partyDetails: Array<Record<string, unknown>>}>
  getActiveContracts(params: {filter: {party: string; templateIds?: string[]}}, signal?: AbortSignal): Promise<{activeContracts: Array<Record<string, unknown>>}>
  submitAndWait(request: {actAs: string[]; commandId?: string; commands: unknown[]; userId?: string}, signal?: AbortSignal): Promise<{transaction: Record<string, unknown>}>
  allocateParty(params: {displayName: string; identifierHint?: string}, signal?: AbortSignal): Promise<{partyDetails: Record<string, unknown>}>
  uploadDar(darBytes: Uint8Array, signal?: AbortSignal): Promise<{mainPackageId: string}>
}

export interface ServeEvent {
  type: string
  [key: string]: unknown
}

export interface ServeServer {
  start(opts: {
    port: number
    projectDir: string
    ledgerUrl: string
    profileName?: string
    staticDir?: string
    multiNode?: boolean
  }): Promise<void>
  stop(): Promise<void>
  broadcast(event: ServeEvent): void
}

type ProfileResolutionSource = 'argument' | 'default-profile' | 'only-profile'
type ProfileHealthStatus = 'auth-required' | 'configured' | 'healthy' | 'unconfigured' | 'unreachable'
type ProbedServiceName = Extract<ServiceName, 'ans' | 'scan' | 'scanProxy' | 'tokenStandard' | 'validator'>

interface ResolvedServeProfile {
  profile: NormalizedProfile
  source: ProfileResolutionSource
}

interface ProfileServiceHealthEntry extends ProfileServiceSummary {
  error?: string
  healthy: boolean
  status: ProfileHealthStatus
  version?: string
}

interface ProfileStatusSummary {
  healthy: boolean
  profile: {
    experimental: boolean
    kind: NormalizedProfile['kind']
    name: string
  } | null
  services: ProfileServiceHealthEntry[]
}

interface ServiceProbeRequest {
  endpoint: string
  service: ProbedServiceName
}

interface ServiceProbeResult {
  detail: string
  endpoint?: string
  healthy: boolean
  status: Extract<ProfileHealthStatus, 'auth-required' | 'healthy' | 'unreachable'>
}

// ---------------------------------------------------------------------------
// File tree helper
// ---------------------------------------------------------------------------

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export async function buildFileTree(dir: string, relativeTo: string): Promise<FileNode[]> {
  const entries = await fs.promises.readdir(dir, {withFileTypes: true})
  const nodes: FileNode[] = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Skip hidden dirs and build artifacts
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue

    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(relativeTo, fullPath)

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, relativeTo)
      nodes.push({children, name: entry.name, path: relPath, type: 'directory'})
    } else {
      nodes.push({name: entry.name, path: relPath, type: 'file'})
    }
  }

  return nodes
}

// ---------------------------------------------------------------------------
// Template discovery — scans .daml files and parses templates
// ---------------------------------------------------------------------------

export async function scanDamlTemplates(projectDir: string): Promise<DamlTemplate[]> {
  const damlDir = path.join(projectDir, 'daml')
  const templates: DamlTemplate[] = []

  try {
    const entries = await fs.promises.readdir(damlDir, {recursive: true})
    for (const entry of entries) {
      const entryStr = String(entry)
      if (!entryStr.endsWith('.daml')) continue

      const filePath = path.join(damlDir, entryStr)
      const source = await fs.promises.readFile(filePath, 'utf-8')
      const result = parseDamlSource(source)
      templates.push(...result.templates)
    }
  } catch {
    // daml/ directory doesn't exist or can't be read
  }

  return templates
}

export function getLedgerBaseUrl(profile: NormalizedProfile, fallbackLedgerUrl: string): string {
  const ledger = profile.services.ledger
  if (!ledger) return fallbackLedgerUrl
  if (ledger.url) return ledger.url
  return `http://localhost:${ledger['json-api-port'] ?? 7575}`
}

export function parsePort(baseUrl: string, fallback: number): number {
  try {
    const {port, protocol} = new URL(baseUrl)
    if (port) return Number.parseInt(port, 10)
    return protocol === 'https:' ? 443 : 80
  } catch {
    return fallback
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof CantonctlError
    && (error.code === ErrorCode.LEDGER_AUTH_EXPIRED || error.code === ErrorCode.SERVICE_AUTH_FAILED)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function usesLocalLedgerRuntime(profile: NormalizedProfile, isMultiNode: boolean): boolean {
  if (profile.kind === 'sandbox') {
    return !profile.services.ledger?.url
  }

  if (profile.kind === 'canton-multi') {
    return isMultiNode
  }

  return false
}

async function defaultResolveProfileToken(options: {
  config: CantonctlConfig
  fallbackToken: string
  profileName: string
}): Promise<string | undefined> {
  const resolved = resolveProfile(options.config, options.profileName)
  const authKind = resolved.profile.services.auth?.kind

  if (
    resolved.profile.kind === 'sandbox'
    || resolved.profile.kind === 'canton-multi'
    || resolved.profile.kind === 'splice-localnet'
    || authKind === 'shared-secret'
    || authKind === 'none'
  ) {
    return options.fallbackToken
  }

  const networkName = Object.entries(options.config.networkProfiles ?? {})
    .find(([, profileName]) => profileName === options.profileName)?.[0] ?? options.profileName

  const {backend} = await createBackendWithFallback()
  const store = createCredentialStore({backend, env: process.env})
  return await store.resolve(networkName) ?? undefined
}

export async function defaultProbeService(request: ServiceProbeRequest): Promise<ServiceProbeResult> {
  try {
    const response = await fetch(request.endpoint, {method: 'GET'})
    if (response.status === 401 || response.status === 403) {
      return {
        detail: `HTTP ${response.status}`,
        endpoint: request.endpoint,
        healthy: false,
        status: 'auth-required',
      }
    }

    return {
      detail: response.ok ? request.endpoint : `HTTP ${response.status}`,
      endpoint: request.endpoint,
      healthy: response.status < 500,
      status: response.status < 500 ? 'healthy' : 'unreachable',
    }
  } catch (error) {
    return {
      detail: errorMessage(error),
      endpoint: request.endpoint,
      healthy: false,
      status: 'unreachable',
    }
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createServeServer(deps: ServeServerDeps): ServeServer {
  const {
    builder,
    createLedgerClient,
    createToken,
    output,
    testRunner,
  } = deps
  const createCompatibilityReport = deps.createCompatibilityReport ?? createCompatibilityReportDefault
  const createStableSplice = deps.createStableSplice ?? (() => createStableSpliceDefault())
  const loadProjectConfig = deps.loadProjectConfig ?? ((options: {dir: string}) => loadConfigDefault(options))
  const probeService = deps.probeService ?? defaultProbeService
  const resolveProfileToken = deps.resolveProfileToken ?? defaultResolveProfileToken
  const stableSplice = createStableSplice()

  let httpServer: http.Server | null = null
  let wss: WebSocketServer | null = null
  const clients = new Set<WebSocket>()

  function broadcast(event: ServeEvent): void {
    const msg = JSON.stringify(event)
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg)
      }
    }
  }

  return {
    broadcast,

    async start(opts) {
      const {ledgerUrl, port, projectDir, staticDir} = opts
      const config = await loadProjectConfig({dir: projectDir})
      const availableProfiles = listProfiles(config)
      const initialProfile = config.profiles && Object.keys(config.profiles).length > 0
        ? resolveProfile(config, opts.profileName)
        : null

      // Create JWT for sandbox
      const token = await createToken({
        actAs: ['Alice', 'Bob'],
        admin: true,
        applicationId: 'cantonctl-playground',
        readAs: ['Alice', 'Bob'],
      })

      // Detect multi-node topology:
      // - multiNode === true: explicitly requested (playground --full)
      // - multiNode === undefined: auto-detect from .cantonctl/ (serve --no-sandbox)
      // - multiNode === false: explicitly single-node, skip detection
      const topology = opts.multiNode !== false ? await detectTopology(projectDir) : null
      const isMultiNode = topology !== null && topology.participants.length > 0
      let currentProfileName = initialProfile?.profile.name
      let currentProfileSource: ProfileResolutionSource | null = initialProfile?.source ?? null
      const ledgerClientCache = new Map<string, LedgerClientLike>()

      function getCurrentProfile(): ResolvedServeProfile | null {
        if (!config.profiles || !currentProfileName) return null
        const profile = config.profiles[currentProfileName]
        if (!profile) return null

        return {
          profile,
          source: currentProfileSource ?? 'argument',
        }
      }

      function getCurrentProfileSummary() {
        const current = getCurrentProfile()
        if (!current) return null

        return {
          experimental: current.profile.experimental,
          kind: current.profile.kind,
          name: current.profile.name,
        }
      }

      function getProfileEnvelope() {
        return {
          profiles: availableProfiles,
          selectedProfile: getCurrentProfileSummary(),
          source: currentProfileSource,
        }
      }

      async function tokenForProfile(profileName: string): Promise<string | undefined> {
        return resolveProfileToken({
          config,
          fallbackToken: token,
          profileName,
        })
      }

      function getOrCreateLedgerClient(baseUrl: string, clientToken: string): LedgerClientLike {
        const cacheKey = `${baseUrl}::${clientToken}`
        const cached = ledgerClientCache.get(cacheKey)
        if (cached) return cached

        const client = createLedgerClient({baseUrl, token: clientToken})
        ledgerClientCache.set(cacheKey, client)
        return client
      }

      // Create ledger clients — one per participant in multi-node, or single
      const participantClients: Array<{client: LedgerClientLike; name: string; port: number}> = []

      if (isMultiNode) {
        for (const participant of topology!.participants) {
          const baseUrl = `http://localhost:${participant.ports.jsonApi}`
          participantClients.push({
            client: createLedgerClient({baseUrl, token}),
            name: participant.name,
            port: participant.ports.jsonApi,
          })
        }
      } else {
        const singleNodeBaseUrl = initialProfile?.profile
          ? getLedgerBaseUrl(initialProfile.profile, ledgerUrl)
          : ledgerUrl
        const singleNodeToken = initialProfile?.profile
          ? (await tokenForProfile(initialProfile.profile.name) ?? '')
          : token

        participantClients.push({
          client: getOrCreateLedgerClient(singleNodeBaseUrl, singleNodeToken),
          name: initialProfile?.profile.name ?? 'sandbox',
          port: parsePort(singleNodeBaseUrl, 7575),
        })
      }

      // Default client (first participant or single sandbox)
      const client = participantClients[0].client

      async function activeLedgerRuntime(): Promise<{
        client: LedgerClientLike
        participantClients: Array<{client: LedgerClientLike; name: string; port: number}>
      }> {
        const current = getCurrentProfile()
        if (!current?.profile.services.ledger || usesLocalLedgerRuntime(current.profile, isMultiNode)) {
          return {client, participantClients}
        }

        const baseUrl = getLedgerBaseUrl(current.profile, ledgerUrl)
        const resolvedToken = await tokenForProfile(current.profile.name) ?? ''
        const profileClient = getOrCreateLedgerClient(baseUrl, resolvedToken)

        return {
          client: profileClient,
          participantClients: [{
            client: profileClient,
            name: current.profile.name,
            port: parsePort(baseUrl, participantClients[0]?.port ?? 7575),
          }],
        }
      }

      function activeProfileContext() {
        const current = getCurrentProfile()
        if (!current) return undefined
        return resolveStableSpliceProfile(config, current.profile.name)
      }

      async function buildProfileStatus(): Promise<ProfileStatusSummary> {
        const current = getCurrentProfile()
        if (!current) {
          return {healthy: false, profile: null, services: []}
        }

        const runtime = await activeLedgerRuntime()
        const services = await Promise.all(
          summarizeProfileServices(current.profile).map(async (service): Promise<ProfileServiceHealthEntry> => {
            switch (service.name) {
              case 'ledger': {
                try {
                  const version = await runtime.client.getVersion()
                  return {
                    ...service,
                    endpoint: getLedgerBaseUrl(current.profile, ledgerUrl),
                    healthy: true,
                    status: 'healthy',
                    version: typeof version.version === 'string' ? version.version : undefined,
                  }
                } catch (error) {
                  return {
                    ...service,
                    endpoint: getLedgerBaseUrl(current.profile, ledgerUrl),
                    error: errorMessage(error),
                    healthy: false,
                    status: isAuthError(error) ? 'auth-required' : 'unreachable',
                  }
                }
              }

              case 'ans':
              case 'scan':
              case 'scanProxy':
              case 'tokenStandard':
              case 'validator': {
                if (!service.endpoint) {
                  return {
                    ...service,
                    healthy: false,
                    status: 'unconfigured',
                  }
                }

                const result = await probeService({
                  endpoint: service.endpoint,
                  service: service.name,
                })

                return {
                  ...service,
                  detail: result.detail,
                  endpoint: result.endpoint ?? service.endpoint,
                  healthy: result.healthy,
                  status: result.status,
                }
              }

              case 'auth':
              case 'localnet':
                return {
                  ...service,
                  healthy: false,
                  status: 'configured',
                }
            }
          }),
        )

        return {
          healthy: services.every(serviceStatus =>
            serviceStatus.status === 'configured' || serviceStatus.status === 'healthy',
          ),
          profile: {
            experimental: current.profile.experimental,
            kind: current.profile.kind,
            name: current.profile.name,
          },
          services,
        }
      }

      // Find the client where a party is local (for multi-node routing)
      async function clientForParty(partyId: string): Promise<LedgerClientLike> {
        const runtime = await activeLedgerRuntime()
        if (runtime.participantClients.length <= 1 || runtime.participantClients !== participantClients || !isMultiNode) {
          return runtime.client
        }

        for (const pc of participantClients) {
          try {
            const parties = await pc.client.getParties()
            if (parties.partyDetails.some((p: Record<string, unknown>) => p.party === partyId && p.isLocal === true)) {
              return pc.client
            }
          } catch { /* skip */ }
        }
        return runtime.client // fallback
      }

      // Express app
      const app = express()
      app.use(cors())
      app.use(express.json())

      // ── REST API ────────────────────────────────────────────────

      app.get('/api/profile', async (_req: Request, res: Response) => {
        res.json(getProfileEnvelope())
      })

      app.put('/api/profile', async (req: Request, res: Response) => {
        const requestedProfile = typeof req.body?.profile === 'string'
          ? req.body.profile.trim()
          : typeof req.body?.name === 'string'
            ? req.body.name.trim()
            : ''

        if (!requestedProfile) {
          res.status(400).json({error: 'profile field is required'})
          return
        }

        try {
          const resolved = resolveProfile(config, requestedProfile)
          currentProfileName = resolved.profile.name
          currentProfileSource = resolved.source
          res.json(getProfileEnvelope())
        } catch (error) {
          if (error instanceof CantonctlError) {
            res.status(400).json({error: error.message, suggestion: error.suggestion})
            return
          }

          res.status(500).json({error: errorMessage(error)})
        }
      })

      app.get('/api/profile/compat', async (_req: Request, res: Response) => {
        const current = getCurrentProfile()
        if (!current) {
          res.status(404).json({error: 'No runtime profile available'})
          return
        }

        res.json(createCompatibilityReport(config, current.profile.name))
      })

      app.get('/api/profile/status', async (_req: Request, res: Response) => {
        res.json(await buildProfileStatus())
      })

      app.get('/api/service-health', async (_req: Request, res: Response) => {
        res.json(await buildProfileStatus())
      })

      app.get('/api/splice/token-holdings', async (req: Request, res: Response) => {
        const party = typeof req.query.party === 'string' ? req.query.party.trim() : ''
        if (!party) {
          res.status(400).json({error: 'party query parameter required'})
          return
        }

        try {
          const current = getCurrentProfile()
          const result = await stableSplice.listTokenHoldings({
            instrumentAdmin: typeof req.query.instrumentAdmin === 'string' ? req.query.instrumentAdmin : undefined,
            instrumentId: typeof req.query.instrumentId === 'string' ? req.query.instrumentId : undefined,
            party,
            profile: activeProfileContext(),
            token: current ? await tokenForProfile(current.profile.name) : undefined,
          })
          res.json({...result, warnings: [...result.warnings]})
        } catch (error) {
          res.status(500).json({error: errorMessage(error)})
        }
      })

      app.get('/api/splice/scan/updates', async (req: Request, res: Response) => {
        const afterMigrationId = typeof req.query.afterMigrationId === 'string'
          ? Number.parseInt(req.query.afterMigrationId, 10)
          : undefined
        const afterRecordTime = typeof req.query.afterRecordTime === 'string'
          ? req.query.afterRecordTime
          : undefined

        if ((afterMigrationId === undefined) !== (afterRecordTime === undefined)) {
          res.status(400).json({error: 'afterMigrationId and afterRecordTime must be provided together'})
          return
        }

        try {
          const pageSize = typeof req.query.pageSize === 'string'
            ? Number.parseInt(req.query.pageSize, 10) || 20
            : 20
          const result = await stableSplice.listScanUpdates({
            after: afterMigrationId !== undefined && afterRecordTime
              ? {migrationId: afterMigrationId, recordTime: afterRecordTime}
              : undefined,
            pageSize,
            profile: activeProfileContext(),
          })
          res.json({...result, warnings: [...result.warnings]})
        } catch (error) {
          res.status(500).json({error: errorMessage(error)})
        }
      })

      // ── Topology ─────────────────────────────────────────────

      app.get('/api/topology', async (_req: Request, res: Response) => {
        res.json({
          mode: isMultiNode ? 'multi' : 'single',
          participants: participantClients.map(pc => ({name: pc.name, port: pc.port})),
          synchronizer: isMultiNode ? topology!.synchronizer : null,
          topology: isMultiNode ? {
            participants: topology!.participants.map(p => ({
              name: p.name,
              parties: p.parties,
              ports: p.ports,
            })),
            synchronizer: topology!.synchronizer,
          } : null,
        })
      })

      app.get('/api/topology/status', async (_req: Request, res: Response) => {
        const statuses = await Promise.all(
          participantClients.map(async (pc) => {
            let healthy = false
            let version: string | undefined
            let parties: Array<Record<string, unknown>> = []
            let contractCount = 0

            try {
              const v = await pc.client.getVersion()
              healthy = true
              version = v.version as string
            } catch { /* unhealthy */ }

            if (healthy) {
              try {
                const p = await pc.client.getParties()
                parties = p.partyDetails
              } catch { /* no parties */ }

              // Count contracts for each party
              for (const party of parties) {
                try {
                  const partyId = String(party.party ?? party.identifier ?? '')
                  if (partyId) {
                    const contracts = await pc.client.getActiveContracts({filter: {party: partyId}})
                    contractCount += contracts.activeContracts.length
                  }
                } catch { /* skip */ }
              }
            }

            return {
              contractCount,
              healthy,
              name: pc.name,
              parties,
              port: pc.port,
              version,
            }
          }),
        )

        res.json({participants: statuses})
      })

      // Read daml.yaml for project metadata (package name for template IDs)
      app.get('/api/project', async (_req: Request, res: Response) => {
        try {
          const damlYamlPath = path.join(projectDir, 'daml.yaml')
          const content = await fs.promises.readFile(damlYamlPath, 'utf-8')
          // Simple YAML extraction — just need name and version
          const nameMatch = content.match(/^name:\s*(.+)$/m)
          const versionMatch = content.match(/^version:\s*(.+)$/m)
          res.json({
            name: nameMatch?.[1]?.trim() ?? 'unknown',
            version: versionMatch?.[1]?.trim() ?? '0.0.0',
            projectDir,
          })
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.get('/api/health', async (_req: Request, res: Response) => {
        const status = await buildProfileStatus()
        const ledgerStatus = status.services.find(service => service.name === 'ledger')
        res.json({
          healthy: ledgerStatus?.healthy ?? false,
          profile: status.profile,
          services: status.services,
          version: ledgerStatus?.version,
        })
      })

      app.get('/api/files', async (_req: Request, res: Response) => {
        try {
          const tree = await buildFileTree(projectDir, projectDir)
          res.json(tree)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      // File operations — use middleware to handle subpaths (Express 5 compat)
      app.use('/api/files', async (req: Request, res: Response, next) => {
        // GET /api/files with no subpath → return file tree (handled above)
        if (req.path === '/' || req.path === '') {
          next()
          return
        }

        const reqPath = decodeURIComponent(req.path.slice(1))
        const filePath = path.join(projectDir, reqPath)
        if (!filePath.startsWith(projectDir)) {
          res.status(403).json({error: 'Path traversal not allowed'})
          return
        }

        if (req.method === 'GET') {
          try {
            const content = await fs.promises.readFile(filePath, 'utf-8')
            res.json({content, path: reqPath})
          } catch {
            res.status(404).json({error: 'File not found'})
          }

          return
        }

        if (req.method === 'PUT') {
          try {
            await fs.promises.mkdir(path.dirname(filePath), {recursive: true})
            await fs.promises.writeFile(filePath, req.body.content, 'utf-8')
            res.json({saved: true, path: reqPath})

            // Auto-build on .daml file save
            if (filePath.endsWith('.daml')) {
              broadcast({type: 'build:start'})
              try {
                const result = await builder.build({projectDir})
                broadcast({
                  dar: result.darPath,
                  durationMs: result.durationMs,
                  type: result.cached ? 'build:cached' : 'build:success',
                })
                // Auto-upload DAR to ALL participants after successful build
                if (result.darPath && !result.cached) {
                  const darBytes = await fs.promises.readFile(result.darPath)
                  const runtime = await activeLedgerRuntime()
                  for (const pc of runtime.participantClients) {
                    try {
                      await pc.client.uploadDar(new Uint8Array(darBytes))
                    } catch (uploadErr) { output.warn(`DAR upload to ${pc.name} failed: ${uploadErr}`) }
                  }

                  broadcast({
                    type: 'dar:uploaded',
                    dar: result.darPath,
                    participants: runtime.participantClients.map(pc => pc.name),
                  })
                }
              } catch (err) {
                broadcast({output: String(err), type: 'build:error'})
              }
            }
          } catch (err) {
            res.status(500).json({error: String(err)})
          }

          return
        }

        next()
      })

      app.get('/api/parties', async (_req: Request, res: Response) => {
        try {
          const runtime = await activeLedgerRuntime()
          const result = await runtime.client.getParties()
          res.json(result)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.post('/api/parties', async (req: Request, res: Response) => {
        try {
          const runtime = await activeLedgerRuntime()
          const result = await runtime.client.allocateParty({
            displayName: req.body.displayName,
            identifierHint: req.body.identifierHint,
          })
          res.json(result)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      // ── Template Discovery ──────────────────────────────────────

      app.get('/api/templates', async (_req: Request, res: Response) => {
        try {
          const templates = await scanDamlTemplates(projectDir)
          res.json({templates})
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.get('/api/templates/:name', async (req: Request, res: Response) => {
        try {
          const templates = await scanDamlTemplates(projectDir)
          const template = templates.find(t => t.name === String(req.params.name))
          if (!template) {
            res.status(404).json({error: `Template "${req.params.name}" not found`})
            return
          }

          res.json(template)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      // ── Multi-Party Contracts ─────────────────────────────────

      app.get('/api/contracts/multi', async (req: Request, res: Response) => {
        const partiesParam = req.query.parties as string
        if (!partiesParam) {
          res.status(400).json({error: 'parties query parameter required (comma-separated)'})
          return
        }

        const partyIds = partiesParam.split(',').map(p => p.trim()).filter(Boolean)
        try {
          const results: Record<string, Array<Record<string, unknown>>> = {}
          await Promise.all(
            partyIds.map(async (party) => {
              try {
                const targetClient = await clientForParty(party)
                const result = await targetClient.getActiveContracts({filter: {party}})
                results[party] = result.activeContracts
              } catch {
                results[party] = []
              }
            }),
          )
          res.json({contracts: results})
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      // ── Single-Party Contracts ────────────────────────────────

      app.get('/api/contracts', async (req: Request, res: Response) => {
        const party = req.query.party as string
        const templateId = req.query.templateId as string | undefined
        if (!party) {
          res.status(400).json({error: 'party query parameter required'})
          return
        }

        try {
          const targetClient = await clientForParty(party)
          const result = await targetClient.getActiveContracts({
            filter: {
              party,
              ...(templateId ? {templateIds: [templateId]} : {}),
            },
          })
          res.json(result)
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.post('/api/commands', async (req: Request, res: Response) => {
        try {
          // Route to the correct participant based on actAs party
          const actAsParty = req.body.actAs?.[0] as string | undefined
          const runtime = await activeLedgerRuntime()
          const targetClient = actAsParty ? await clientForParty(actAsParty) : runtime.client

          const result = await targetClient.submitAndWait({
            actAs: req.body.actAs,
            commandId: `playground-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            commands: req.body.commands,
            userId: 'admin',
          })
          res.json({
            ...result,
            updateId: typeof result.transaction.updateId === 'string' ? result.transaction.updateId : undefined,
          })
          broadcast({type: 'contracts:update'})
        } catch (err) {
          res.status(500).json({error: String(err)})
        }
      })

      app.post('/api/build', async (_req: Request, res: Response) => {
        broadcast({type: 'build:start'})
        try {
          const result = await builder.build({force: true, projectDir})
          broadcast({dar: result.darPath, durationMs: result.durationMs, type: 'build:success'})
          // Auto-upload DAR to ALL participants
          if (result.darPath) {
            const darBytes = await fs.promises.readFile(result.darPath)
            const runtime = await activeLedgerRuntime()
            for (const pc of runtime.participantClients) {
              try {
                await pc.client.uploadDar(new Uint8Array(darBytes))
              } catch (uploadErr) { output.warn(`DAR upload to ${pc.name} failed: ${uploadErr}`) }
            }

            broadcast({
              type: 'dar:uploaded',
              dar: result.darPath,
              participants: runtime.participantClients.map(pc => pc.name),
            })
          }

          res.json(result)
        } catch (err) {
          broadcast({output: String(err), type: 'build:error'})
          res.status(500).json({error: String(err)})
        }
      })

      app.post('/api/test', async (_req: Request, res: Response) => {
        broadcast({type: 'test:start'})
        try {
          const result = await testRunner.run({projectDir})
          broadcast({output: result.output, passed: result.passed, type: 'test:result'})
          res.json(result)
        } catch (err) {
          broadcast({output: String(err), passed: false, type: 'test:result'})
          res.status(500).json({error: String(err)})
        }
      })

      // Serve playground static files
      if (staticDir) {
        app.use(express.static(staticDir))
        app.use((_req: Request, res: Response) => {
          res.sendFile(path.join(staticDir, 'index.html'))
        })
      }

      // ── HTTP + WebSocket Server ─────────────────────────────────

      httpServer = http.createServer(app)
      wss = new WebSocketServer({server: httpServer})

      wss.on('connection', (ws: WebSocket) => {
        clients.add(ws)
        ws.on('close', () => clients.delete(ws))
        // Send initial status
        ws.send(JSON.stringify({type: 'connected'}))
      })

      // Auto-build on startup — compile DAR and upload to all participants
      // so contracts are immediately available when the browser connects
      try {
        const buildResult = await builder.build({projectDir})
        if (buildResult.darPath) {
          broadcast({dar: buildResult.darPath, durationMs: buildResult.durationMs, type: buildResult.cached ? 'build:cached' : 'build:success'})
          if (!buildResult.cached) {
            const darBytes = await fs.promises.readFile(buildResult.darPath)
            const runtime = await activeLedgerRuntime()
            for (const pc of runtime.participantClients) {
              try { await pc.client.uploadDar(new Uint8Array(darBytes)) }
              catch { /* upload may fail during sandbox init — will retry on next build */ }
            }
          }
        }
      } catch (err) {
        output.warn(`Initial build failed: ${err}`)
        broadcast({output: String(err), type: 'build:error'})
      }

      return new Promise<void>((resolve) => {
        httpServer!.listen(port, () => {
          output.success(`Canton IDE server running at http://localhost:${port}`)
          resolve()
        })
      })
    },

    async stop() {
      for (const ws of clients) ws.close()
      clients.clear()
      wss?.close()
      return new Promise<void>((resolve) => {
        if (httpServer) {
          httpServer.close(() => resolve())
        } else {
          resolve()
        }
      })
    },
  }
}
