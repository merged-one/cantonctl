import * as fs from 'node:fs'
import * as path from 'node:path'

import * as yaml from 'js-yaml'

import {createCompatibilityReport, listProfiles, resolveProfile, summarizeProfileServices} from '../compat.js'
import {findConfigPath, loadConfig, type CantonctlConfig} from '../config.js'
import type {NormalizedProfile, ServiceName} from '../config-profile.js'
import {createDiagnosticsCollector, type DiagnosticsCollector} from '../diagnostics/collect.js'
import {createDoctor} from '../doctor.js'
import {CantonctlError, ErrorCode} from '../errors.js'
import {createSandboxToken} from '../jwt.js'
import {createLedgerClient, type LedgerClient} from '../ledger-client.js'
import {createLocalnet, type Localnet, type LocalnetStatusResult} from '../localnet.js'
import {createLocalnetWorkspaceDetector, type LocalnetWorkspaceDetector} from '../localnet-workspace.js'
import {createOutput} from '../output.js'
import {createProcessRunner} from '../process-runner.js'
import {createReadinessRunner, type ReadinessRunner} from '../readiness.js'
import {createProfileRuntimeResolver, type ProfileRuntimeResolver} from '../profile-runtime.js'
import {serializeTopologyManifest, type GeneratedTopology, detectTopology} from '../topology.js'

import type {
  UiAuthState,
  UiChecksData,
  UiMapData,
  UiMapEdge,
  UiMapFinding,
  UiMapGroup,
  UiMapNode,
  UiOverviewData,
  UiProfileDetailData,
  UiProfileSummary,
  UiProfilesData,
  UiRuntimeData,
  UiRuntimeEdge,
  UiRuntimeNode,
  UiServiceStatus,
  UiSessionData,
  UiSupportData,
  UiTone,
} from './contracts.js'

export interface UiController {
  getChecks(options?: {profileName?: string}): Promise<UiChecksData>
  getMap(options?: {profileName?: string}): Promise<UiMapData>
  getOverview(options?: {profileName?: string}): Promise<UiOverviewData>
  getProfiles(options?: {profileName?: string}): Promise<UiProfilesData>
  getRuntime(options?: {profileName?: string}): Promise<UiRuntimeData>
  getSession(options?: {requestedProfile?: string}): Promise<UiSessionData>
  getSupport(options?: {profileName?: string}): Promise<UiSupportData>
}

export interface UiControllerDeps {
  createDiagnosticsCollector?: () => DiagnosticsCollector
  createDoctor?: typeof createDoctor
  createLedgerClient?: (options: {baseUrl: string; token: string}) => LedgerClient
  createLocalnet?: () => Localnet
  createLocalnetWorkspaceDetector?: () => LocalnetWorkspaceDetector
  createProcessRunner?: typeof createProcessRunner
  createProfileRuntimeResolver?: () => ProfileRuntimeResolver
  createReadinessRunner?: () => ReadinessRunner
  cwd?: string
  detectTopology?: typeof detectTopology
  env?: Record<string, string | undefined>
  fetch?: typeof globalThis.fetch
  findConfigPath?: (startDir: string) => string | undefined
  loadConfig?: (options?: {dir?: string}) => Promise<CantonctlConfig>
}

interface ProfileContext {
  config: CantonctlConfig
  configPath: string
  profile: NormalizedProfile
  profileName: string
}

interface ProfileStatusSnapshot {
  ledger: {
    healthy?: boolean
    parties: Array<Record<string, unknown>>
    version?: string
  }
  localnet?: LocalnetStatusResult
  services: UiServiceStatus[]
}

