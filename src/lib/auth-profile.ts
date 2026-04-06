import type {CantonctlConfig} from './config.js'
import type {
  AuthServiceConfig,
  LegacyNetworkConfig,
  NormalizedProfile,
  ProfileKind,
} from './config-profile.js'
import {CantonctlError, ErrorCode} from './errors.js'

export const AUTH_PROFILE_MODES = [
  'bearer-token',
  'env-or-keychain-jwt',
] as const

export type AuthProfileMode = typeof AUTH_PROFILE_MODES[number]
export const AUTH_CREDENTIAL_SCOPES = ['app', 'operator'] as const
export type AuthCredentialScope = typeof AUTH_CREDENTIAL_SCOPES[number]
export type AuthKind = AuthServiceConfig['kind'] | 'unspecified'

export interface AuthCredentialBinding {
  description: string
  envVarName: string
  keychainAccount: string
  localFallbackAllowed: boolean
  prerequisites: string[]
  required: boolean
  scope: AuthCredentialScope
}

export interface ResolvedAuthProfile {
  app: AuthCredentialBinding
  authKind: AuthKind
  description: string
  envVarName: string
  experimental: boolean
  mode: AuthProfileMode
  network: string
  operator: AuthCredentialBinding
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

export function toOperatorTokenEnvVarName(network: string): string {
  return `CANTONCTL_OPERATOR_TOKEN_${network.toUpperCase().replace(/-/g, '_')}`
}

export function toCredentialAccountName(network: string, scope: AuthCredentialScope = 'app'): string {
  return scope === 'app' ? network : `operator:${network}`
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
  const authKind = resolveAuthKind(network, profile)
  const mode = options.requestedMode ?? inferAuthProfileMode(network, profile)
  const localFallbackAllowed = authProfileUsesLocalFallback({profileKind: profile?.kind}, network)
  const operatorRequired = requiresExplicitOperatorCredential(profile)
  const warnings = buildWarnings({
    authKind,
    localFallbackAllowed,
    mode,
    operatorRequired,
  })

  if (options.requestedMode && options.requestedMode !== inferAuthProfileMode(network, profile)) {
    warnings.unshift(
      `Operator override: using auth mode "${options.requestedMode}" instead of the inferred ` +
      `"${inferAuthProfileMode(network, profile)}" profile.`,
    )
  }

  return {
    app: {
      description: describeMode(mode, localFallbackAllowed),
      envVarName: toJwtEnvVarName(options.network),
      keychainAccount: toCredentialAccountName(options.network),
      localFallbackAllowed,
      prerequisites: buildAppPrerequisites({
        authKind,
        envVarName: toJwtEnvVarName(options.network),
        localFallbackAllowed,
      }),
      required: !localFallbackAllowed,
      scope: 'app',
    },
    authKind,
    description: describeMode(mode, localFallbackAllowed),
    envVarName: toJwtEnvVarName(options.network),
    experimental: false,
    mode,
    network: options.network,
    operator: {
      description: describeOperatorMode({
        authKind,
        localFallbackAllowed,
        mode,
      }),
      envVarName: toOperatorTokenEnvVarName(options.network),
      keychainAccount: toCredentialAccountName(options.network, 'operator'),
      localFallbackAllowed,
      prerequisites: buildOperatorPrerequisites({
        authKind,
        envVarName: toOperatorTokenEnvVarName(options.network),
        localFallbackAllowed,
      }),
      required: operatorRequired,
      scope: 'operator',
    },
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

function resolveAuthKind(
  network: NonNullable<CantonctlConfig['networks']>[string],
  profile: NormalizedProfile | undefined,
): AuthKind {
  const authKind = profile?.services.auth?.kind ?? network.auth
  return authKind ?? 'unspecified'
}

function requiresExplicitOperatorCredential(profile: NormalizedProfile | undefined): boolean {
  if (!profile) {
    return true
  }

  return (
    profile.kind === 'remote-validator'
    || profile.kind === 'remote-sv-network'
  ) && (
    profile.services.ledger !== undefined
    || profile.services.validator !== undefined
    || profile.services.localnet !== undefined
  )
}

function buildWarnings(options: {
  authKind: AuthKind
  localFallbackAllowed: boolean
  mode: AuthProfileMode
  operatorRequired: boolean
}): string[] {
  switch (options.mode) {
    case 'bearer-token':
      if (options.localFallbackAllowed) {
        return [
          'Bearer-token mode uses an explicitly supplied token for remote targets and a local fallback token only for sandbox or LocalNet-style profiles.',
        ]
      }

      return options.operatorRequired
        ? [
          'Bearer-token mode requires explicit remote credentials. Operator mutations never inherit the local fallback token path.',
        ]
        : [
          'Bearer-token mode requires explicit remote credentials. No local fallback token is available for this profile.',
        ]

    case 'env-or-keychain-jwt':
      return []
  }
}

function describeMode(mode: AuthProfileMode, localFallbackAllowed: boolean): string {
  switch (mode) {
    case 'bearer-token':
      return localFallbackAllowed
        ? 'Use an explicitly supplied bearer token or a local fallback token.'
        : 'Use an explicitly supplied bearer token.'
    case 'env-or-keychain-jwt':
      return 'Resolve a JWT from the environment first, then the OS keychain.'
  }
}

function describeOperatorMode(options: {
  authKind: AuthKind
  localFallbackAllowed: boolean
  mode: AuthProfileMode
}): string {
  if (options.localFallbackAllowed) {
    return 'Use the generated local fallback token for companion-managed local control-plane actions.'
  }

  switch (options.authKind) {
    case 'oidc':
      return 'Use an explicitly supplied operator JWT from the official OIDC issuer for remote control-plane mutations.'
    case 'jwt':
      return 'Use an explicitly supplied operator JWT for remote control-plane mutations.'
    case 'shared-secret':
      return 'Use an explicitly supplied operator bearer token derived from the remote shared-secret flow.'
    case 'none':
      return 'Use explicitly supplied operator material for remote control-plane mutations; no local fallback is available.'
    case 'unspecified':
      return options.mode === 'env-or-keychain-jwt'
        ? 'Use an explicitly supplied operator JWT for remote control-plane mutations.'
        : 'Use an explicitly supplied operator bearer token for remote control-plane mutations.'
  }
}

function buildAppPrerequisites(options: {
  authKind: AuthKind
  envVarName: string
  localFallbackAllowed: boolean
}): string[] {
  if (options.localFallbackAllowed) {
    return [
      'No explicit app credential is required for sandbox, canton-multi, or splice-localnet flows.',
    ]
  }

  switch (options.authKind) {
    case 'oidc':
      return [
        `Resolve an application JWT via ${options.envVarName} or the OS keychain for read-only status, preflight, and canary access.`,
      ]
    case 'jwt':
      return [
        `Resolve an application JWT via ${options.envVarName} or the OS keychain for read-only Canton API access.`,
      ]
    case 'shared-secret':
    case 'none':
    case 'unspecified':
      return [
        `Provide explicit remote app credentials via ${options.envVarName} or the OS keychain when read-only access requires it.`,
      ]
  }
}

function buildOperatorPrerequisites(options: {
  authKind: AuthKind
  envVarName: string
  localFallbackAllowed: boolean
}): string[] {
  if (options.localFallbackAllowed) {
    return [
      'Local operator flows reuse the companion-managed fallback token and do not require separately stored operator credentials.',
    ]
  }

  switch (options.authKind) {
    case 'oidc':
      return [
        `Obtain an operator JWT from the official OIDC flow and store it with "cantonctl auth login <network> --scope operator" or set ${options.envVarName}.`,
      ]
    case 'jwt':
      return [
        `Obtain an operator JWT for the remote JSON Ledger API and store it with "cantonctl auth login <network> --scope operator" or set ${options.envVarName}.`,
      ]
    case 'shared-secret':
      return [
        `Obtain the remote shared-secret-derived operator bearer token out-of-band and store it with "cantonctl auth login <network> --scope operator" or set ${options.envVarName}. cantonctl will not derive it for remote profiles.`,
      ]
    case 'none':
      return [
        `Confirm the operator runbook for this unauthenticated profile and still provide explicit operator material via "cantonctl auth login <network> --scope operator" or ${options.envVarName} before mutating commands.`,
      ]
    case 'unspecified':
      return [
        `Provide explicit operator auth material via "cantonctl auth login <network> --scope operator" or ${options.envVarName} before remote control-plane mutations.`,
      ]
  }
}
