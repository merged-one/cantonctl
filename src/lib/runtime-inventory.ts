import type {LegacyNetworkType, NormalizedProfile, ProfileDefinitionSource, ServiceName} from './config-profile.js'
import {
  summarizeProfileCapabilities,
  type ControlPlaneBoundaryMetadata,
  type ControlPlaneCapabilityName,
  type ControlPlaneCapabilitySummary,
  type ControlPlaneSdkPackage,
} from './control-plane.js'
import {
  summarizeProfileServices,
  type ProfileInspection,
  type ProfileServiceSummary,
} from './compat.js'
import type {LocalnetStatusResult} from './localnet.js'
import type {UpstreamSourceId, UpstreamStabilityClass} from './upstream/manifest.js'

export const RUNTIME_INVENTORY_ENDPOINT_PROVENANCES = [
  'declared',
  'legacy-network',
  'derived-local-default',
  'runtime-discovered',
  'generated-topology',
  'localnet-workspace',
  'remote-discovery',
] as const

export type RuntimeInventoryEndpointProvenance = typeof RUNTIME_INVENTORY_ENDPOINT_PROVENANCES[number]

export const RUNTIME_INVENTORY_HEALTH_STATUSES = [
  'configured',
  'healthy',
  'not-applicable',
  'unreachable',
] as const

export type RuntimeInventoryHealthStatus = typeof RUNTIME_INVENTORY_HEALTH_STATUSES[number]
export type RuntimeInventoryMode = 'localnet-workspace' | 'multi-node' | 'profile' | 'sandbox' | 'single-node'
export type RuntimeInventoryResolutionSource = ProfileInspection['resolvedFrom'] | 'localnet-workspace'

interface InventoryInspection {
  capabilities: ControlPlaneCapabilitySummary[]
  profile: NormalizedProfile
  resolvedFrom: RuntimeInventoryResolutionSource
  services: ProfileServiceSummary[]
}

export interface RuntimeInventoryHealth {
  checked: boolean
  detail: string
  status: RuntimeInventoryHealthStatus
}

export interface RuntimeInventoryWarning {
  code: 'experimental-surface' | 'operator-surface'
  detail: string
}

export interface RuntimeInventoryDriftHint {
  capability?: ControlPlaneCapabilityName | ServiceName
  code: 'endpoint-mismatch' | 'profile-kind-mismatch'
  detail: string
  expected?: string
  observed?: string
  severity: 'info' | 'warn'
}

export interface RuntimeInventoryService extends ProfileServiceSummary {
  drift: RuntimeInventoryDriftHint[]
  health: RuntimeInventoryHealth
  runtimeProvenance: RuntimeInventoryEndpointProvenance
  status: Exclude<RuntimeInventoryHealthStatus, 'not-applicable'>
  warnings: RuntimeInventoryWarning[]
}

export interface RuntimeInventoryCapability {
  controlPlane: ControlPlaneBoundaryMetadata
  detail: string
  drift: RuntimeInventoryDriftHint[]
  endpoint?: string
  health: RuntimeInventoryHealth
  kind: 'sdk' | 'service'
  managementEligibility: ControlPlaneBoundaryMetadata['managementClass']
  name: ControlPlaneCapabilityName | ServiceName
  provenance: RuntimeInventoryEndpointProvenance
  sdkPackages?: ControlPlaneSdkPackage[]
  sourceIds: UpstreamSourceId[]
  stability: UpstreamStabilityClass | 'config-only'
  warnings: RuntimeInventoryWarning[]
}

export interface RuntimeInventoryNode {
  healthy: boolean
  name: string
  parties: Array<Record<string, unknown>>
  port: number
  version?: string
}

export interface RuntimeInventoryProfileSummary {
  definitionSource?: ProfileDefinitionSource
  experimental: boolean
  kind: NormalizedProfile['kind']
  name: string
  resolvedFrom?: RuntimeInventoryResolutionSource
}

export interface RuntimeInventorySummary {
  configuredCapabilities: number
  configuredServices: number
  driftedCapabilities: number
  healthyCapabilities: number
  healthyServices: number
  unreachableCapabilities: number
  unreachableServices: number
  warnedCapabilities: number
}

