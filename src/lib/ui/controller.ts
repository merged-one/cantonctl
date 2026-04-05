import * as fs from 'node:fs'
import * as path from 'node:path'

import * as yaml from 'js-yaml'

import {type CanaryRunner, createCanaryRunner, selectStablePublicCanarySuites} from '../canary/run.js'
import {createCompatibilityReport, listProfiles, resolveProfile, summarizeProfileServices} from '../compat.js'
import {findConfigPath, loadConfig, type CantonctlConfig} from '../config.js'
import type {NormalizedProfile, ServiceName} from '../config-profile.js'
import {createCredentialStore, type CredentialStore, type KeychainBackend} from '../credential-store.js'
import {createDiagnosticsBundleWriter, type DiagnosticsBundleWriter} from '../diagnostics/bundle.js'
import {createDiagnosticsCollector, type DiagnosticsCollector} from '../diagnostics/collect.js'
import {createNetworkDiscoveryFetcher, type NetworkDiscoveryFetcher} from '../discovery/fetch.js'
import {synthesizeProfileFromDiscovery, mergeProfileIntoConfigYaml} from '../discovery/synthesize.js'
import {createDoctor, type Doctor} from '../doctor.js'
import {CantonctlError, ErrorCode} from '../errors.js'
import {renderSdkConfigEnv, renderSdkConfigJson} from '../export/formatters.js'
import {createSdkConfigExporter, type SdkConfigExporter, type SdkConfigTarget} from '../export/sdk-config.js'
import {createSandboxToken} from '../jwt.js'
import {createBackendWithFallback} from '../keytar-backend.js'
import {createLedgerClient, type LedgerClient} from '../ledger-client.js'
import {createLocalnet, type Localnet, type LocalnetStatusResult} from '../localnet.js'
import {mergeLocalnetProfileIntoConfigYaml, synthesizeProfileFromLocalnetWorkspace} from '../localnet-import.js'
import {createLocalnetWorkspaceDetector, type LocalnetWorkspaceDetector} from '../localnet-workspace.js'
import {createOutput} from '../output.js'
import {type PreflightRunner, createPreflightChecks} from '../preflight/checks.js'
import {createProcessRunner} from '../process-runner.js'
import {createReadinessRunner, type ReadinessRunner} from '../readiness.js'
import {createProfileRuntimeResolver, resolveProfileNetworkName, type ProfileRuntimeResolver} from '../profile-runtime.js'
import {serializeTopologyManifest, type GeneratedTopology, detectTopology} from '../topology.js'

