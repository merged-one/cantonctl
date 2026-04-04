import {CantonctlError, ErrorCode} from './errors.js'

export type NetworkAuthMode = 'jwt' | 'shared-secret' | 'none'
export type LegacyNetworkType = 'sandbox' | 'remote' | 'docker'
export type ProfileKind =
  | 'sandbox'
  | 'canton-multi'
  | 'splice-localnet'
  | 'remote-validator'
  | 'remote-sv-network'
export type ProfileNetworkKind = 'ledger' | 'splice'
export type ServiceName =
  | 'ledger'
  | 'scan'
  | 'scanProxy'
  | 'validator'
  | 'tokenStandard'
  | 'ans'
  | 'auth'
  | 'localnet'

export interface LegacyNetworkConfig {
  auth?: NetworkAuthMode
  'json-api-port'?: number
  port?: number
  type: LegacyNetworkType
  url?: string
}

export interface NetworkProfileReference {
  kind?: ProfileNetworkKind
  profile: string
}

export type NetworkConfigInput = LegacyNetworkConfig | NetworkProfileReference

export interface UrlServiceConfig {
  url: string
}

export interface LedgerServiceConfig {
  auth?: NetworkAuthMode
  'json-api-port'?: number
  port?: number
  url?: string
}

export interface AuthServiceConfig {
  audience?: string
  issuer?: string
  kind: NetworkAuthMode | 'oidc'
  url?: string
}

export interface LocalnetServiceConfig {
  'base-port'?: number
  'canton-image'?: string
  distribution?: string
  version?: string
}

export interface RawProfileConfig {
  ans?: UrlServiceConfig
  auth?: AuthServiceConfig
  experimental?: boolean
  kind: ProfileKind
  ledger?: LedgerServiceConfig
  localnet?: LocalnetServiceConfig
  scan?: UrlServiceConfig
  scanProxy?: UrlServiceConfig
  tokenStandard?: UrlServiceConfig
  validator?: UrlServiceConfig
}

export interface ProfileServices {
  ans?: UrlServiceConfig
  auth?: AuthServiceConfig
  ledger?: LedgerServiceConfig
  localnet?: LocalnetServiceConfig
  scan?: UrlServiceConfig
  scanProxy?: UrlServiceConfig
  tokenStandard?: UrlServiceConfig
  validator?: UrlServiceConfig
}

export interface NormalizedProfile {
  experimental: boolean
  kind: ProfileKind
  name: string
  services: ProfileServices
}

export interface ProfileConfigSource {
  'default-profile'?: string
  networks?: Record<string, NetworkConfigInput>
  project?: {name: string; 'sdk-version': string; template?: string}
  profiles?: Record<string, RawProfileConfig>
  version?: number
}

export interface NormalizedProfileConfig {
  defaultProfile?: string
  networks: Record<string, LegacyNetworkConfig>
  profiles: Record<string, NormalizedProfile>
}

type Issue = {message: string; path: string}

const SERVICE_NAMES: ServiceName[] = [
  'ledger',
  'scan',
  'scanProxy',
  'validator',
  'tokenStandard',
  'ans',
  'auth',
  'localnet',
]

const ALLOWED_SERVICES: Record<ProfileKind, ServiceName[]> = {
  'canton-multi': ['ledger', 'auth', 'localnet'],
  'remote-sv-network': ['ledger', 'scan', 'scanProxy', 'tokenStandard', 'ans', 'auth'],
  'remote-validator': ['ledger', 'scan', 'scanProxy', 'validator', 'tokenStandard', 'ans', 'auth'],
  sandbox: ['ledger', 'auth'],
  'splice-localnet': ['ledger', 'scan', 'scanProxy', 'validator', 'tokenStandard', 'ans', 'auth', 'localnet'],
}

export function normalizeConfigProfiles(config: ProfileConfigSource): NormalizedProfileConfig {
  const issues: Issue[] = []
  const profiles: Record<string, NormalizedProfile> = {}

  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    profiles[name] = normalizeProfile(name, profile)
  }

  for (const [name, network] of Object.entries(config.networks ?? {})) {
    if (!isLegacyNetworkConfig(network) || profiles[name]) continue
    profiles[name] = normalizeLegacyNetworkProfile(name, network)
  }

  for (const [name, profile] of Object.entries(profiles)) {
    validateProfile(name, profile, issues)
  }

  let defaultProfile = config['default-profile']
  if (defaultProfile && !profiles[defaultProfile]) {
    issues.push({
      message: `profile "${defaultProfile}" is not defined`,
      path: 'default-profile',
    })
  }

  if (!defaultProfile) {
    defaultProfile = inferDefaultProfile(config.networks, profiles)
  }

  const networks: Record<string, LegacyNetworkConfig> = {}
  for (const [name, network] of Object.entries(config.networks ?? {})) {
    if (isLegacyNetworkConfig(network)) {
      networks[name] = {...network}
      continue
    }

    const profile = profiles[network.profile]
    if (!profile) {
      issues.push({
        message: `profile "${network.profile}" is not defined`,
        path: `networks.${name}.profile`,
      })
      continue
    }

    const legacyNetwork = profileToLegacyNetwork(profile)
    if (!legacyNetwork) {
      issues.push({
        message: `profile "${network.profile}" does not expose a ledger service`,
        path: `networks.${name}`,
      })
      continue
    }

    networks[name] = legacyNetwork
  }

  if (Object.keys(networks).length === 0 && defaultProfile) {
    const profile = profiles[defaultProfile]
    if (profile && (profile.kind === 'sandbox' || profile.kind === 'canton-multi')) {
      const legacyNetwork = profileToLegacyNetwork(profile)
      if (legacyNetwork) {
        networks.local = legacyNetwork
      }
    }
  }

  if (issues.length > 0) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {issues},
      suggestion: `Fix the following fields in cantonctl.yaml:\n${formatIssues(issues)}`,
    })
  }

  return {defaultProfile, networks, profiles}
}