export interface RuntimeInventory {
  capabilities: RuntimeInventoryCapability[]
  drift: RuntimeInventoryDriftHint[]
  mode: RuntimeInventoryMode
  network?: string
  nodes?: RuntimeInventoryNode[]
  parties?: Array<Record<string, unknown>>
  profile?: RuntimeInventoryProfileSummary
  schemaVersion: 1
  services: RuntimeInventoryService[]
  summary: RuntimeInventorySummary
  version?: string
  workspace?: string
}

interface ServiceObservation {
  drift?: RuntimeInventoryDriftHint[]
  endpoint?: string
  health?: RuntimeInventoryHealth
  runtimeProvenance?: RuntimeInventoryEndpointProvenance
}

interface LedgerObservation {
  endpoint: string
  healthy: boolean
  parties: Array<Record<string, unknown>>
  version?: string
}

type ServiceObservationMap = Partial<Record<ServiceName, ServiceObservation>>

export function createProfileStatusInventory(options: {
  inspection: InventoryInspection
  ledger?: LedgerObservation
}): RuntimeInventory {
  const observations: ServiceObservationMap = options.ledger
    ? {
      ledger: {
        endpoint: options.ledger.endpoint,
        health: options.ledger.healthy
          ? createHealthyHealth('Ledger JSON API responded successfully.')
          : createUnreachableHealth('Ledger JSON API was unreachable.'),
        runtimeProvenance: options.inspection.profile.services.ledger?.url
          ? 'declared'
          : 'derived-local-default',
      },
    }
    : {}

  const services = buildProfileInventoryServices(options.inspection, observations)
  const capabilities = buildInventoryCapabilities(
    services,
    options.inspection.capabilities,
    options.inspection.profile.kind === 'splice-localnet' ? 'declared' : undefined,
  )

  return finalizeInventory({
    capabilities,
    mode: 'profile',
    parties: options.ledger?.parties,
    profile: toProfileSummary(options.inspection),
    services,
    version: options.ledger?.version,
  })
}

export function createSingleNodeStatusInventory(options: {
  inspection?: InventoryInspection
  ledger: LedgerObservation
  networkName: string
  networkType: LegacyNetworkType
}): RuntimeInventory {
  const sharedDrift = options.inspection
    ? createSingleNodeKindDrift(options.inspection.profile, options.networkType)
    : []
  const services = options.inspection
    ? buildProfileInventoryServices(options.inspection, {
      ledger: {
        endpoint: options.ledger.endpoint,
        health: options.ledger.healthy
          ? createHealthyHealth('Ledger JSON API responded successfully.')
          : createUnreachableHealth('Ledger JSON API was unreachable.'),
        runtimeProvenance: options.networkType === 'remote'
          ? 'remote-discovery'
          : options.inspection.profile.definitionSource === 'legacy-network'
            ? 'legacy-network'
            : options.inspection.profile.services.ledger?.url
              ? 'declared'
              : 'derived-local-default',
      },
    }, sharedDrift)
    : [
      createRuntimeInventoryService(
        summarizeProfileServices(createLegacyFallbackProfile(options.networkName, options.networkType, options.ledger.endpoint))[0],
        {
          endpoint: options.ledger.endpoint,
          health: options.ledger.healthy
            ? createHealthyHealth('Ledger JSON API responded successfully.')
            : createUnreachableHealth('Ledger JSON API was unreachable.'),
          runtimeProvenance: options.networkType === 'remote' ? 'remote-discovery' : 'legacy-network',
        },
      ),
    ]

  const capabilities = buildInventoryCapabilities(
    services,
    options.inspection?.capabilities ?? [],
    options.networkType === 'remote' ? 'remote-discovery' : undefined,
  )

  return finalizeInventory({
    capabilities,
    mode: options.networkType === 'sandbox' ? 'sandbox' : 'single-node',
    network: options.networkName,
    parties: options.ledger.parties,
    profile: options.inspection ? toProfileSummary(options.inspection) : undefined,
    services,
    version: options.ledger.version,
  })
}

