import type {CantonctlConfig} from './config.js'
import type {
  NormalizedProfile,
  ServiceName,
} from './config-profile.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {CheckStatus} from './doctor.js'
import type {UpstreamSourceId, UpstreamStabilityClass} from './upstream/manifest.js'
import {getPinnedCantonSdkVersion, getUpstreamSource} from './upstream/manifest.js'

export interface ProfileListEntry {
  experimental: boolean
  isDefault: boolean
  kind: NormalizedProfile['kind']
  name: string
  services: ServiceName[]
}

export interface ResolvedProfile {
  profile: NormalizedProfile
  source: 'argument' | 'default-profile' | 'only-profile'
}

export interface ProfileServiceSummary {
  detail: string
  endpoint?: string
  name: ServiceName
  sourceIds: UpstreamSourceId[]
  stability: UpstreamStabilityClass | 'config-only'
}

export interface CompatibilityCheck {
  actual?: string
  detail: string
  expected?: string
  name: string
  sourceIds?: UpstreamSourceId[]
  status: CheckStatus
}

export interface CompatibilityReport {
  checks: CompatibilityCheck[]
  failed: number
  passed: number
  profile: Pick<NormalizedProfile, 'experimental' | 'kind' | 'name'>
  services: ProfileServiceSummary[]
  warned: number
}

const SERVICE_ORDER: ServiceName[] = [
  'ans',
  'auth',
  'ledger',
  'scan',
  'scanProxy',
  'tokenStandard',
  'validator',
  'localnet',
]

const TOKEN_STANDARD_SOURCE_IDS: UpstreamSourceId[] = [
  'splice-token-metadata-openapi',
  'splice-token-allocation-openapi',
  'splice-token-allocation-instruction-openapi',
  'splice-token-transfer-instruction-openapi',
  'splice-token-metadata-daml',
  'splice-token-holding-daml',
  'splice-token-allocation-daml',
  'splice-token-allocation-instruction-daml',
  'splice-token-transfer-instruction-daml',
]

const SERVICE_SOURCE_IDS: Partial<Record<ServiceName, UpstreamSourceId[]>> = {
  ans: ['splice-ans-external-openapi'],
  ledger: ['canton-json-ledger-api-openapi'],
  scan: ['splice-scan-external-openapi'],
  scanProxy: ['splice-scan-proxy-openapi'],
  tokenStandard: TOKEN_STANDARD_SOURCE_IDS,
  validator: ['splice-validator-internal-openapi'],
}

export function listProfiles(config: CantonctlConfig): ProfileListEntry[] {
  const defaultProfile = config['default-profile']

  return Object.values(config.profiles ?? {})
    .map(profile => ({
      experimental: profile.experimental,
      isDefault: defaultProfile === profile.name,
      kind: profile.kind,
      name: profile.name,
      services: getConfiguredServiceNames(profile),
    }))
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }

      return left.name.localeCompare(right.name)
    })
}

export function resolveProfile(config: CantonctlConfig, name?: string): ResolvedProfile {
  const profiles = config.profiles ?? {}

  if (name) {
    const profile = profiles[name]
    if (!profile) {
      throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
        context: {availableProfiles: Object.keys(profiles), profile: name},
        suggestion: `Profile "${name}" not found in cantonctl.yaml. Available: ${Object.keys(profiles).join(', ') || 'none'}`,
      })
    }

    return {profile, source: 'argument'}
  }

  const defaultProfileName = config['default-profile']
  if (defaultProfileName) {
    const profile = profiles[defaultProfileName]
    if (!profile) {
      throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
        context: {availableProfiles: Object.keys(profiles), profile: defaultProfileName},
        suggestion: `Default profile "${defaultProfileName}" is not defined. Available: ${Object.keys(profiles).join(', ') || 'none'}`,
      })
    }

    return {profile, source: 'default-profile'}
  }

  const availableProfiles = Object.values(profiles)
  if (availableProfiles.length === 1) {
    return {profile: availableProfiles[0], source: 'only-profile'}
  }

  throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
    context: {availableProfiles: Object.keys(profiles)},
    suggestion:
      availableProfiles.length === 0
        ? 'Define at least one profile or network in cantonctl.yaml.'
        : `Choose a profile explicitly. Available: ${availableProfiles.map(profile => profile.name).join(', ')}`,
  })
}

export function summarizeProfileServices(profile: NormalizedProfile): ProfileServiceSummary[] {
  return getConfiguredServiceNames(profile).map((name) => {
    const sourceIds = SERVICE_SOURCE_IDS[name] ?? []
    const firstSource = sourceIds[0] ? getUpstreamSource(sourceIds[0]) : null

    return {
      detail: buildServiceDetail(profile, name),
      endpoint: getServiceEndpoint(profile, name),
      name,
      sourceIds,
      stability: firstSource?.stability ?? 'config-only',
    }
  })
}

export function createCompatibilityReport(config: CantonctlConfig, profileName?: string): CompatibilityReport {
  const {profile} = resolveProfile(config, profileName)
  const services = summarizeProfileServices(profile)
  const checks: CompatibilityCheck[] = []

  checks.push({
    actual: config.project['sdk-version'],
    detail: buildSdkCompatibilityDetail(config.project['sdk-version']),
    expected: getSupportedSdkVersion(),
    name: 'Project SDK',
    sourceIds: ['canton-json-ledger-api-openapi'],
    status: getSdkCompatibilityStatus(config.project['sdk-version']),
  })

  for (const service of services) {
    checks.push({
      detail: buildServiceCompatibilityDetail(service),
      name: `Service ${service.name}`,
      sourceIds: service.sourceIds,
      status: getServiceCompatibilityStatus(service),
    })
  }

  const passed = checks.filter(check => check.status === 'pass').length
  const failed = checks.filter(check => check.status === 'fail').length
  const warned = checks.filter(check => check.status === 'warn').length

  return {
    checks,
    failed,
    passed,
    profile: {
      experimental: profile.experimental,
      kind: profile.kind,
      name: profile.name,
    },
    services,
    warned,
  }
}

