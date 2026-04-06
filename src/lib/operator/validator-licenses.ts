import {createScanAdapter, type ScanAdapter} from '../adapters/index.js'
import {isRecord, readArray, readNumber, readRecord, readString} from '../adapters/common.js'
import type {ResolvedOperatorSurface} from '../operator-surface.js'

export interface OperatorValidatorLicense {
  contractId?: string
  createdAt?: string
  payload?: Record<string, unknown>
  templateId?: string
}

export interface OperatorValidatorLicensesResult {
  auth: {
    credentialSource: ResolvedOperatorSurface['runtime']['operatorCredential']['source']
    envVarName: string
    required: boolean
  }
  endpoint: string
  licenses: OperatorValidatorLicense[]
  nextPageToken?: number
  profile: {
    kind: ResolvedOperatorSurface['runtime']['profile']['kind']
    name: string
    network: string
  }
  surface: {
    commandPath: string
    lifecycleOwner: ResolvedOperatorSurface['service']['controlPlane']['lifecycleOwner']
    managementClass: ResolvedOperatorSurface['service']['controlPlane']['managementClass']
    mutationScope: ResolvedOperatorSurface['service']['controlPlane']['mutationScope']
    service: string
    stability: ResolvedOperatorSurface['service']['stability']
    surfaceId: ResolvedOperatorSurface['surfaceId']
    upstreamSourceIds: readonly string[]
  }
  warnings: string[]
}

export interface OperatorValidatorLicensesDeps {
  createScanAdapter?: (options: Parameters<typeof createScanAdapter>[0]) => ScanAdapter
}

export interface OperatorValidatorLicensesRunner {
  list(options: {
    after?: number
    limit?: number
    signal?: AbortSignal
    surface: ResolvedOperatorSurface
  }): Promise<OperatorValidatorLicensesResult>
}

export function createOperatorValidatorLicenses(
  deps: OperatorValidatorLicensesDeps = {},
): OperatorValidatorLicensesRunner {
  const createScan = deps.createScanAdapter ?? createScanAdapter

  return {
    async list(options) {
      const adapter = createScan({
        baseUrl: options.surface.endpoint,
        profile: options.surface.runtime.profileContext,
        token: options.surface.runtime.operatorCredential.token,
      })
      const response = await adapter.listValidatorLicenses({
        after: options.after,
        limit: options.limit,
      }, options.signal)

      return {
        auth: {
          credentialSource: options.surface.runtime.operatorCredential.source,
          envVarName: options.surface.runtime.auth.operator.envVarName,
          required: options.surface.runtime.auth.operator.required,
        },
        endpoint: adapter.metadata.baseUrl,
        licenses: normalizeValidatorLicenses(response),
        nextPageToken: readNextPageToken(response),
        profile: {
          kind: options.surface.runtime.profile.kind,
          name: options.surface.runtime.profile.name,
          network: options.surface.runtime.networkName,
        },
        surface: {
          commandPath: options.surface.commandPath,
          lifecycleOwner: options.surface.service.controlPlane.lifecycleOwner,
          managementClass: options.surface.service.controlPlane.managementClass,
          mutationScope: options.surface.service.controlPlane.mutationScope,
          service: options.surface.service.name,
          stability: options.surface.service.stability,
          surfaceId: options.surface.surfaceId,
          upstreamSourceIds: [...options.surface.service.sourceIds],
        },
        warnings: collectWarnings([
          ...options.surface.runtime.auth.warnings,
          ...adapter.metadata.warnings,
        ]),
      }
    },
  }
}

function normalizeValidatorLicenses(response: unknown): OperatorValidatorLicense[] {
  if (!isRecord(response)) {
    return []
  }

  return (readArray(response, 'validator_licenses') ?? []).map(entry => normalizeValidatorLicense(entry))
}

function normalizeValidatorLicense(entry: unknown): OperatorValidatorLicense {
  if (!isRecord(entry)) {
    return {}
  }

  return {
    contractId: readString(entry, 'contract_id') ?? readString(entry, 'contractId'),
    createdAt: readString(entry, 'created_at') ?? readString(entry, 'createdAt'),
    payload: readRecord(entry, 'payload') ?? readRecord(entry, 'create_arguments'),
    templateId: readString(entry, 'template_id') ?? readString(entry, 'templateId'),
  }
}

function readNextPageToken(response: unknown): number | undefined {
  return isRecord(response) ? readNumber(response, 'next_page_token') ?? readNumber(response, 'nextPageToken') : undefined
}

function collectWarnings(warnings: readonly string[]): string[] {
  const seen = new Set<string>()
  const collected: string[] = []

  for (const warning of warnings) {
    if (warning && !seen.has(warning)) {
      seen.add(warning)
      collected.push(warning)
    }
  }

  return collected
}