export function createUiController(
  deps: UiControllerDeps = {},
): UiController {
  const cwd = deps.cwd ?? process.cwd()
  const env = deps.env ?? process.env
  const fetchFn = deps.fetch ?? globalThis.fetch
  const loadProjectConfig = deps.loadConfig ?? (() => loadConfig({dir: cwd}))
  const resolveConfigPath = deps.findConfigPath ?? ((startDir: string) => findConfigPath(startDir))
  const createRuntimeResolver = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver({env}))
  const createReadiness = deps.createReadinessRunner ?? (() => createReadinessRunner())
  const createDoctorInstance = deps.createDoctor ?? createDoctor
  const createDiagnostics = deps.createDiagnosticsCollector ?? (() => createDiagnosticsCollector({fetch: fetchFn}))
  const createLedger = deps.createLedgerClient ?? createLedgerClient
  const createRunner = deps.createProcessRunner ?? createProcessRunner
  const detectProjectTopology = deps.detectTopology ?? detectTopology
  const createWorkspaceDetector = deps.createLocalnetWorkspaceDetector ?? (() => createLocalnetWorkspaceDetector({
    access: (filePath: string) => fs.promises.access(filePath),
    readFile: (filePath: string) => fs.promises.readFile(filePath, 'utf8'),
  }))
  const createLocalnetClient = deps.createLocalnet ?? (() => createLocalnet({
    detectWorkspace: (workspace: string) => createWorkspaceDetector().detect(workspace),
    fetch: (url: string) => fetchFn(url) as Promise<{
      ok: boolean
      status: number
      text(): Promise<string>
    }>,
    runner: createRunner(),
  }))

  return {
    async getSession(options = {}) {
      const {config, configPath} = await loadUiConfig()
      const summaries = await buildProfileSummaries(config)
      const selectedProfile = resolveRequestedProfileName(config, options.requestedProfile)

      return {
        configPath,
        defaultProfile: config['default-profile'],
        profiles: summaries,
        project: {
          name: config.project.name,
          sdkVersion: config.project['sdk-version'],
        },
        requestedProfile: options.requestedProfile,
        selectedProfile,
        storageKey: buildStorageKey(configPath),
      }
    },

    async getMap(options = {}) {
      const context = await resolveProfileContext(options.profileName)
      const runtime = await createRuntimeResolver().resolve({
        config: context.config,
        profileName: context.profileName,
      })
      const readiness = await createReadiness().run({
        config: context.config,
        profileName: context.profileName,
      })
      const doctor = await createDoctorInstance({
        config: context.config,
        output: createOutput({json: true, quiet: true}),
        profileName: context.profileName,
        runner: createRunner(),
      }).check()
      const compatibility = createCompatibilityReport(context.config, context.profileName)
      const status = await buildProfileStatusSnapshot(context)

      const map = await buildMapGraph({
        compatibility,
        context,
        doctor,
        readiness,
        runtime,
        status,
      })

      return attachFindings(map, buildMapFindings({
        compatibility,
        doctor,
        map,
        readiness,
        runtime,
      }))
    },

    async getOverview(options = {}) {
      const context = await resolveProfileContext(options.profileName)
      const runtime = await createRuntimeResolver().resolve({
        config: context.config,
        profileName: context.profileName,
      })
      const readiness = await createReadiness().run({
        config: context.config,
        profileName: context.profileName,
      })
      const doctor = await createDoctorInstance({
        config: context.config,
        output: createOutput({json: true, quiet: true}),
        profileName: context.profileName,
        runner: createRunner(),
      }).check()
      const status = await buildProfileStatusSnapshot(context)

      return {
        advisories: [
          ...runtime.auth.warnings.map(warning => ({detail: warning, source: 'auth', tone: 'warn' as const})),
          ...readiness.preflight.checks
            .filter(check => check.status === 'warn' || check.status === 'fail')
            .map(check => ({
              detail: check.detail,
              source: check.name,
              tone: check.status === 'fail' ? 'fail' as const : 'warn' as const,
            })),
          ...doctor.checks
            .filter(check => check.status !== 'pass')
            .map(check => ({
              detail: check.detail,
              source: `doctor:${check.name}`,
              tone: check.status === 'fail' ? 'fail' as const : 'warn' as const,
            })),
        ].slice(0, 12),
        environmentPath: buildEnvironmentPath(context.config, context.profile.name),
        profile: {
          kind: context.profile.kind,
          name: context.profile.name,
        },
        readiness: {
          ...readiness.summary,
          success: readiness.success,
        },
        services: status.services,
      }
    },

    async getProfiles(options = {}) {
      const context = await resolveProfileContext(options.profileName)
      const summaries = await buildProfileSummaries(context.config)
      const runtime = await createRuntimeResolver().resolve({
        config: context.config,
        profileName: context.profileName,
      })
      const status = await buildProfileStatusSnapshot(context)
      const networkMappings = Object.entries(context.config.networkProfiles ?? {})
        .filter(([, mappedProfile]) => mappedProfile === context.profile.name)
        .map(([networkName]) => networkName)

      const detail: UiProfileDetailData = {
        auth: {
          authenticated: runtime.credential.source !== 'missing',
          mode: runtime.auth.mode,
          source: runtime.credential.source,
          warnings: runtime.auth.warnings,
        },
        imports: {
          localnet: context.profile.services.localnet ? {
            sourceProfile: context.profile.services.localnet['source-profile'],
            version: context.profile.services.localnet.version,
            workspace: context.profile.services.localnet.workspace,
          } : undefined,
          scan: context.profile.services.scan ? {
            url: context.profile.services.scan.url,
          } : undefined,
        },
        json: stripUndefined({
          ...context.profile,
          networkMappings,
        }),
        networkMappings,
        services: status.services,
        validation: {
          detail: 'cantonctl.yaml validates against the canonical schema.',
          valid: true,
        },
        yaml: renderProfileYaml(context.profile, networkMappings),
      }

      return {
        profiles: summaries,
        selected: {
          ...detail,
          experimental: context.profile.experimental,
          kind: context.profile.kind,
          name: context.profile.name,
          networkName: runtime.networkName,
        },
      }
    },

    async getRuntime(options = {}) {
      const context = await resolveProfileContext(options.profileName)
      const status = await buildProfileStatusSnapshot(context)

      switch (context.profile.kind) {
        case 'sandbox':
          return {
            autoPoll: true,
            mode: 'sandbox',
            profile: {
              kind: context.profile.kind,
              name: context.profile.name,
            },
            summary: {
              healthDetail: status.ledger.healthy === false ? 'Ledger unreachable.' : 'Ledger ready.',
              jsonApiPort: context.profile.services.ledger?.['json-api-port'],
              ledgerUrl: context.profile.services.ledger?.url
                ?? `http://localhost:${context.profile.services.ledger?.['json-api-port'] ?? 7575}`,
              partyCount: status.ledger.parties.length,
              version: status.ledger.version,
            },
          }

        case 'canton-multi': {
          const topology = await buildTopologyRuntime(context)
          return {
            autoPoll: true,
            mode: 'canton-multi',
            profile: {
              kind: context.profile.kind,
              name: context.profile.name,
            },
            topology,
          }
        }

        case 'splice-localnet': {
          const localnet = context.profile.services.localnet
          const selectedProfile = localnet?.['source-profile'] ?? 'sv'
          const statusResult = status.localnet
          const nodes: UiRuntimeNode[] = statusResult ? [
            {
              detail: localnet?.workspace,
              id: 'workspace',
              kind: 'workspace',
              label: 'LocalNet Workspace',
              status: 'configured',
              tone: 'info' as const,
              url: localnet?.workspace,
            },
            {
              id: 'ledger',
              kind: 'service',
              label: 'Ledger',
              status: 'configured',
              tone: 'info' as const,
              url: statusResult.services.ledger.url,
            },
            {
              id: 'validator',
              kind: 'service',
              label: 'Validator',
              status: statusResult.health.validatorReadyz.healthy ? 'healthy' : 'unreachable',
              tone: statusResult.health.validatorReadyz.healthy ? 'pass' as const : 'fail' as const,
              url: statusResult.services.validator.url,
            },
            {
              id: 'wallet',
              kind: 'service',
              label: 'Wallet',
              status: 'configured',
              tone: 'info' as const,
              url: statusResult.services.wallet.url,
            },
            ...(statusResult.services.scan ? [{
              id: 'scan',
              kind: 'service',
              label: 'Scan',
              status: 'configured',
              tone: 'info' as const,
              url: statusResult.services.scan.url,
            }] : []),
          ] : []
          const edges: UiRuntimeEdge[] = nodes.some(node => node.id === 'workspace')
            ? nodes
              .filter(node => node.id !== 'workspace')
              .map(node => ({from: 'workspace', label: selectedProfile, to: node.id}))
            : []

          return {
            autoPoll: true,
            mode: 'splice-localnet',
            profile: {
              kind: context.profile.kind,
              name: context.profile.name,
            },
            serviceMap: nodes.length > 0 ? {edges, nodes} : undefined,
            summary: {
              healthDetail: statusResult
                ? statusResult.health.validatorReadyz.healthy
                  ? 'Validator readyz healthy.'
                  : `Validator readyz ${statusResult.health.validatorReadyz.status || 'error'}.`
                : 'Import a LocalNet workspace to expose live LocalNet status.',
              ledgerUrl: statusResult?.services.ledger.url ?? context.profile.services.ledger?.url,
              workspace: localnet?.workspace,
            },
          }
        }

        case 'remote-sv-network':
        case 'remote-validator': {
          const diagnostics = await createDiagnostics().collect({
            config: context.config,
            profileName: context.profileName,
          })
          return {
            autoPoll: false,
            mode: 'remote',
            profile: {
              kind: context.profile.kind,
              name: context.profile.name,
            },
            serviceMap: buildRemoteServiceMap(context.profile, diagnostics),
          }
        }
      }
    },

    async getChecks(options = {}) {
      const context = await resolveProfileContext(options.profileName)
      const runtime = await createRuntimeResolver().resolve({
        config: context.config,
        profileName: context.profileName,
      })
      const readiness = await createReadiness().run({
        config: context.config,
        profileName: context.profileName,
      })
      const doctor = await createDoctorInstance({
        config: context.config,
        output: createOutput({json: true, quiet: true}),
        profileName: context.profileName,
        runner: createRunner(),
      }).check()
      const compatibility = createCompatibilityReport(context.config, context.profileName)

      return {
        auth: {
          authenticated: runtime.credential.source !== 'missing',
          envVarName: runtime.auth.envVarName,
          mode: runtime.auth.mode,
          source: runtime.credential.source,
          warnings: runtime.auth.warnings,
        },
        canary: readiness.canary,
        compatibility: {
          checks: compatibility.checks.map(check => ({
            detail: check.detail,
            name: check.name,
            status: check.status,
          })),
          failed: compatibility.failed,
          passed: compatibility.passed,
          warned: compatibility.warned,
        },
        doctor,
        preflight: {
          checks: readiness.preflight.checks.map(check => ({
            category: check.category,
            detail: check.detail,
            endpoint: check.endpoint,
            name: check.name,
            status: check.status,
          })),
          network: readiness.preflight.network,
          success: readiness.preflight.success,
        },
        profile: {
          kind: context.profile.kind,
          name: context.profile.name,
        },
        readiness: {
          ...readiness.summary,
          success: readiness.success,
        },
      }
    },

    async getSupport(options = {}) {
      const context = await resolveProfileContext(options.profileName)
      return {
        defaults: {
          diagnosticsOutputDir: path.join(cwd, '.cantonctl', 'diagnostics', context.profile.name),
          exportTargets: ['dapp-sdk', 'wallet-sdk', 'dapp-api'],
          scanUrl: context.profile.services.scan?.url,
        },
        profile: {
          kind: context.profile.kind,
          name: context.profile.name,
        },
      }
    },
  }

  async function loadUiConfig(): Promise<{config: CantonctlConfig; configPath: string}> {
    const config = await loadProjectConfig({dir: cwd})
    const configPath = resolveConfigPath(cwd)
    if (!configPath) {
      throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
        suggestion: 'Run "cantonctl init" to create a project.',
      })
    }

    return {config, configPath}
  }

  async function resolveProfileContext(profileName?: string): Promise<ProfileContext> {
    const {config, configPath} = await loadUiConfig()
    const resolvedName = resolveRequestedProfileName(config, profileName)
    const {profile} = resolveProfile(config, resolvedName)
    return {
      config,
      configPath,
      profile,
      profileName: profile.name,
    }
  }

  async function buildProfileSummaries(config: CantonctlConfig): Promise<UiProfileSummary[]> {
    const runtimeResolver = createRuntimeResolver()
    const entries = listProfiles(config)

    return Promise.all(entries.map(async (entry) => {
      const runtime = await runtimeResolver.resolve({
        config,
        profileName: entry.name,
      })
      const auth: UiAuthState = {
        authenticated: runtime.credential.source !== 'missing',
        mode: runtime.auth.mode,
        source: runtime.credential.source,
        warnings: runtime.auth.warnings,
      }

      return {
        auth,
        experimental: entry.experimental,
        isDefault: entry.isDefault,
        kind: entry.kind,
        name: entry.name,
        networkName: runtime.networkName,
        readiness: deriveReadinessBadge({
          authenticated: auth.authenticated,
          compatibilityFailed: runtime.compatibility.failed,
          compatibilityWarned: runtime.compatibility.warned,
          experimental: entry.experimental,
          local: isLocalProfile(entry.kind),
        }),
        services: entry.services,
      }
    }))
  }

  async function buildProfileStatusSnapshot(context: ProfileContext): Promise<ProfileStatusSnapshot> {
    const services = summarizeProfileServices(context.profile).map(service => ({
      detail: service.detail,
      endpoint: service.endpoint,
      name: service.name,
      stability: service.stability,
      status: 'configured',
      tone: 'info' as UiTone,
    }))

    const ledger: ProfileStatusSnapshot['ledger'] = {
      healthy: undefined,
      parties: [],
      version: undefined,
    }
    const ledgerService = services.find(service => service.name === 'ledger')
    if (ledgerService?.endpoint && shouldCheckLocalEndpoint(ledgerService.endpoint)) {
      const token = await createLocalFallbackToken(context.config)
      const ledgerStatus = await getLedgerStatus(ledgerService.endpoint, token)
      ledger.healthy = ledgerStatus.healthy
      ledger.parties = ledgerStatus.parties
      ledger.version = ledgerStatus.version
      ledgerService.status = ledgerStatus.healthy ? 'healthy' : 'unreachable'
      ledgerService.tone = ledgerStatus.healthy ? 'pass' : 'fail'
    }

    let localnetStatus: LocalnetStatusResult | undefined
    if (context.profile.kind === 'splice-localnet' && context.profile.services.localnet?.workspace) {
      const localnetService = services.find(service => service.name === 'localnet')!
      try {
        localnetStatus = await createLocalnetClient().status({
          profile: context.profile.services.localnet['source-profile'],
          workspace: context.profile.services.localnet.workspace,
        })
        localnetService.detail = context.profile.services.localnet.workspace
        localnetService.status = localnetStatus.health.validatorReadyz.healthy ? 'healthy' : 'unreachable'
        localnetService.tone = localnetStatus.health.validatorReadyz.healthy ? 'pass' : 'fail'
      } catch (error) {
        localnetService.detail = error instanceof Error ? error.message : String(error)
        localnetService.status = 'unreachable'
        localnetService.tone = 'fail'
      }
    }

    return {
      ledger,
      localnet: localnetStatus,
      services,
    }
  }

  async function buildMapGraph(options: {
    compatibility: ReturnType<typeof createCompatibilityReport>
    context: ProfileContext
    doctor: Awaited<ReturnType<ReturnType<typeof createDoctor>['check']>>
    readiness: Awaited<ReturnType<ReadinessRunner['run']>>
    runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
    status: ProfileStatusSnapshot
  }): Promise<UiMapData> {
    const readinessTone = toReadinessTone(options.readiness.summary)
    const profileNode: UiMapNode = {
      badges: [options.context.profile.kind, options.runtime.networkName],
      detail: options.context.profile.experimental
        ? 'Experimental profile.'
        : `Network ${options.runtime.networkName}.`,
      groupId: 'environment',
      id: 'profile',
      kind: 'profile',
      label: options.context.profile.name,
      status: options.readiness.success ? 'ready' : options.readiness.summary.failed > 0 ? 'attention' : 'advisory',
      tone: readinessTone,
    }
    const authNode = createAuthMapNode(options.runtime)
    const groups: UiMapGroup[] = [
      {
        description: 'Selected profile, auth posture, and environment context.',
        id: 'environment',
        label: 'Environment',
      },
    ]
    const overlays: UiMapData['overlays'] = ['health', 'parties', 'ports', 'auth', 'checks']
    const summary = buildMapSummary(options.context, options.readiness, options.status, options.runtime.networkName)

    switch (options.context.profile.kind) {
      case 'sandbox': {
        groups.push({
          description: 'Single local ledger surface for fast contract iteration.',
          id: 'runtime',
          label: 'Runtime',
        })

        const ledgerParties = options.status.ledger.parties.map(party => String(party.displayName ?? party.identifier ?? 'party'))
        const ledgerNode: UiMapNode = {
          badges: options.status.ledger.version ? [`SDK ${options.status.ledger.version}`] : undefined,
          detail: options.status.ledger.healthy === false
            ? 'Ledger unreachable.'
            : options.status.ledger.healthy
              ? 'Ledger ready.'
              : 'Ledger configured.',
          groupId: 'runtime',
          id: 'ledger',
          kind: 'service',
          label: 'Ledger',
          parties: ledgerParties,
          ports: {
            ...(typeof options.context.profile.services.ledger?.['json-api-port'] === 'number'
              ? {'json-api': options.context.profile.services.ledger['json-api-port']}
              : {}),
            ...(typeof options.context.profile.services.ledger?.port === 'number'
              ? {port: options.context.profile.services.ledger.port}
              : {}),
          },
          status: options.status.ledger.healthy === false
            ? 'unreachable'
            : options.status.ledger.healthy
              ? 'healthy'
              : 'configured',
          tone: options.status.ledger.healthy === false
            ? 'fail'
            : options.status.ledger.healthy
              ? 'pass'
              : 'info',
          url: options.context.profile.services.ledger?.url,
        }

        return {
          autoPoll: true,
          edges: [
            {from: 'profile', label: 'profile', to: 'auth', tone: readinessTone},
            {from: 'auth', label: 'talks to', to: 'ledger', tone: ledgerNode.tone},
          ],
          findings: [],
          groups,
          mode: 'sandbox',
          nodes: [profileNode, authNode, ledgerNode],
          overlays,
          profile: {kind: options.context.profile.kind, name: options.context.profile.name},
          summary,
        }
      }

      case 'canton-multi': {
        groups.push({
          description: 'Synchronizer plus participant placement for the active local topology.',
          id: 'topology',
          label: 'Topology',
        })

        const topology = await buildTopologyRuntime(options.context)
        const synchronizerNode: UiMapNode = {
          detail: `Topology ${topology.topologyName}.`,
          groupId: 'topology',
          id: 'synchronizer',
          kind: 'synchronizer',
          label: 'Synchronizer',
          ports: {
            admin: topology.synchronizer.admin,
            'public-api': topology.synchronizer.publicApi,
          },
          status: topology.participants.every(participant => participant.healthy) ? 'healthy' : 'degraded',
          tone: topology.participants.every(participant => participant.healthy) ? 'pass' : 'warn',
        }
        const participantNodes: UiMapNode[] = topology.participants.map(participant => ({
          badges: participant.version ? [`SDK ${participant.version}`] : undefined,
          detail: participant.healthy ? 'Participant healthy.' : 'Participant unreachable.',
          groupId: 'topology',
          id: `participant:${participant.name}`,
          kind: 'participant',
          label: participant.name,
          parties: participant.parties,
          ports: {
            admin: participant.ports.admin,
            'json-api': participant.ports.jsonApi,
            'ledger-api': participant.ports.ledgerApi,
          },
          status: participant.healthy ? 'healthy' : 'unreachable',
          tone: participant.healthy ? 'pass' : 'fail',
        }))

        return {
          autoPoll: true,
          edges: [
            {from: 'profile', label: 'profile', to: 'auth', tone: readinessTone},
            {from: 'auth', label: 'authorizes', to: 'synchronizer', tone: authNode.tone},
            ...participantNodes.map(node => ({
              from: 'synchronizer',
              label: 'sync',
              to: node.id,
              tone: node.tone,
            })),
          ],
          findings: [],
          groups,
          mode: 'canton-multi',
          nodes: [profileNode, authNode, synchronizerNode, ...participantNodes],
          overlays,
          profile: {kind: options.context.profile.kind, name: options.context.profile.name},
          summary: {
            ...summary,
            detail: `${topology.participants.length} participants in topology "${topology.topologyName}".`,
          },
        }
      }

      case 'splice-localnet': {
        groups.push({
          description: 'Imported LocalNet workspace and the public service surfaces it exposes.',
          id: 'workspace',
          label: 'Workspace',
        })
        groups.push({
          description: 'Service map derived from the imported LocalNet workspace.',
          id: 'services',
          label: 'Services',
        })

        const localnet = options.context.profile.services.localnet
        const workspaceNode: UiMapNode | null = localnet?.workspace
          ? {
            badges: [localnet['source-profile'] ?? 'sv'],
            detail: localnet.workspace,
            groupId: 'workspace',
            id: 'workspace',
            kind: 'workspace',
            label: 'LocalNet Workspace',
            status: options.status.localnet ? 'configured' : 'imported',
            tone: options.status.localnet ? 'info' : 'warn',
            url: localnet.workspace,
          }
          : null

        const localnetNodes = createServiceNodes(options.status.services, 'services')
        if (!localnetNodes.some(node => node.id === 'auth')) {
          localnetNodes.unshift(authNode)
        }

        if (options.context.profile.services.tokenStandard) {
          localnetNodes.push({
            detail: options.context.profile.services.tokenStandard.url,
            groupId: 'services',
            id: 'tokenStandard',
            kind: 'service',
            label: 'Token Standard',
            status: 'configured',
            tone: 'info',
            url: options.context.profile.services.tokenStandard.url,
          })
        }

        const nodes = [
          profileNode,
          ...(workspaceNode ? [workspaceNode] : []),
          ...localnetNodes,
        ]

        const edges: UiMapEdge[] = [
          {from: 'profile', label: 'profile', to: 'auth', tone: readinessTone},
          ...(workspaceNode
            ? localnetNodes
              .filter(node => node.id !== 'auth')
              .map(node => ({
                from: workspaceNode.id,
                label: localnet?.['source-profile'] ?? 'sv',
                to: node.id,
                tone: node.tone,
              }))
            : []),
          ...(localnetNodes.some(node => node.id === 'validator') && localnetNodes.some(node => node.id === 'ledger')
            ? [{from: 'validator', label: 'submits', to: 'ledger', tone: 'info' as const}]
            : []),
          ...(localnetNodes.some(node => node.id === 'scan') && localnetNodes.some(node => node.id === 'ledger')
            ? [{from: 'scan', label: 'indexes', to: 'ledger', tone: 'info' as const}]
            : []),
          ...(localnetNodes.some(node => node.id === 'tokenStandard') && localnetNodes.some(node => node.id === 'scan')
            ? [{from: 'tokenStandard', label: 'reads', to: 'scan', tone: 'info' as const}]
            : []),
        ]

        return {
          autoPoll: true,
          edges,
          findings: [],
          groups,
          mode: 'splice-localnet',
          nodes,
          overlays,
          profile: {kind: options.context.profile.kind, name: options.context.profile.name},
          summary: {
            ...summary,
            detail: localnet?.workspace
              ? `Workspace ${localnet.workspace}.`
              : 'Import a LocalNet workspace to populate the service map.',
          },
        }
      }

      case 'remote-sv-network':
      case 'remote-validator': {
        groups.push({
          description: 'Resolved remote services for the selected profile.',
          id: 'services',
          label: 'Services',
        })

        const diagnostics = await createDiagnostics().collect({
          config: options.context.config,
          profileName: options.context.profileName,
        })
        const remoteServiceMap = buildRemoteServiceMap(options.context.profile, diagnostics)
        const nodes: UiMapNode[] = [
          profileNode,
          ...remoteServiceMap.nodes.map(node => ({
            badges: node.id === 'auth' ? [options.runtime.auth.mode] : undefined,
            detail: node.detail,
            groupId: 'services',
            id: node.id,
            kind: (node.id === 'auth' ? 'auth' : 'service') as UiMapNode['kind'],
            label: node.label,
            status: node.status,
            tone: node.tone,
            url: node.url,
          })),
        ]
        if (!nodes.some(node => node.id === 'auth')) {
          nodes.splice(1, 0, authNode)
        }

        return {
          autoPoll: false,
          edges: [
            {from: 'profile', label: 'profile', to: 'auth', tone: readinessTone},
            ...remoteServiceMap.edges,
          ],
          findings: [],
          groups,
          mode: 'remote',
          nodes,
          overlays,
          profile: {kind: options.context.profile.kind, name: options.context.profile.name},
          summary,
        }
      }
    }
  }

  function buildMapFindings(options: {
    compatibility: ReturnType<typeof createCompatibilityReport>
    doctor: Awaited<ReturnType<ReturnType<typeof createDoctor>['check']>>
    map: UiMapData
    readiness: Awaited<ReturnType<ReadinessRunner['run']>>
    runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>
  }): UiMapFinding[] {
    const nodeIds = new Set(options.map.nodes.map(node => node.id))
    const findings: UiMapFinding[] = []

    for (const warning of options.runtime.auth.warnings) {
      findings.push({
        detail: warning,
        id: `auth-warning:${findings.length}`,
        nodeIds: resolveFindingNodeIds([warning, options.runtime.auth.mode], nodeIds, 'auth'),
        source: 'auth',
        title: 'Auth posture',
        tone: options.runtime.credential.source === 'missing' ? 'fail' : 'warn',
      })
    }

    if (options.runtime.credential.source === 'missing') {
      findings.push({
        detail: 'No credential is currently resolved for this profile.',
        id: `auth-missing:${findings.length}`,
        nodeIds: resolveFindingNodeIds(['credential', options.runtime.auth.mode], nodeIds, 'auth'),
        source: 'auth',
        title: 'Credential required',
        tone: 'fail',
      })
    }

    for (const check of options.compatibility.checks.filter(check => check.status !== 'pass')) {
      findings.push({
        detail: check.detail,
        id: `compat:${check.name}:${findings.length}`,
        nodeIds: resolveFindingNodeIds([check.name, check.detail], nodeIds, 'profile'),
        source: 'compatibility',
        title: check.name,
        tone: check.status === 'fail' ? 'fail' : 'warn',
      })
    }

    for (const check of options.readiness.preflight.checks.filter(check => check.status === 'warn' || check.status === 'fail')) {
      findings.push({
        detail: check.detail,
        id: `preflight:${check.name}:${findings.length}`,
        nodeIds: resolveFindingNodeIds([check.category, check.name, check.detail, check.endpoint ?? ''], nodeIds, 'profile'),
        source: 'preflight',
        title: check.name,
        tone: check.status === 'fail' ? 'fail' : 'warn',
      })
    }

    for (const check of options.doctor.checks.filter(check => check.status !== 'pass')) {
      findings.push({
        detail: check.detail,
        id: `doctor:${check.name}:${findings.length}`,
        nodeIds: ['profile'],
        source: 'doctor',
        title: check.name,
        tone: check.status === 'fail' ? 'fail' : 'warn',
      })
    }

    for (const check of options.readiness.canary.checks) {
      if (check.status === 'fail') {
        findings.push({
          detail: check.detail,
          id: `canary:${check.suite}:${findings.length}`,
          nodeIds: resolveFindingNodeIds([check.suite, check.detail], nodeIds, 'profile'),
          source: 'canary',
          title: check.suite,
          tone: 'fail',
        })
      }

      for (const warning of check.warnings) {
        findings.push({
          detail: warning,
          id: `canary:${check.suite}:warning:${findings.length}`,
          nodeIds: resolveFindingNodeIds([check.suite, warning], nodeIds, 'profile'),
          source: 'canary',
          title: check.suite,
          tone: 'warn',
        })
      }
    }

    return findings
  }

  function attachFindings(map: UiMapData, findings: UiMapFinding[]): UiMapData {
    const findingIdsByNode = new Map<string, string[]>()

    for (const finding of findings) {
      for (const nodeId of finding.nodeIds) {
        const current = findingIdsByNode.get(nodeId) ?? []
        current.push(finding.id)
        findingIdsByNode.set(nodeId, current)
      }
    }

    return {
      ...map,
      findings,
      nodes: map.nodes.map(node => ({
        ...node,
        findingIds: findingIdsByNode.get(node.id) ?? [],
      })),
    }
  }

  async function buildTopologyRuntime(context: ProfileContext): Promise<NonNullable<UiRuntimeData['topology']>> {
    const topology = await detectProjectTopology(cwd)
    if (!topology) {
      return {
        exportJson: '',
        participants: [],
        synchronizer: {admin: 0, publicApi: 0},
        topologyName: 'unavailable',
      }
    }

    const token = await createLocalFallbackToken(context.config)
    const participants = await Promise.all(topology.participants.map(async participant => {
      const status = await getLedgerStatus(`http://localhost:${participant.ports.jsonApi}`, token)
      return {
        healthy: status.healthy,
        name: participant.name,
        parties: status.parties.length > 0
          ? status.parties.map(party => String(party.displayName ?? party.identifier ?? 'party'))
          : participant.parties,
        ports: participant.ports,
        version: status.version,
      }
    }))

    return {
      exportJson: serializeTopologyManifest(topology),
      participants,
      synchronizer: topology.synchronizer,
      topologyName: topology.manifest?.metadata.topologyName ?? 'default',
    }
  }

  async function getLedgerStatus(baseUrl: string, token: string) {
    const client = createLedger({baseUrl, token})

    try {
      const versionInfo = await client.getVersion()
      let parties: Array<Record<string, unknown>> = []
      try {
        const result = await client.getParties()
        parties = result.partyDetails
      } catch {
        parties = []
      }

      return {
        healthy: true,
        parties,
        version: String(versionInfo.version ?? ''),
      }
    } catch {
      return {
        healthy: false,
        parties: [] as Array<Record<string, unknown>>,
        version: undefined,
      }
    }
  }

  async function createLocalFallbackToken(config: CantonctlConfig): Promise<string> {
    const partyNames = config.parties?.map(party => party.name) ?? []
    return createSandboxToken({
      actAs: partyNames.length > 0 ? partyNames : ['admin'],
      admin: true,
      applicationId: 'cantonctl-ui',
      readAs: partyNames,
    })
  }
}