export function createMultiNodeStatusInventory(options: {
  inspection?: InventoryInspection
  networkName: string
  nodes: RuntimeInventoryNode[]
}): RuntimeInventory {
  const allHealthy = options.nodes.every(node => node.healthy)
  const ledgerEndpoint = options.nodes[0] ? `http://localhost:${options.nodes[0].port}` : 'http://localhost:7575'
  const sharedDrift = options.inspection ? createMultiNodeKindDrift(options.inspection.profile) : []
  const services = options.inspection
    ? buildProfileInventoryServices(options.inspection, {
      ledger: {
        endpoint: ledgerEndpoint,
        health: allHealthy
          ? createHealthyHealth('All discovered topology participants responded successfully.')
          : createUnreachableHealth('At least one discovered topology participant was unreachable.'),
        runtimeProvenance: 'generated-topology',
      },
    }, sharedDrift)
    : [
      createRuntimeInventoryService(
        summarizeProfileServices(createLegacyFallbackProfile(options.networkName, 'docker', ledgerEndpoint))[0],
        {
          endpoint: ledgerEndpoint,
          health: allHealthy
            ? createHealthyHealth('All discovered topology participants responded successfully.')
            : createUnreachableHealth('At least one discovered topology participant was unreachable.'),
          runtimeProvenance: 'generated-topology',
        },
      ),
    ]

  const capabilities = buildInventoryCapabilities(
    services,
    options.inspection?.capabilities ?? [],
    'generated-topology',
  )

  return finalizeInventory({
    capabilities,
    mode: 'multi-node',
    network: options.networkName,
    nodes: options.nodes,
    profile: options.inspection ? toProfileSummary(options.inspection) : undefined,
    services,
  })
}

export function createLocalnetWorkspaceInventory(result: LocalnetStatusResult): RuntimeInventory {
  const profile = createLocalnetWorkspaceProfile(result)
  const inspection: InventoryInspection = {
    capabilities: summarizeProfileCapabilities(profile),
    profile,
    resolvedFrom: 'localnet-workspace',
    services: summarizeProfileServices(profile),
  }
  const validatorHealthy = result.health.validatorReadyz.healthy
  const selectedServices = buildProfileInventoryServices(inspection, {
    ledger: {
      endpoint: result.services.ledger.url,
      health: createConfiguredHealth('Endpoint discovered from the LocalNet workspace.'),
      runtimeProvenance: 'localnet-workspace',
    },
    localnet: {
      health: validatorHealthy
        ? createHealthyHealth('Workspace status succeeded and validator readyz is healthy.')
        : createUnreachableHealth('Workspace status succeeded but validator readyz is unhealthy.'),
      runtimeProvenance: 'localnet-workspace',
    },
    scan: result.services.scan
      ? {
        endpoint: result.services.scan.url,
        health: createConfiguredHealth('Endpoint discovered from the LocalNet workspace.'),
        runtimeProvenance: 'localnet-workspace',
      }
      : undefined,
    validator: {
      endpoint: result.services.validator.url,
      health: validatorHealthy
        ? createHealthyHealth('Validator readyz is healthy for the selected LocalNet profile.')
        : createUnreachableHealth('Validator readyz is unhealthy for the selected LocalNet profile.'),
      runtimeProvenance: 'localnet-workspace',
    },
  })

  const capabilities = buildInventoryCapabilities(selectedServices, inspection.capabilities, 'localnet-workspace')

  return finalizeInventory({
    capabilities,
    mode: 'localnet-workspace',
    profile: toProfileSummary(inspection),
    services: selectedServices,
    workspace: result.workspace.root,
  })
}

export function summarizeStatusInventory(services: RuntimeInventoryService[]): {
  configuredServices: number
  healthyServices: number
  unreachableServices: number
} {
  return {
    configuredServices: services.length,
    healthyServices: services.filter(service => service.status === 'healthy').length,
    unreachableServices: services.filter(service => service.status === 'unreachable').length,
  }
}

function buildProfileInventoryServices(
  inspection: InventoryInspection,
  observations: ServiceObservationMap,
  sharedDrift: RuntimeInventoryDriftHint[] = [],
): RuntimeInventoryService[] {
  return inspection.services.map(service => createRuntimeInventoryService(
    service,
    observations[service.name],
    sharedDrift,
  ))
}

function createRuntimeInventoryService(
  service: ProfileServiceSummary,
  observation?: ServiceObservation,
  sharedDrift: RuntimeInventoryDriftHint[] = [],
): RuntimeInventoryService {
  const endpoint = observation?.endpoint ?? service.endpoint
  const runtimeProvenance = observation?.runtimeProvenance ?? service.controlPlane.endpointProvenance
  const drift = dedupeDriftHints([
    ...sharedDrift,
    ...(observation?.drift ?? []),
    ...createEndpointMismatchDrift(service.name, service.endpoint, endpoint),
  ])
  const health = observation?.health ?? createConfiguredHealth(defaultConfiguredDetail(runtimeProvenance, endpoint))

  return {
    ...service,
    drift,
    endpoint,
    health,
    runtimeProvenance,
    status: toServiceStatus(health.status),
    warnings: createWarnings(service.stability, service.controlPlane.operatorSurface),
  }
}

