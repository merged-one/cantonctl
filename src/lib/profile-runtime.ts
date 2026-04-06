import type {CantonctlConfig} from './config.js'
import type {ResolvedCredential} from './credential-store.js'
import {createCredentialStore, type CredentialStore, type KeychainBackend} from './credential-store.js'
import type {LegacyNetworkConfig, NetworkAuthMode, NormalizedProfile} from './config-profile.js'
import {
  createCompatibilityReport,
  inspectProfile,
  type CompatibilityReport,
  type ProfileCapabilitySummary,
  type ProfileServiceSummary,
} from './compat.js'
import {type AuthProfileMode, type ResolvedAuthProfile, resolveAuthProfile} from './auth-profile.js'
import {createSandboxToken} from './jwt.js'
import {createBackendWithFallback} from './keytar-backend.js'
import {resolveStableSpliceProfile} from './splice-public.js'

export interface RuntimeCredential {
  mode: AuthProfileMode
  network: string
  source: 'env' | 'fallback' | 'missing' | 'stored'
  token?: string
}

export interface ResolvedProfileRuntime {
  auth: ResolvedAuthProfile
  capabilities: ProfileCapabilitySummary[]
  compatibility: CompatibilityReport
  credential: RuntimeCredential
  networkName: string
  profile: NormalizedProfile
  profileContext: ReturnType<typeof resolveStableSpliceProfile>
  services: ProfileServiceSummary[]
}

export interface ProfileRuntimeResolverDeps {
  createBackendWithFallback?: typeof createBackendWithFallback
  createCredentialStore?: (deps: {backend: KeychainBackend; env?: Record<string, string | undefined>}) => CredentialStore
  createFallbackToken?: (config: CantonctlConfig) => Promise<string>
  env?: Record<string, string | undefined>
}

export interface ProfileRuntimeResolver {
  resolve(options: {config: CantonctlConfig; profileName?: string}): Promise<ResolvedProfileRuntime>
}

export function createProfileRuntimeResolver(
  deps: ProfileRuntimeResolverDeps = {},
): ProfileRuntimeResolver {
  const createBackend = deps.createBackendWithFallback ?? createBackendWithFallback
  const createStore = deps.createCredentialStore ?? createCredentialStore
  const createFallbackToken = deps.createFallbackToken ?? defaultCreateFallbackToken
  const env = deps.env ?? process.env

  return {
    async resolve(options) {
      const inspection = inspectProfile(options.config, options.profileName)
      const {profile} = inspection
      const networkName = resolveProfileNetworkName(options.config, profile.name)
      const auth = resolveProfileAuth(options.config, profile, networkName)
      const compatibility = createCompatibilityReport(options.config, profile.name)
      const credential = shouldUseFallbackToken(profile, auth.mode)
        ? {
          mode: auth.mode,
          network: networkName,
          source: 'fallback' as const,
          token: await createFallbackToken(options.config),
        }
        : await resolveStoredCredential({
          createBackend,
          createStore,
          env,
          mode: auth.mode,
          networkName,
        })

      return {
        auth,
        capabilities: inspection.capabilities,
        compatibility,
        credential,
        networkName,
        profile,
        profileContext: resolveStableSpliceProfile(options.config, profile.name),
        services: inspection.services,
      }
    },
  }
}

export function resolveProfileNetworkName(config: CantonctlConfig, profileName: string): string {
  if (config.networkProfiles) {
    for (const [networkName, mappedProfile] of Object.entries(config.networkProfiles)) {
      if (mappedProfile === profileName) {
        return networkName
      }
    }
  }

  if (config.networks?.[profileName]) {
    return profileName
  }

  return profileName
}

export function resolveProfileAuth(
  config: CantonctlConfig,
  profile: NormalizedProfile,
  networkName: string,
): ResolvedAuthProfile {
  const networks = {
    ...(config.networks ?? {}),
    [networkName]: config.networks?.[networkName] ?? synthesizeLegacyNetwork(profile),
  }
  const networkProfiles = {
    ...(config.networkProfiles ?? {}),
    [networkName]: profile.name,
  }

  return resolveAuthProfile({
    config: {
      ...config,
      networkProfiles,
      networks,
      profiles: {
        ...(config.profiles ?? {}),
        [profile.name]: profile,
      },
    },
    network: networkName,
  })
}

function synthesizeLegacyNetwork(profile: NormalizedProfile): LegacyNetworkConfig {
  const authKind = profile.services.auth?.kind
  const auth = profile.services.ledger?.auth
    ?? (authKind === 'jwt' || authKind === 'shared-secret' || authKind === 'none'
      ? authKind
      : undefined)

  return {
    auth,
    'json-api-port': profile.services.ledger?.['json-api-port'],
    port: profile.services.ledger?.port,
    type: profile.kind === 'sandbox'
      ? 'sandbox'
      : (profile.kind === 'canton-multi' || profile.kind === 'splice-localnet')
        ? 'docker'
        : 'remote',
    url: profile.services.ledger?.url,
  }
}

async function resolveStoredCredential(options: {
  createBackend: typeof createBackendWithFallback
  createStore: (deps: {backend: KeychainBackend; env?: Record<string, string | undefined>}) => CredentialStore
  env: Record<string, string | undefined>
  mode: AuthProfileMode
  networkName: string
}): Promise<RuntimeCredential> {
  const {backend} = await options.createBackend()
  const store = options.createStore({backend, env: options.env})
  const credential = await store.resolveRecord(options.networkName)

  if (!credential) {
    return {
      mode: options.mode,
      network: options.networkName,
      source: 'missing',
    }
  }

  return {
    mode: options.mode,
    network: options.networkName,
    source: credential.source,
    token: credential.token,
  }
}

function shouldUseFallbackToken(profile: NormalizedProfile, mode: AuthProfileMode): boolean {
  return (
    profile.kind === 'sandbox'
    || profile.kind === 'canton-multi'
    || profile.kind === 'splice-localnet'
    || profile.services.auth?.kind === 'shared-secret'
    || profile.services.auth?.kind === 'none'
  )
}

async function defaultCreateFallbackToken(config: CantonctlConfig): Promise<string> {
  const partyNames = config.parties?.map(party => party.name) ?? []
  return createSandboxToken({
    actAs: partyNames.length > 0 ? partyNames : ['admin'],
    admin: true,
    applicationId: 'cantonctl',
    readAs: partyNames,
  })
}

export function summarizeCredentialSource(credential: RuntimeCredential): string {
  switch (credential.source) {
    case 'env':
      return 'resolved from environment'
    case 'stored':
      return 'resolved from keychain'
    case 'fallback':
      return 'using local fallback token'
    case 'missing':
      return 'missing token'
  }
}

export function toResolvedCredential(record: RuntimeCredential): ResolvedCredential | null {
  if (!record.token || (record.source !== 'env' && record.source !== 'stored')) {
    return null
  }

  return {
    source: record.source,
    token: record.token,
  }
}