function formatIssues(issues: Issue[]): string {
  return issues.map(issue => `  - ${issue.path}: ${issue.message}`).join('\n')
}

function normalizeProfile(name: string, profile: RawProfileConfig): NormalizedProfile {
  return {
    experimental: profile.experimental ?? false,
    kind: profile.kind,
    name,
    services: {
      ans: profile.ans ? {...profile.ans} : undefined,
      auth: profile.auth ? {...profile.auth} : undefined,
      ledger: profile.ledger ? {...profile.ledger} : undefined,
      localnet: profile.localnet ? {...profile.localnet} : undefined,
      scan: profile.scan ? {...profile.scan} : undefined,
      scanProxy: profile.scanProxy ? {...profile.scanProxy} : undefined,
      tokenStandard: profile.tokenStandard ? {...profile.tokenStandard} : undefined,
      validator: profile.validator ? {...profile.validator} : undefined,
    },
  }
}

function normalizeLegacyNetworkProfile(name: string, network: LegacyNetworkConfig): NormalizedProfile {
  return {
    experimental: false,
    kind: legacyNetworkTypeToProfileKind(network.type),
    name,
    services: {
      auth: network.auth ? {kind: network.auth} : undefined,
      ledger: stripUndefined({
        auth: network.auth,
        'json-api-port': network['json-api-port'],
        port: network.port,
        url: network.url,
      }),
      localnet: network.type === 'docker' ? {} : undefined,
    },
  }
}

function validateProfile(name: string, profile: NormalizedProfile, issues: Issue[]): void {
  const allowedServices = new Set(ALLOWED_SERVICES[profile.kind])

  for (const serviceName of SERVICE_NAMES) {
    if (profile.services[serviceName] === undefined) continue
    if (!allowedServices.has(serviceName)) {
      issues.push({
        message: `service "${serviceName}" is not allowed for profile kind "${profile.kind}"`,
        path: `profiles.${name}.${serviceName}`,
      })
    }
  }

  if (profile.kind === 'sandbox' && !profile.services.ledger) {
    issues.push({
      message: 'ledger service is required for profile kind "sandbox"',
      path: `profiles.${name}.ledger`,
    })
  }

  if (profile.kind === 'canton-multi' && !profile.services.ledger) {
    issues.push({
      message: 'ledger service is required for profile kind "canton-multi"',
      path: `profiles.${name}.ledger`,
    })
  }

  if (profile.kind === 'splice-localnet' && !profile.services.localnet) {
    issues.push({
      message: 'localnet service is required for profile kind "splice-localnet"',
      path: `profiles.${name}.localnet`,
    })
  }

  if (profile.kind === 'remote-sv-network' && !profile.services.scan && !profile.services.scanProxy) {
    issues.push({
      message: 'scan or scanProxy service is required for profile kind "remote-sv-network"',
      path: `profiles.${name}`,
    })
  }
}

function inferDefaultProfile(
  networks: Record<string, NetworkConfigInput> | undefined,
  profiles: Record<string, NormalizedProfile>,
): string | undefined {
  const localNetwork = networks?.local
  if (localNetwork) {
    return isLegacyNetworkConfig(localNetwork) ? 'local' : localNetwork.profile
  }

  if (profiles.local) return 'local'
  if (profiles.sandbox) return 'sandbox'

  const profileNames = Object.keys(profiles)
  return profileNames.length === 1 ? profileNames[0] : undefined
}

function legacyNetworkTypeToProfileKind(type: LegacyNetworkType): ProfileKind {
  switch (type) {
    case 'sandbox':
      return 'sandbox'
    case 'docker':
      return 'canton-multi'
    case 'remote':
      return 'remote-validator'
  }
}

function profileToLegacyNetwork(profile: NormalizedProfile): LegacyNetworkConfig | undefined {
  const ledger = profile.services.ledger
  if (!ledger) return undefined

  const authKind = profile.services.auth?.kind
  const auth =
    ledger.auth ?? (authKind === 'jwt' || authKind === 'shared-secret' || authKind === 'none' ? authKind : undefined)

  return stripUndefined({
    auth,
    'json-api-port': ledger['json-api-port'],
    port: ledger.port,
    type: profileKindToLegacyNetworkType(profile.kind),
    url: ledger.url,
  })
}

function profileKindToLegacyNetworkType(kind: ProfileKind): LegacyNetworkType {
  switch (kind) {
    case 'sandbox':
      return 'sandbox'
    case 'canton-multi':
    case 'splice-localnet':
      return 'docker'
    case 'remote-validator':
    case 'remote-sv-network':
      return 'remote'
  }
}

function isLegacyNetworkConfig(network: NetworkConfigInput): network is LegacyNetworkConfig {
  return 'type' in network
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}