export function resolveRequestedProfileName(config: CantonctlConfig, profileName?: string): string | undefined {
  if (profileName) return profileName
  if (config['default-profile']) return config['default-profile']
  return Object.keys(config.profiles ?? {})[0]
}

export function buildStorageKey(configPath: string): string {
  return `cantonctl-ui:${configPath}`
}

function toReadinessTone(summary: {
  failed: number
  warned: number
}): UiTone {
  if (summary.failed > 0) return 'fail'
  if (summary.warned > 0) return 'warn'
  return 'pass'
}

function buildMapSummary(
  context: ProfileContext,
  readiness: Awaited<ReturnType<ReadinessRunner['run']>>,
  status: ProfileStatusSnapshot,
  networkName: string,
): UiMapData['summary'] {
  const headline = readiness.summary.failed > 0
    ? `${readiness.summary.failed} blocking ${readiness.summary.failed === 1 ? 'issue' : 'issues'}`
    : readiness.summary.warned > 0
      ? `${readiness.summary.warned} advisory ${readiness.summary.warned === 1 ? 'finding' : 'findings'}`
      : 'Mapped surfaces healthy'

  const detail = context.profile.kind === 'sandbox'
    ? `Sandbox profile on ${networkName}; ${status.ledger.parties.length} visible ${status.ledger.parties.length === 1 ? 'party' : 'parties'}.`
    : context.profile.kind === 'canton-multi'
      ? `Local multi-participant topology on ${networkName}.`
      : context.profile.kind === 'splice-localnet'
        ? `Imported LocalNet workspace on ${networkName}.`
        : `Remote service graph on ${networkName}.`

  return {
    detail,
    headline,
    readiness: {
      ...readiness.summary,
      success: readiness.success,
    },
  }
}

