import type {CantonctlConfig} from './config.js'
import type {LegacyNetworkConfig, NormalizedProfile, ProfileKind} from './config-profile.js'
import {CantonctlError, ErrorCode} from './errors.js'

export const AUTH_PROFILE_MODES = [
  'bearer-token',
  'env-or-keychain-jwt',
] as const

export type AuthProfileMode = typeof AUTH_PROFILE_MODES[number]

export interface ResolvedAuthProfile {
  description: string
  envVarName: string
  experimental: boolean
  mode: AuthProfileMode
  network: string
  profileKind?: ProfileKind
  profileName?: string
  requiresExplicitExperimental: boolean
  warnings: string[]
}

export interface ResolveAuthProfileOptions {
  config: CantonctlConfig
  network: string
  requestedMode?: AuthProfileMode
}

export function toJwtEnvVarName(network: string): string {
  return `CANTONCTL_JWT_${network.toUpperCase().replace(/-/g, '_')}`
}

export function isAuthProfileMode(value: string): value is AuthProfileMode {
  return AUTH_PROFILE_MODES.includes(value as AuthProfileMode)
}

export function resolveAuthProfile(options: ResolveAuthProfileOptions): ResolvedAuthProfile {
  const network = options.config.networks?.[options.network]
  if (!network) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {availableNetworks: Object.keys(options.config.networks ?? {}), network: options.network},
      suggestion:
        `Network "${options.network}" not found in cantonctl.yaml. ` +
        `Available: ${Object.keys(options.config.networks ?? {}).join(', ') || 'none'}`,
    })
  }

  const profile = resolveProfileForNetwork(options.config, options.network)
  const mode = options.requestedMode ?? inferAuthProfileMode(network, profile)
  const warnings = buildWarnings(mode)

  if (options.requestedMode && options.requestedMode !== inferAuthProfileMode(network, profile)) {
    warnings.unshift(
      `Operator override: using auth mode "${options.requestedMode}" instead of the inferred ` +
      `"${inferAuthProfileMode(network, profile)}" profile.`,
    )
  }

  return {
    description: describeMode(mode),
    envVarName: toJwtEnvVarName(options.network),
    experimental: false,
    mode,
    network: options.network,
    profileKind: profile?.kind,
    profileName: profile?.name,
    requiresExplicitExperimental: false,
    warnings,
  }
}

export function authProfileUsesLocalFallback(
  authProfile: Pick<ResolvedAuthProfile, 'profileKind'>,
  network?: LegacyNetworkConfig,
): boolean {
  return (
    authProfile.profileKind === 'sandbox'
    || authProfile.profileKind === 'canton-multi'
    || authProfile.profileKind === 'splice-localnet'
    || network?.type === 'sandbox'
    || network?.type === 'docker'
  )
}

function resolveProfileForNetwork(config: CantonctlConfig, network: string): NormalizedProfile | undefined {
  const explicitProfileName = config.networkProfiles?.[network]
  if (explicitProfileName && config.profiles?.[explicitProfileName]) {
    return config.profiles[explicitProfileName]
  }

  if (config.profiles?.[network]) {
    return config.profiles[network]
  }

  if (network === 'local' && config['default-profile'] && config.profiles?.[config['default-profile']]) {
    return config.profiles[config['default-profile']]
  }

  return undefined
}

function inferAuthProfileMode(
  network: NonNullable<CantonctlConfig['networks']>[string],
  profile: NormalizedProfile | undefined,
): AuthProfileMode {
  if (
    profile?.kind === 'sandbox'
    || profile?.kind === 'canton-multi'
    || profile?.kind === 'splice-localnet'
    || network.type === 'sandbox'
    || network.type === 'docker'
  ) {
    return 'bearer-token'
  }

  const authKind = profile?.services.auth?.kind ?? network.auth
  if (authKind === 'shared-secret' || authKind === 'none') {
    return 'bearer-token'
  }

  return 'env-or-keychain-jwt'
}

function buildWarnings(mode: AuthProfileMode): string[] {
  switch (mode) {
    case 'bearer-token':
      return [
        'Bearer-token mode uses an explicitly supplied token for remote targets and a local fallback token for sandbox or LocalNet-style profiles.',
      ]

    case 'env-or-keychain-jwt':
      return []
  }
}

function describeMode(mode: AuthProfileMode): string {
  switch (mode) {
    case 'bearer-token':
      return 'Use an explicitly supplied bearer token or a local fallback token.'
    case 'env-or-keychain-jwt':
      return 'Resolve a JWT from the environment first, then the OS keychain.'
  }
}