import type {
  UiActionKind,
  UiActivityEntry,
  UiAuthState,
  UiChecksData,
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
import {createUiJobStore, type UiJobStore} from './jobs.js'

interface UiActionOptions {
  payload?: Record<string, unknown>
  profileName?: string
}

export interface UiController {
  getChecks(options?: {profileName?: string}): Promise<UiChecksData>
  getJob(id: string): ReturnType<UiJobStore['get']>
  getOverview(options?: {profileName?: string}): Promise<UiOverviewData>
  getProfiles(options?: {profileName?: string}): Promise<UiProfilesData>
  getRuntime(options?: {profileName?: string}): Promise<UiRuntimeData>
  getSession(options?: {requestedProfile?: string}): Promise<UiSessionData>
  getSupport(options?: {profileName?: string}): Promise<UiSupportData>
  startAction(kind: UiActionKind, options?: UiActionOptions): Promise<{jobId: string}>
}

export interface UiControllerDeps {
  createBackendWithFallback?: typeof createBackendWithFallback
  createCanaryRunner?: () => CanaryRunner
  createCredentialStore?: (deps: {backend: KeychainBackend; env?: Record<string, string | undefined>}) => CredentialStore
  createDiagnosticsBundleWriter?: () => DiagnosticsBundleWriter
  createDiagnosticsCollector?: () => DiagnosticsCollector
  createDoctor?: typeof createDoctor
  createLedgerClient?: (options: {baseUrl: string; token: string}) => LedgerClient
  createLocalnet?: () => Localnet
  createLocalnetWorkspaceDetector?: () => LocalnetWorkspaceDetector
  createNetworkDiscoveryFetcher?: () => NetworkDiscoveryFetcher
  createPreflightRunner?: () => PreflightRunner
  createProcessRunner?: typeof createProcessRunner
  createProfileRuntimeResolver?: () => ProfileRuntimeResolver
  createReadinessRunner?: () => ReadinessRunner
  createSdkConfigExporter?: () => SdkConfigExporter
  cwd?: string
  detectTopology?: typeof detectTopology
  env?: Record<string, string | undefined>
  fetch?: typeof globalThis.fetch
  findConfigPath?: (startDir: string) => string | undefined
  jobStore?: UiJobStore
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
  const loadProjectConfig = deps.loadConfig ?? ((options?: {dir?: string}) => loadConfig({dir: options?.dir ?? cwd}))
  const resolveConfigPath = deps.findConfigPath ?? ((startDir: string) => findConfigPath(startDir))
  const createRuntimeResolver = deps.createProfileRuntimeResolver ?? (() => createProfileRuntimeResolver({env}))
  const createReadiness = deps.createReadinessRunner ?? (() => createReadinessRunner())
  const createPreflight = deps.createPreflightRunner ?? (() => createPreflightChecks())
  const createCanary = deps.createCanaryRunner ?? (() => createCanaryRunner())
  const createDoctorInstance = deps.createDoctor ?? createDoctor
  const createDiagnostics = deps.createDiagnosticsCollector ?? (() => createDiagnosticsCollector({fetch: fetchFn}))
  const createBundleWriter = deps.createDiagnosticsBundleWriter ?? (() => createDiagnosticsBundleWriter())
  const createDiscovery = deps.createNetworkDiscoveryFetcher ?? (() => createNetworkDiscoveryFetcher())
  const createExporter = deps.createSdkConfigExporter ?? (() => createSdkConfigExporter())
  const createBackend = deps.createBackendWithFallback ?? createBackendWithFallback
  const createStore = deps.createCredentialStore ?? createCredentialStore
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
  const jobs = deps.jobStore ?? createUiJobStore()

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
      const activity = toActivityEntries(jobs.list())

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
        recentOutputs: {
          diagnostics: activity.find(entry => entry.action === 'support/diagnostics-bundle'),
          sdkConfig: activity.find(entry => entry.action === 'support/export-sdk-config'),
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
        activity: toActivityEntries(jobs.list()),
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

    async startAction(kind, options = {}) {
      const preview = await buildActionPreview(kind, options)
      const job = jobs.start(
        {
          action: kind,
          mutating: kind !== 'support/discover-network',
          preview,
        },
        async () => {
          const result = await runAction(kind, options)
          return result
        },
      )

      return {jobId: job.id}
    },

    getJob(id) {
      return jobs.get(id)
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
      try {
        localnetStatus = await createLocalnetClient().status({
          profile: context.profile.services.localnet['source-profile'],
          workspace: context.profile.services.localnet.workspace,
        })
        const localnetService = services.find(service => service.name === 'localnet')
        if (localnetService) {
          localnetService.detail = context.profile.services.localnet.workspace
          localnetService.status = localnetStatus.health.validatorReadyz.healthy ? 'healthy' : 'unreachable'
          localnetService.tone = localnetStatus.health.validatorReadyz.healthy ? 'pass' : 'fail'
        }
      } catch (error) {
        const localnetService = services.find(service => service.name === 'localnet')
        if (localnetService) {
          localnetService.detail = error instanceof Error ? error.message : String(error)
          localnetService.status = 'unreachable'
          localnetService.tone = 'fail'
        }
      }
    }

    return {
      ledger,
      localnet: localnetStatus,
      services,
    }
  }

  async function buildTopologyRuntime(context: ProfileContext): Promise<UiRuntimeData['topology']> {
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

  async function runAction(
    kind: UiActionKind,
    options: UiActionOptions,
  ): Promise<{artifactPath?: string; result: unknown; summary?: string}> {
    switch (kind) {
      case 'auth/login':
        return runAuthLogin(options)
      case 'auth/logout':
        return runAuthLogout(options)
      case 'localnet/up':
        return runLocalnetCommand('up', options)
      case 'localnet/down':
        return runLocalnetCommand('down', options)
      case 'profiles/import-localnet':
        return runImportLocalnet(options)
      case 'profiles/import-scan':
        return runImportScan(options)
      case 'support/diagnostics-bundle':
        return runDiagnosticsBundle(options)
      case 'support/discover-network':
        return runDiscoverNetwork(options)
      case 'support/export-sdk-config':
        return runExportSdkConfig(options)
    }
  }

  async function buildActionPreview(kind: UiActionKind, options: UiActionOptions): Promise<string> {
    switch (kind) {
      case 'auth/login': {
        const context = await resolveProfileContext(options.profileName)
        const runtime = await createRuntimeResolver().resolve({
          config: context.config,
          profileName: context.profileName,
        })
        return `cantonctl auth login ${runtime.networkName}${options.payload?.token ? ' --token <redacted>' : ''}`
      }

      case 'auth/logout': {
        const context = await resolveProfileContext(options.profileName)
        const runtime = await createRuntimeResolver().resolve({
          config: context.config,
          profileName: context.profileName,
        })
        return `cantonctl auth logout ${runtime.networkName}`
      }

      case 'localnet/up':
      case 'localnet/down': {
        const context = await resolveProfileContext(options.profileName)
        const workspace = requireLocalnetWorkspace(context.profile)
        const profile = context.profile.services.localnet?.['source-profile']
        return `cantonctl localnet ${kind.split('/')[1]} --workspace ${workspace}${profile ? ` --profile ${profile}` : ''}`
      }

      case 'profiles/import-localnet':
        return `cantonctl profiles import-localnet --workspace ${String(options.payload?.workspace ?? '<workspace>')}${options.payload?.write ? ' --write' : ''}`

      case 'profiles/import-scan':
        return `cantonctl profiles import-scan --scan-url ${String(options.payload?.scanUrl ?? '<scan-url>')} --kind ${String(options.payload?.kind ?? '<kind>')}${options.payload?.write ? ' --write' : ''}`

      case 'support/diagnostics-bundle': {
        const context = await resolveProfileContext(options.profileName)
        return `cantonctl diagnostics bundle --profile ${context.profile.name}${options.payload?.output ? ` --output ${String(options.payload.output)}` : ''}`
      }

      case 'support/discover-network':
        return `cantonctl discover network --scan-url ${String(options.payload?.scanUrl ?? '<scan-url>')}`

      case 'support/export-sdk-config': {
        const context = await resolveProfileContext(options.profileName)
        return `cantonctl export sdk-config --profile ${context.profile.name} --target ${String(options.payload?.target ?? 'dapp-sdk')} --format ${String(options.payload?.format ?? 'json')}`
      }
    }
  }

  async function runAuthLogin(options: UiActionOptions) {
    const context = await resolveProfileContext(options.profileName)
    const runtime = await createRuntimeResolver().resolve({
      config: context.config,
      profileName: context.profileName,
    })
    const token = typeof options.payload?.token === 'string' ? options.payload.token : undefined

    if (runtime.credential.source === 'fallback' && !token) {
      return {
        result: {
          mode: runtime.auth.mode,
          network: runtime.networkName,
          persisted: false,
          source: 'generated',
        },
        summary: `Using local fallback auth for ${runtime.networkName}`,
      }
    }

    if (!token) {
      throw new CantonctlError(ErrorCode.DEPLOY_AUTH_FAILED, {
        suggestion: `Enter a bearer token for ${runtime.networkName}.`,
      })
    }

    const ledgerUrl = context.profile.services.ledger?.url
    if (ledgerUrl) {
      try {
        await createLedger({
          baseUrl: ledgerUrl,
          token,
        }).getVersion()
      } catch {
        // Match CLI behavior: best-effort verification before storing.
      }
    }

    const {backend, isKeychain} = await createBackend()
    await createStore({backend, env}).store(runtime.networkName, token, {mode: runtime.auth.mode})

    return {
      result: {
        mode: runtime.auth.mode,
        network: runtime.networkName,
        persisted: true,
        source: isKeychain ? 'keychain' : 'memory',
      },
      summary: `Stored credentials for ${runtime.networkName}`,
    }
  }

  async function runAuthLogout(options: UiActionOptions) {
    const context = await resolveProfileContext(options.profileName)
    const runtime = await createRuntimeResolver().resolve({
      config: context.config,
      profileName: context.profileName,
    })
    const {backend} = await createBackend()
    const removed = await createStore({backend, env}).remove(runtime.networkName)

    return {
      result: {
        network: runtime.networkName,
        removed,
      },
      summary: removed
        ? `Removed credentials for ${runtime.networkName}`
        : `No credentials stored for ${runtime.networkName}`,
    }
  }

  async function runLocalnetCommand(command: 'down' | 'up', options: UiActionOptions) {
    const context = await resolveProfileContext(options.profileName)
    const workspace = requireLocalnetWorkspace(context.profile)
    const profile = context.profile.services.localnet?.['source-profile']
    const localnet = createLocalnetClient()

    if (command === 'up') {
      const result = await localnet.up({profile, workspace})
      return {
        result,
        summary: `Started LocalNet workspace ${workspace}`,
      }
    }

    const result = await localnet.down({workspace})
    return {
      result,
      summary: `Stopped LocalNet workspace ${workspace}`,
    }
  }

  async function runImportLocalnet(options: UiActionOptions) {
    const workspace = expectString(options.payload?.workspace, 'workspace')
    const detector = createWorkspaceDetector()
    const discovered = await detector.detect(workspace)
    const synthesized = synthesizeProfileFromLocalnetWorkspace({
      name: typeof options.payload?.name === 'string' ? options.payload.name : undefined,
      networkName: typeof options.payload?.networkName === 'string' ? options.payload.networkName : undefined,
      sourceProfile: typeof options.payload?.sourceProfile === 'string'
        ? options.payload.sourceProfile as 'app-provider' | 'app-user' | 'sv'
        : undefined,
      workspace: discovered,
    })

    let artifactPath: string | undefined
    if (options.payload?.write) {
      const {configPath} = await loadUiConfig()
      const merged = mergeLocalnetProfileIntoConfigYaml({
        existingConfigYaml: fs.readFileSync(configPath, 'utf8'),
        synthesized,
      })
      fs.writeFileSync(configPath, merged, 'utf8')
      artifactPath = configPath
    }

    return {
      artifactPath,
      result: {
        networkName: synthesized.networkName,
        profile: synthesized.profile,
        profileName: synthesized.name,
        sourceProfile: synthesized.sourceProfile,
        warnings: synthesized.warnings,
        workspace: discovered.root,
        write: Boolean(options.payload?.write),
        yaml: synthesized.yaml,
      },
      summary: artifactPath
        ? `Imported ${synthesized.name} into ${artifactPath}`
        : `Previewed ${synthesized.name} from ${discovered.root}`,
    }
  }

  async function runImportScan(options: UiActionOptions) {
    const scanUrl = expectString(options.payload?.scanUrl, 'scanUrl')
    const kind = expectString(options.payload?.kind, 'kind') as 'remote-sv-network' | 'remote-validator'
    const discovery = await createDiscovery().fetch({scanUrl})
    const synthesized = synthesizeProfileFromDiscovery({
      discovery,
      kind,
      name: typeof options.payload?.name === 'string' ? options.payload.name : undefined,
    })

    let artifactPath: string | undefined
    if (options.payload?.write) {
      const {configPath} = await loadUiConfig()
      const merged = mergeProfileIntoConfigYaml({
        existingConfigYaml: fs.readFileSync(configPath, 'utf8'),
        synthesized,
      })
      fs.writeFileSync(configPath, merged, 'utf8')
      artifactPath = configPath
    }

    return {
      artifactPath,
      result: {
        discovery,
        profile: synthesized.profile,
        profileName: synthesized.name,
        warnings: synthesized.warnings,
        write: Boolean(options.payload?.write),
        yaml: synthesized.yaml,
      },
      summary: artifactPath
        ? `Imported ${synthesized.name} into ${artifactPath}`
        : `Previewed ${synthesized.name} from scan discovery`,
    }
  }

  async function runDiagnosticsBundle(options: UiActionOptions) {
    const context = await resolveProfileContext(options.profileName)
    const snapshot = await createDiagnostics().collect({
      config: context.config,
      profileName: context.profileName,
    })
    const outputDir = typeof options.payload?.output === 'string'
      ? options.payload.output
      : path.join(cwd, '.cantonctl', 'diagnostics', context.profile.name)
    const bundle = await createBundleWriter().write({
      outputDir,
      snapshot,
    })

    return {
      artifactPath: bundle.outputDir,
      result: {
        bundle,
        snapshot,
      },
      summary: `Wrote diagnostics bundle to ${bundle.outputDir}`,
    }
  }

  async function runDiscoverNetwork(options: UiActionOptions) {
    const scanUrl = typeof options.payload?.scanUrl === 'string'
      ? options.payload.scanUrl
      : await defaultScanUrl(options.profileName)
    const token = await resolveOptionalProfileToken(options.profileName)
    const discovery = await createDiscovery().fetch({scanUrl, token})
    return {
      result: discovery,
      summary: `Fetched network discovery from ${discovery.scanUrl}`,
    }
  }

  async function runExportSdkConfig(options: UiActionOptions) {
    const context = await resolveProfileContext(options.profileName)
    const target = (typeof options.payload?.target === 'string'
      ? options.payload.target
      : 'dapp-sdk') as SdkConfigTarget
    const format = typeof options.payload?.format === 'string' ? options.payload.format : 'json'
    const exported = await createExporter().exportConfig({
      config: context.config,
      profileName: context.profileName,
      target,
    })
    const rendered = format === 'env'
      ? renderSdkConfigEnv(exported)
      : renderSdkConfigJson(exported)

    return {
      result: {
        config: exported,
        format,
        rendered,
        target,
      },
      summary: `Exported ${target} config as ${format}`,
    }
  }

  async function defaultScanUrl(profileName?: string): Promise<string> {
    const context = await resolveProfileContext(profileName)
    const scanUrl = context.profile.services.scan?.url
    if (!scanUrl) {
      throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
        suggestion: 'Enter a scan URL or choose a profile with a configured scan endpoint.',
      })
    }

    return scanUrl
  }

  async function resolveOptionalProfileToken(profileName?: string): Promise<string | undefined> {
    try {
      const context = await resolveProfileContext(profileName)
      const runtime = await createRuntimeResolver().resolve({
        config: context.config,
        profileName: context.profileName,
      })
      return runtime.credential.token
    } catch {
      return undefined
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

function resolveRequestedProfileName(config: CantonctlConfig, profileName?: string): string | undefined {
  if (profileName) return profileName
  if (config['default-profile']) return config['default-profile']
  return Object.keys(config.profiles ?? {})[0]
}

function buildStorageKey(configPath: string): string {
  return `cantonctl-ui:${configPath}`
}

function deriveReadinessBadge(options: {
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

function buildEnvironmentPath(
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

function isLocalProfile(kind: NormalizedProfile['kind']): boolean {
  return kind === 'sandbox' || kind === 'canton-multi' || kind === 'splice-localnet'
}

function shouldCheckLocalEndpoint(endpoint: string): boolean {
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

function renderProfileYaml(profile: NormalizedProfile, networkMappings: string[]): string {
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

function stripUndefined<T>(value: T): T {
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

function requireLocalnetWorkspace(profile: NormalizedProfile): string {
  const workspace = profile.services.localnet?.workspace
  if (!workspace) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      suggestion: 'Import a LocalNet workspace first so this profile records its upstream workspace path.',
    })
  }

  return workspace
}

function expectString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
    suggestion: `Provide a value for "${field}".`,
  })
}

function toActivityEntries(records: ReturnType<UiJobStore['list']>): UiActivityEntry[] {
  return records.map(record => ({
    action: record.action,
    artifactPath: record.artifactPath,
    createdAt: record.createdAt,
    id: record.id,
    mutating: record.mutating,
    preview: record.preview,
    status: record.status,
    summary: record.summary,
  }))
}

function buildRemoteServiceMap(
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

function toHealthSummary(status: 'auth-required' | 'healthy' | 'not-exposed' | 'unreachable'): {status: string; tone: UiTone} {
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