function createAuthMapNode(
  runtime: Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>,
): UiMapNode {
  return {
    badges: [runtime.auth.mode, runtime.credential.source],
    detail: runtime.auth.warnings[0] ?? `Credential source: ${runtime.credential.source}.`,
    groupId: 'environment',
    id: 'auth',
    kind: 'auth',
    label: 'Auth',
    status: runtime.credential.source === 'missing' ? 'missing' : runtime.credential.source === 'fallback' ? 'fallback' : 'configured',
    tone: runtime.credential.source === 'missing' ? 'fail' : runtime.auth.warnings.length > 0 ? 'warn' : 'pass',
  }
}

function createServiceNodes(
  services: UiServiceStatus[],
  groupId: string,
): UiMapNode[] {
  return services.map(service => ({
    badges: [service.stability],
    detail: service.detail,
    groupId,
    id: service.name,
    kind: 'service',
    label: service.name === 'localnet'
      ? 'LocalNet'
      : service.name === 'tokenStandard'
        ? 'Token Standard'
        : service.name,
    status: service.status,
    tone: service.tone,
    url: service.endpoint,
  }))
}

function resolveFindingNodeIds(
  fragments: string[],
  nodeIds: Set<string>,
  fallback: string,
): string[] {
  const text = fragments.join(' ').toLowerCase()
  const matches = new Set<string>()
  const keywordMap: Array<{keywords: string[]; nodeId: string}> = [
    {keywords: ['token-standard', 'token standard'], nodeId: 'tokenStandard'},
    {keywords: ['scan proxy', 'scan-proxy', 'scanproxy'], nodeId: 'scanProxy'},
    {keywords: ['validator'], nodeId: 'validator'},
    {keywords: ['wallet'], nodeId: 'wallet'},
    {keywords: ['ledger'], nodeId: 'ledger'},
    {keywords: ['scan'], nodeId: 'scan'},
    {keywords: ['auth', 'credential', 'token'], nodeId: 'auth'},
    {keywords: ['ans'], nodeId: 'ans'},
    {keywords: ['workspace', 'localnet'], nodeId: 'workspace'},
    {keywords: ['synchronizer', 'domain'], nodeId: 'synchronizer'},
    {keywords: ['profile', 'sdk'], nodeId: 'profile'},
  ]

  for (const entry of keywordMap) {
    if (entry.keywords.some(keyword => text.includes(keyword)) && nodeIds.has(entry.nodeId)) {
      matches.add(entry.nodeId)
    }
  }

  for (const nodeId of nodeIds) {
    if (nodeId.startsWith('participant:')) {
      const label = nodeId.replace('participant:', '').toLowerCase()
      if (text.includes(label)) {
        matches.add(nodeId)
      }
    }
  }

  return matches.size > 0
    ? [...matches]
    : [fallback]
}