function getConfiguredServiceNames(profile: NormalizedProfile): ServiceName[] {
  return SERVICE_ORDER.filter(serviceName => profile.services[serviceName] !== undefined)
}

function getServiceEndpoint(profile: NormalizedProfile, name: ServiceName): string | undefined {
  switch (name) {
    case 'ledger': {
      const ledger = profile.services.ledger
      if (!ledger) return undefined
      if (ledger.url) return ledger.url
      return `http://localhost:${ledger['json-api-port'] ?? 7575}`
    }

    case 'auth': {
      const auth = profile.services.auth
      return auth?.url ?? auth?.issuer
    }

    case 'ans':
    case 'scan':
    case 'scanProxy':
    case 'tokenStandard':
    case 'validator':
      return profile.services[name]?.url

    case 'localnet':
      return undefined
  }
}

function buildServiceDetail(profile: NormalizedProfile, name: ServiceName): string {
  switch (name) {
    case 'ledger': {
      const ledger = profile.services.ledger
      if (!ledger) return 'Not configured'
      const parts = []
      if (ledger.port !== undefined) parts.push(`port ${ledger.port}`)
      if (ledger['json-api-port'] !== undefined) parts.push(`json-api-port ${ledger['json-api-port']}`)
      if (ledger.auth) parts.push(`auth ${ledger.auth}`)
      return parts.join(', ') || 'Ledger endpoint'
    }

    case 'auth': {
      const auth = profile.services.auth
      if (!auth) return 'Not configured'
      const parts: string[] = [auth.kind]
      if (auth.issuer) parts.push(`issuer ${auth.issuer}`)
      if (auth.audience) parts.push(`audience ${auth.audience}`)
      return parts.join(', ')
    }

    case 'localnet': {
      const localnet = profile.services.localnet
      if (!localnet) return 'Not configured'
      const parts = []
      if (localnet.distribution) parts.push(localnet.distribution)
      if (localnet.version) parts.push(`version ${localnet.version}`)
      if (localnet['base-port'] !== undefined) parts.push(`base-port ${localnet['base-port']}`)
      if (localnet['canton-image']) parts.push(localnet['canton-image'])
      return parts.join(', ') || 'Localnet configuration'
    }

    case 'ans':
      return 'ANS endpoint'
    case 'scan':
      return 'Scan endpoint'
    case 'scanProxy':
      return 'Scan proxy endpoint'
    case 'tokenStandard':
      return 'Token Standard endpoint'
    case 'validator':
      return 'Validator endpoint'
  }
}

function getSupportedSdkVersion(): string {
  return getPinnedCantonSdkVersion()
}

function parseVersion(value: string): number[] | null {
  const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return match.slice(1).map(part => Number.parseInt(part, 10))
}

function getSdkCompatibilityStatus(actualVersion: string): CheckStatus {
  const expectedVersion = getSupportedSdkVersion()
  if (actualVersion === expectedVersion) {
    return 'pass'
  }

  const actual = parseVersion(actualVersion)
  const expected = parseVersion(expectedVersion)
  if (!actual || !expected) {
    return 'warn'
  }

  return actual[0] === expected[0] && actual[1] === expected[1] ? 'warn' : 'fail'
}

function buildSdkCompatibilityDetail(actualVersion: string): string {
  const expectedVersion = getSupportedSdkVersion()
  const status = getSdkCompatibilityStatus(actualVersion)

  switch (status) {
    case 'pass':
      return `Project SDK ${actualVersion} matches the pinned Canton compatibility baseline.`
    case 'warn':
      return `Project SDK ${actualVersion} is close to the pinned ${expectedVersion} baseline. Reverify generated clients before release.`
    case 'fail':
      return `Project SDK ${actualVersion} is outside the pinned ${expectedVersion} compatibility baseline.`
  }
}

function getServiceCompatibilityStatus(service: ProfileServiceSummary): CheckStatus {
  switch (service.stability) {
    case 'stable-external':
    case 'stable-daml-interface':
    case 'public-sdk':
      return 'pass'
    case 'config-only':
    case 'experimental-internal':
    case 'operator-only':
      return 'warn'
  }
}

function buildServiceCompatibilityDetail(service: ProfileServiceSummary): string {
  switch (service.stability) {
    case 'stable-external':
      return `${service.name} is backed by a stable upstream contract tracked in the manifest.`
    case 'stable-daml-interface':
      return `${service.name} is anchored to stable Daml interfaces tracked in the manifest.`
    case 'public-sdk':
      return `${service.name} should integrate through the published SDK package pinned in the manifest.`
    case 'experimental-internal':
      return `${service.name} is reference-only for now. Keep callers generic and do not automate against this surface by default.`
    case 'operator-only':
      return `${service.name} is operator-facing. Treat it as diagnostics-only until a public contract exists.`
    case 'config-only':
      return `${service.name} is configured, but cantonctl does not enforce a stable upstream compatibility contract for it yet.`
  }
}
