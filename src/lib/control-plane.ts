import type {
  NormalizedProfile,
  ProfileDefinitionSource,
  ServiceName,
} from './config-profile.js'
import {
  getUpstreamSource,
  type UpstreamSourceId,
  type UpstreamStabilityClass,
} from './upstream/manifest.js'

export const CONTROL_PLANE_LIFECYCLE_OWNERS = [
  'cantonctl',
  'official-local-runtime',
  'official-remote-runtime',
  'external-sdk',
] as const

export type ControlPlaneLifecycleOwner = typeof CONTROL_PLANE_LIFECYCLE_OWNERS[number]

export const CONTROL_PLANE_MANAGEMENT_CLASSES = [
  'read-only',
  'plan-only',
  'apply-capable',
] as const

export type ControlPlaneManagementClass = typeof CONTROL_PLANE_MANAGEMENT_CLASSES[number]

export const CONTROL_PLANE_MUTATION_SCOPES = [
  'managed',
  'observed',
  'out-of-scope',
] as const

export type ControlPlaneMutationScope = typeof CONTROL_PLANE_MUTATION_SCOPES[number]

export const CONTROL_PLANE_ENDPOINT_PROVENANCES = [
  'declared',
  'legacy-network',
  'derived-local-default',
  'runtime-discovered',
] as const

export type ControlPlaneEndpointProvenance = typeof CONTROL_PLANE_ENDPOINT_PROVENANCES[number]

export const CONTROL_PLANE_CAPABILITIES = [
  'wallet-integration',
] as const

export type ControlPlaneCapabilityName = typeof CONTROL_PLANE_CAPABILITIES[number]

export interface ControlPlaneBoundaryMetadata {
  lifecycleOwner: ControlPlaneLifecycleOwner
  managementClass: ControlPlaneManagementClass
  mutationScope: ControlPlaneMutationScope
  operatorSurface: boolean
}

export interface ControlPlaneServiceMetadata extends ControlPlaneBoundaryMetadata {
  endpointProvenance: ControlPlaneEndpointProvenance
}

export interface ControlPlaneSdkPackage {
  packageName: string
  sourceId: 'canton-network-dapp-sdk' | 'canton-network-wallet-sdk'
  version: string
}

export interface ControlPlaneCapabilitySummary {
  controlPlane: ControlPlaneBoundaryMetadata
  detail: string
  name: ControlPlaneCapabilityName
  sdkPackages: ControlPlaneSdkPackage[]
  sourceIds: UpstreamSourceId[]
  stability: UpstreamStabilityClass
}

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

const WALLET_INTEGRATION_SOURCE_IDS: Array<'canton-network-dapp-sdk' | 'canton-network-wallet-sdk'> = [
  'canton-network-dapp-sdk',
  'canton-network-wallet-sdk',
]

export function getProfileDefinitionSource(profile: NormalizedProfile): ProfileDefinitionSource {
  return profile.definitionSource ?? 'profiles'
}

export function getServiceSourceIds(name: ServiceName): UpstreamSourceId[] {
  return [...(SERVICE_SOURCE_IDS[name] ?? [])]
}

export function getServiceStability(
  sourceIds: UpstreamSourceId[],
): UpstreamStabilityClass | 'config-only' {
  const firstSourceId = sourceIds[0]
  return firstSourceId ? getUpstreamSource(firstSourceId).stability : 'config-only'
}

export function summarizeServiceControlPlane(
  profile: NormalizedProfile,
  name: ServiceName,
): ControlPlaneServiceMetadata {
  const sourceIds = getServiceSourceIds(name)

  return {
    endpointProvenance: resolveEndpointProvenance(profile, name),
    lifecycleOwner: resolveLifecycleOwner(profile, name),
    managementClass: resolveManagementClass(profile, name),
    mutationScope: resolveMutationScope(profile, name),
    operatorSurface: sourceIds.some(sourceId => getUpstreamSource(sourceId).stability === 'operator-only'),
  }
}

export function summarizeProfileCapabilities(profile: NormalizedProfile): ControlPlaneCapabilitySummary[] {
  if (profile.kind !== 'remote-validator' && profile.kind !== 'splice-localnet') {
    return []
  }

  const sourceIds = [...WALLET_INTEGRATION_SOURCE_IDS]

  return [{
    controlPlane: {
      lifecycleOwner: 'external-sdk',
      managementClass: 'read-only',
      mutationScope: 'out-of-scope',
      operatorSurface: false,
    },
    detail:
      'Wallet-connected application integrations belong to the official dApp and Wallet SDK packages, not the control-plane command surface.',
    name: 'wallet-integration',
    sdkPackages: sourceIds.map((sourceId) => {
      const source = getUpstreamSource(sourceId)
      if (source.source.kind !== 'npm') {
        throw new Error(`Expected npm upstream source for ${sourceId}`)
      }

      return {
        packageName: source.source.packageName,
        sourceId,
        version: source.source.version,
      }
    }),
    sourceIds,
    stability: 'public-sdk',
  }]
}

function resolveEndpointProvenance(
  profile: NormalizedProfile,
  name: ServiceName,
): ControlPlaneEndpointProvenance {
  if (getProfileDefinitionSource(profile) === 'legacy-network') {
    return 'legacy-network'
  }

  if (name === 'ledger' && !profile.services.ledger?.url) {
    return 'derived-local-default'
  }

  return 'declared'
}

function resolveLifecycleOwner(
  profile: NormalizedProfile,
  name: ServiceName,
): ControlPlaneLifecycleOwner {
  if (name === 'auth' && (profile.kind === 'sandbox' || profile.kind === 'canton-multi')) {
    return 'cantonctl'
  }

  switch (profile.kind) {
    case 'sandbox':
    case 'canton-multi':
    case 'splice-localnet':
      return 'official-local-runtime'
    case 'remote-validator':
    case 'remote-sv-network':
      return 'official-remote-runtime'
  }
}

function resolveManagementClass(
  profile: NormalizedProfile,
  name: ServiceName,
): ControlPlaneManagementClass {
  if (name === 'localnet') {
    return 'apply-capable'
  }

  if ((profile.kind === 'sandbox' || profile.kind === 'canton-multi') && (name === 'ledger' || name === 'auth')) {
    return 'apply-capable'
  }

  if (
    (profile.kind === 'remote-validator' || profile.kind === 'remote-sv-network')
    && name === 'ledger'
  ) {
    return 'apply-capable'
  }

  if (
    (profile.kind === 'remote-validator' || profile.kind === 'remote-sv-network')
    && name === 'validator'
  ) {
    return 'plan-only'
  }

  return 'read-only'
}

function resolveMutationScope(
  profile: NormalizedProfile,
  name: ServiceName,
): ControlPlaneMutationScope {
  return resolveManagementClass(profile, name) === 'read-only' ? 'observed' : 'managed'
}