export function deriveReadinessBadge(options: {
  authenticated: boolean
  compatibilityFailed: number
  compatibilityWarned: number
  experimental: boolean
  local: boolean
}): {detail: string; tone: UiTone} {
  if (!options.authenticated && !options.local) {
    return {detail: 'Auth required', tone: 'fail'}
  }

  if (options.compatibilityFailed > 0) {
    return {detail: 'Compatibility blocking', tone: 'fail'}
  }

  if (options.experimental) {
    return {detail: 'Experimental profile', tone: 'warn'}
  }

  if (options.compatibilityWarned > 0) {
    return {detail: 'Compatibility warnings', tone: 'warn'}
  }

  return {detail: options.local ? 'Local runtime' : 'Ready', tone: options.local ? 'info' : 'pass'}
}

export function buildEnvironmentPath(
  config: CantonctlConfig,
  selectedProfileName: string,
): UiOverviewData['environmentPath'] {
  const stages = [
    {
      label: 'Sandbox',
      profiles: Object.values(config.profiles ?? {})
        .filter(profile => profile.kind === 'sandbox')
        .map(profile => profile.name),
      stage: 'sandbox' as const,
    },
    {
      label: 'Local Control Plane',
      profiles: Object.values(config.profiles ?? {})
        .filter(profile => profile.kind === 'canton-multi' || profile.kind === 'splice-localnet')
        .map(profile => profile.name),
      stage: 'local' as const,
    },
    {
      label: 'Remote Network',
      profiles: Object.values(config.profiles ?? {})
        .filter(profile => profile.kind === 'remote-sv-network' || profile.kind === 'remote-validator')
        .map(profile => profile.name),
      stage: 'remote' as const,
    },
  ]

  return stages
    .filter(stage => stage.profiles.length > 0)
    .map(stage => ({
      ...stage,
      active: stage.profiles.includes(selectedProfileName),
    }))
}

