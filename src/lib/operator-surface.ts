import type {ServiceName} from './config-profile.js'
import type {
  ControlPlaneLifecycleOwner,
  ControlPlaneManagementClass,
  ControlPlaneMutationScope,
} from './control-plane.js'
import type {ProfileServiceSummary} from './compat.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {ResolvedProfileRuntime} from './profile-runtime.js'
import type {UpstreamSourceId, UpstreamStabilityClass} from './upstream/manifest.js'

export const OPERATOR_SURFACE_IDS = ['validator-licenses'] as const

export type OperatorSurfaceId = typeof OPERATOR_SURFACE_IDS[number]

export interface OperatorSurfaceDefinition {
  commandPath: string
  description: string
  lifecycleOwners: readonly ControlPlaneLifecycleOwner[]
  managementClasses: readonly ControlPlaneManagementClass[]
  mutationScopes: readonly ControlPlaneMutationScope[]
  profileKinds: readonly ResolvedProfileRuntime['profile']['kind'][]
  service: ServiceName
  sourceIds: readonly UpstreamSourceId[]
  stabilities: readonly UpstreamStabilityClass[]
}

export interface ResolvedOperatorSurface {
  commandPath: string
  definition: OperatorSurfaceDefinition
  endpoint: string
  runtime: ResolvedProfileRuntime
  service: ProfileServiceSummary
  surfaceId: OperatorSurfaceId
}

const OPERATOR_SURFACES: Record<OperatorSurfaceId, OperatorSurfaceDefinition> = {
  'validator-licenses': {
    commandPath: 'operator validator licenses',
    description: 'Read approved validator licenses from the explicit Scan admin surface.',
    lifecycleOwners: ['official-remote-runtime'],
    managementClasses: ['read-only'],
    mutationScopes: ['observed'],
    profileKinds: ['remote-validator', 'remote-sv-network'],
    service: 'scan',
    sourceIds: ['splice-scan-external-openapi'],
    stabilities: ['stable-external'],
  },
}

export function getOperatorSurfaceDefinition(surfaceId: OperatorSurfaceId): OperatorSurfaceDefinition {
  return OPERATOR_SURFACES[surfaceId]
}

export function listOperatorSurfaceDefinitions(): Array<{surfaceId: OperatorSurfaceId} & OperatorSurfaceDefinition> {
  return OPERATOR_SURFACE_IDS.map(surfaceId => ({
    surfaceId,
    ...getOperatorSurfaceDefinition(surfaceId),
  }))
}

export function resolveOperatorSurface(
  runtime: ResolvedProfileRuntime,
  surfaceId: OperatorSurfaceId,
): ResolvedOperatorSurface {
  const definition = getOperatorSurfaceDefinition(surfaceId)

  if (!definition.profileKinds.includes(runtime.profile.kind)) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {
        commandPath: definition.commandPath,
        profileKind: runtime.profile.kind,
        supportedProfileKinds: definition.profileKinds,
      },
      suggestion:
        `${definition.commandPath} is limited to ${definition.profileKinds.join(', ')} profiles ` +
        'that require explicit operator credentials.',
    })
  }

  if (!runtime.auth.operator.required) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {
        commandPath: definition.commandPath,
        network: runtime.networkName,
        profile: runtime.profile.name,
      },
      suggestion:
        `${definition.commandPath} requires a remote profile with explicit operator auth. ` +
        'Use a remote validator or SV profile for operator-mode actions.',
    })
  }

  if (runtime.operatorCredential.source === 'missing') {
    throw new CantonctlError(ErrorCode.SERVICE_AUTH_FAILED, {
      context: {
        commandPath: definition.commandPath,
        envVarName: runtime.auth.operator.envVarName,
        network: runtime.networkName,
      },
      suggestion:
        `Provide ${runtime.auth.operator.envVarName} or store a credential with ` +
        `"cantonctl auth login ${runtime.networkName} --scope operator" before running ${definition.commandPath}.`,
    })
  }

  const service = runtime.services.find(candidate => candidate.name === definition.service)
  if (!service?.endpoint) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {
        commandPath: definition.commandPath,
        profile: runtime.profile.name,
        service: definition.service,
      },
      suggestion:
        `${definition.commandPath} requires a configured ${definition.service} endpoint on ` +
        `profile "${runtime.profile.name}".`,
    })
  }

  if (!definition.sourceIds.every(sourceId => service.sourceIds.includes(sourceId))) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {
        actualSourceIds: service.sourceIds,
        commandPath: definition.commandPath,
        requiredSourceIds: definition.sourceIds,
        service: service.name,
      },
      suggestion:
        `${definition.commandPath} is only approved for ${definition.sourceIds.join(', ')}. ` +
        'The selected profile resolved a different upstream service contract.',
    })
  }

  if (!definition.stabilities.includes(service.stability as UpstreamStabilityClass)) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {
        actualStability: service.stability,
        commandPath: definition.commandPath,
        requiredStabilities: definition.stabilities,
        service: service.name,
      },
      suggestion:
        `${definition.commandPath} requires ${definition.service} to resolve to ` +
        `${definition.stabilities.join(', ')} stability. The selected profile does not match that boundary.`,
    })
  }

  if (!definition.lifecycleOwners.includes(service.controlPlane.lifecycleOwner)) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {
        actualLifecycleOwner: service.controlPlane.lifecycleOwner,
        commandPath: definition.commandPath,
        requiredLifecycleOwners: definition.lifecycleOwners,
        service: service.name,
      },
      suggestion:
        `${definition.commandPath} is limited to official runtime endpoints inside the current operator boundary.`,
    })
  }

  if (!definition.managementClasses.includes(service.controlPlane.managementClass)) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {
        actualManagementClass: service.controlPlane.managementClass,
        commandPath: definition.commandPath,
        requiredManagementClasses: definition.managementClasses,
        service: service.name,
      },
      suggestion:
        `${definition.commandPath} is not approved for ${service.controlPlane.managementClass} ${definition.service} surfaces.`,
    })
  }

  if (!definition.mutationScopes.includes(service.controlPlane.mutationScope)) {
    throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
      context: {
        actualMutationScope: service.controlPlane.mutationScope,
        commandPath: definition.commandPath,
        requiredMutationScopes: definition.mutationScopes,
        service: service.name,
      },
      suggestion:
        `${definition.commandPath} is outside the current control-plane boundary for ${definition.service}.`,
    })
  }

  return {
    commandPath: definition.commandPath,
    definition,
    endpoint: service.endpoint,
    runtime,
    service,
    surfaceId,
  }
}