function buildInventoryCapabilities(
  services: RuntimeInventoryService[],
  extraCapabilities: ControlPlaneCapabilitySummary[],
  defaultProvenance?: RuntimeInventoryEndpointProvenance,
): RuntimeInventoryCapability[] {
  return [
    ...services.map(service => ({
      controlPlane: service.controlPlane,
      detail: service.detail,
      drift: service.drift,
      endpoint: service.endpoint,
      health: service.health,
      kind: 'service' as const,
      managementEligibility: service.controlPlane.managementClass,
      name: service.name,
      provenance: service.runtimeProvenance,
      sourceIds: service.sourceIds,
      stability: service.stability,
      warnings: service.warnings,
    })),
    ...extraCapabilities.map(capability => ({
      controlPlane: capability.controlPlane,
      detail: capability.detail,
      drift: [],
      endpoint: undefined,
      health: createNotApplicableHealth('Capability metadata is tracked for ownership and SDK boundaries, not runtime health.'),
      kind: 'sdk' as const,
      managementEligibility: capability.controlPlane.managementClass,
      name: capability.name,
      provenance: defaultProvenance ?? 'declared',
      sdkPackages: capability.sdkPackages,
      sourceIds: capability.sourceIds,
      stability: capability.stability,
      warnings: createWarnings(capability.stability, capability.controlPlane.operatorSurface),
    })),
  ]
}

function finalizeInventory(options: {
  capabilities: RuntimeInventoryCapability[]
  mode: RuntimeInventoryMode
  network?: string
  nodes?: RuntimeInventoryNode[]
  parties?: Array<Record<string, unknown>>
  profile?: RuntimeInventoryProfileSummary
  services: RuntimeInventoryService[]
  version?: string
  workspace?: string
}): RuntimeInventory {
  const drift = dedupeDriftHints([
    ...options.services.flatMap(service => service.drift),
    ...options.capabilities.flatMap(capability => capability.drift),
  ])

  return {
    capabilities: options.capabilities,
    drift,
    mode: options.mode,
    network: options.network,
    nodes: options.nodes,
    parties: options.parties,
    profile: options.profile,
    schemaVersion: 1,
    services: options.services,
    summary: {
      configuredCapabilities: options.capabilities.length,
      configuredServices: options.services.length,
      driftedCapabilities: options.capabilities.filter(capability => capability.drift.length > 0).length,
      healthyCapabilities: options.capabilities.filter(capability => capability.health.status === 'healthy').length,
      healthyServices: options.services.filter(service => service.status === 'healthy').length,
      unreachableCapabilities: options.capabilities.filter(capability => capability.health.status === 'unreachable').length,
      unreachableServices: options.services.filter(service => service.status === 'unreachable').length,
      warnedCapabilities: options.capabilities.filter(capability => capability.warnings.length > 0).length,
    },
    version: options.version,
    workspace: options.workspace,
  }
}

function createWarnings(
  stability: UpstreamStabilityClass | 'config-only',
  operatorSurface: boolean,
): RuntimeInventoryWarning[] {
  const warnings: RuntimeInventoryWarning[] = []

  if (stability === 'experimental-internal') {
    warnings.push({
      code: 'experimental-surface',
      detail: 'This capability is backed by an experimental upstream surface.',
    })
  }

  if (stability === 'operator-only' || operatorSurface) {
    warnings.push({
      code: 'operator-surface',
      detail: 'This capability depends on an operator-only upstream surface.',
    })
  }

  return warnings
}

function createEndpointMismatchDrift(
  capability: ServiceName,
  expected: string | undefined,
  observed: string | undefined,
): RuntimeInventoryDriftHint[] {
  if (!expected || !observed || normalizeEndpoint(expected) === normalizeEndpoint(observed)) {
    return []
  }

  return [{
    capability,
    code: 'endpoint-mismatch',
    detail: `Configured endpoint ${expected} does not match the discovered runtime endpoint ${observed}.`,
    expected,
    observed,
    severity: 'warn',
  }]
}