export function isLocalProfile(kind: NormalizedProfile['kind']): boolean {
  return kind === 'sandbox' || kind === 'canton-multi' || kind === 'splice-localnet'
}

export function shouldCheckLocalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return (
      url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname.endsWith('.localhost')
    )
  } catch {
    return false
  }
}

export function renderProfileYaml(profile: NormalizedProfile, networkMappings: string[]): string {
  const document = stripUndefined({
    networks: networkMappings.length > 0
      ? Object.fromEntries(networkMappings.map(networkName => [networkName, {profile: profile.name}]))
      : undefined,
    profiles: {
      [profile.name]: stripUndefined({
        ans: profile.services.ans,
        auth: profile.services.auth,
        experimental: profile.experimental || undefined,
        kind: profile.kind,
        ledger: profile.services.ledger,
        localnet: profile.services.localnet,
        scan: profile.services.scan,
        scanProxy: profile.services.scanProxy,
        tokenStandard: profile.services.tokenStandard,
        validator: profile.services.validator,
      }),
    },
  })

  return yaml.dump(document, {lineWidth: 120}).trim()
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map(item => stripUndefined(item))
      .filter(item => item !== undefined) as T
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefined(child)])
    return Object.fromEntries(entries) as T
  }

  return value
}

export function buildRemoteServiceMap(
  profile: NormalizedProfile,
  diagnostics: Awaited<ReturnType<DiagnosticsCollector['collect']>>,
): {edges: UiRuntimeEdge[]; nodes: UiRuntimeNode[]} {
  const services = summarizeProfileServices(profile)
  const healthByService = new Map<string, {status: string; tone: UiTone}>()

  for (const health of diagnostics.health) {
    const serviceName = health.name.split('-')[0]
    const current = healthByService.get(serviceName)
    const next = toHealthSummary(health.status)
    if (!current || current.tone === 'info') {
      healthByService.set(serviceName, next)
    }
  }

  const nodes = services.map((service) => {
    const health = healthByService.get(service.name)
    return {
      detail: service.detail,
      id: service.name,
      kind: 'service',
      label: service.name,
      status: health?.status ?? 'configured',
      tone: health?.tone ?? 'info',
      url: service.endpoint,
    }
  })

  const edges: UiRuntimeEdge[] = []
  if (nodes.some(node => node.id === 'auth') && nodes.some(node => node.id === 'ledger')) {
    edges.push({from: 'auth', label: 'authenticates', to: 'ledger'})
  }

  if (nodes.some(node => node.id === 'scan') && nodes.some(node => node.id === 'ledger')) {
    edges.push({from: 'scan', label: 'indexes', to: 'ledger'})
  }

  if (nodes.some(node => node.id === 'validator') && nodes.some(node => node.id === 'ledger')) {
    edges.push({from: 'validator', label: 'submits', to: 'ledger'})
  }

  if (nodes.some(node => node.id === 'tokenStandard') && nodes.some(node => node.id === 'scan')) {
    edges.push({from: 'tokenStandard', label: 'reads', to: 'scan'})
  }

  if (nodes.some(node => node.id === 'ans') && nodes.some(node => node.id === 'scan')) {
    edges.push({from: 'ans', label: 'resolves via', to: 'scan'})
  }

  return {edges, nodes}
}

export function toHealthSummary(status: 'auth-required' | 'healthy' | 'not-exposed' | 'unreachable'): {status: string; tone: UiTone} {
  switch (status) {
    case 'healthy':
      return {status: 'healthy', tone: 'pass'}
    case 'auth-required':
      return {status: 'auth-required', tone: 'warn'}
    case 'not-exposed':
      return {status: 'not-exposed', tone: 'skip'}
    case 'unreachable':
      return {status: 'unreachable', tone: 'fail'}
  }
}
