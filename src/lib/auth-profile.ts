import type {CantonctlConfig} from './config.js'
import type {NormalizedProfile, ProfileKind} from './config-profile.js'
import {CantonctlError, ErrorCode} from './errors.js'

export const AUTH_PROFILE_MODES = [
  'bearer-token',
  'env-or-keychain-jwt',
  'oidc-client-credentials',
  'localnet-unsafe-hmac',
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
    experimental: mode === 'localnet-unsafe-hmac' || mode === 'oidc-client-credentials',
    mode,
    network: options.network,
    profileKind: profile?.kind,
    profileName: profile?.name,
    requiresExplicitExperimental: mode === 'localnet-unsafe-hmac' || mode === 'oidc-client-credentials',
    warnings,
  }
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
  const authKind = profile?.services.auth?.kind ?? network.auth

  if (
    profile?.kind === 'sandbox'
    || profile?.kind === 'canton-multi'
    || profile?.kind === 'splice-localnet'
    || network.type === 'sandbox'
    || network.type === 'docker'
  ) {
    return 'localnet-unsafe-hmac'
  }

  if (authKind === 'oidc') {
    return 'oidc-client-credentials'
  }

  if (authKind === 'shared-secret' || authKind === 'none') {
    return 'bearer-token'
  }

  return 'env-or-keychain-jwt'
}

function buildWarnings(mode: AuthProfileMode): string[] {
  switch (mode) {
    case 'bearer-token':
      return [
        'Bearer-token mode is operator-managed. cantonctl will use the token you supply but will not acquire or refresh it for you.',
      ]

    case 'env-or-keychain-jwt':
      return []

    case 'localnet-unsafe-hmac':
      return [
        'EXPERIMENTAL: localnet-unsafe-hmac is a local-only auth shortcut with no production guarantees.',
        'Never reuse a localnet or sandbox HMAC/shared-secret token outside a throwaway local environment.',
      ]

    case 'oidc-client-credentials':
      return [
        'EXPERIMENTAL: oidc-client-credentials is operator-only and upstream auth contracts may change without notice.',
        'cantonctl does not negotiate OIDC client credentials for you. Mint the access token externally, then pass or store it explicitly.',
      ]
  }
}

function describeMode(mode: AuthProfileMode): string {
  switch (mode) {
    case 'bearer-token':
      return 'Use an explicitly supplied bearer token.'
    case 'env-or-keychain-jwt':
      return 'Resolve a JWT from the environment first, then the OS keychain.'
    case 'localnet-unsafe-hmac':
      return 'Use a local-only unsafe HMAC/shared-secret flow for sandbox or LocalNet-style development.'
    case 'oidc-client-credentials':
      return 'Use an externally minted OIDC client-credentials access token.'
  }
}