function createSingleNodeKindDrift(
  profile: NormalizedProfile,
  networkType: LegacyNetworkType,
): RuntimeInventoryDriftHint[] {
  if (networkType === 'sandbox' && profile.kind === 'sandbox') return []
  if (networkType === 'remote' && (profile.kind === 'remote-validator' || profile.kind === 'remote-sv-network')) {
    return []
  }
  if (networkType === 'docker' && profile.kind === 'canton-multi') return []

  return [{
    code: 'profile-kind-mismatch',
    detail: `Resolved profile kind "${profile.kind}" does not match the discovered ${networkType} runtime.`,
    expected: profile.kind,
    observed: networkType,
    severity: 'warn',
  }]
}

function createMultiNodeKindDrift(profile: NormalizedProfile): RuntimeInventoryDriftHint[] {
  if (profile.kind === 'canton-multi') {
    return []
  }

  return [{
    code: 'profile-kind-mismatch',
    detail: `Resolved profile kind "${profile.kind}" does not match the discovered generated topology runtime.`,
    expected: profile.kind,
    observed: 'generated-topology',
    severity: 'warn',
  }]
}

function createLegacyFallbackProfile(
  name: string,
  type: LegacyNetworkType,
  ledgerEndpoint: string,
): NormalizedProfile {
  return {
    definitionSource: 'legacy-network',
    experimental: false,
    kind: type === 'sandbox' ? 'sandbox' : type === 'docker' ? 'canton-multi' : 'remote-validator',
    name,
    services: {
      ledger: ledgerEndpoint.startsWith('http://localhost:')
        ? {'json-api-port': Number.parseInt(ledgerEndpoint.slice(ledgerEndpoint.lastIndexOf(':') + 1), 10)}
        : {url: ledgerEndpoint},
      localnet: type === 'docker' ? {} : undefined,
    },
  }
}

function createLocalnetWorkspaceProfile(result: LocalnetStatusResult): NormalizedProfile {
  return {
    definitionSource: 'profiles',
    experimental: false,
    kind: 'splice-localnet',
    name: result.selectedProfile,
    services: {
      ledger: {url: result.services.ledger.url},
      localnet: {
        distribution: 'splice-localnet',
        version: result.workspace.env.SPLICE_VERSION,
      },
      scan: result.services.scan ? {url: result.services.scan.url} : undefined,
      validator: {url: result.services.validator.url},
    },
  }
}

function toProfileSummary(inspection: InventoryInspection): RuntimeInventoryProfileSummary {
  return {
    definitionSource: inspection.profile.definitionSource,
    experimental: inspection.profile.experimental,
    kind: inspection.profile.kind,
    name: inspection.profile.name,
    resolvedFrom: inspection.resolvedFrom,
  }
}

function createConfiguredHealth(detail: string): RuntimeInventoryHealth {
  return {checked: false, detail, status: 'configured'}
}

function createHealthyHealth(detail: string): RuntimeInventoryHealth {
  return {checked: true, detail, status: 'healthy'}
}

function createNotApplicableHealth(detail: string): RuntimeInventoryHealth {
  return {checked: false, detail, status: 'not-applicable'}
}

function createUnreachableHealth(detail: string): RuntimeInventoryHealth {
  return {checked: true, detail, status: 'unreachable'}
}

function defaultConfiguredDetail(
  _provenance: RuntimeInventoryEndpointProvenance,
  endpoint?: string,
): string {
  return endpoint
    ? 'Endpoint declared in the resolved profile.'
    : 'Capability declared in the resolved profile.'
}

function toServiceStatus(status: RuntimeInventoryHealthStatus): RuntimeInventoryService['status'] {
  switch (status) {
    case 'healthy':
      return 'healthy'
    case 'unreachable':
      return 'unreachable'
    case 'configured':
    case 'not-applicable':
      return 'configured'
  }
}

function dedupeDriftHints(hints: RuntimeInventoryDriftHint[]): RuntimeInventoryDriftHint[] {
  const seen = new Set<string>()
  return hints.filter((hint) => {
    const key = [
      hint.capability,
      hint.code,
      hint.detail,
      hint.expected,
      hint.observed,
      hint.severity,
    ].join('|')

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, '')
}
