/**
 * Experimental validator-internal adapter.
 *
 * This module intentionally isolates operator-only validator endpoints from the
 * stable adapter tree. The upstream contract is marked non-GA, can change
 * without notice, and should only be used by explicitly experimental flows.
 */

import {CantonctlError, ErrorCode} from '../errors.js'
import {
  createAdapterTransport,
  type AdapterFetchFn,
  type AdapterHttpMethod,
  type AdapterMetadata,
  type AdapterProfileContext,
  type AdapterQueryValue,
} from '../adapters/common.js'

export interface ValidatorInternalAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token?: string
}

export interface ValidatorInternalRequest {
  body?: unknown
  bodyContentType?: string
  method: AdapterHttpMethod
  path: string
  query?: Record<string, AdapterQueryValue>
  signal?: AbortSignal
}

export interface OnboardUserRequest {
  createPartyIfMissing?: boolean
  name: string
  party_id?: string
}

export interface OnboardUserResponse {
  party_id: string
}

export interface GenerateExternalPartyTopologyRequest {
  party_hint: string
  public_key: string
}

export interface GenerateExternalPartyTopologyResponse {
  party_id: string
  topology_txs: Array<{
    hash: string
    topology_tx: string
  }>
}

export interface SubmitExternalPartyTopologyRequest {
  public_key: string
  signed_topology_txs: Array<{
    signed_hash: string
    topology_tx: string
  }>
}

export interface SubmitExternalPartyTopologyResponse {
  party_id: string
}

export interface CreateExternalPartySetupProposalRequest {
  user_party_id: string
}

export interface CreateExternalPartySetupProposalResponse {
  contract_id: string
}

export interface ValidatorInternalAdapter {
  createExternalPartySetupProposal(
    request: CreateExternalPartySetupProposalRequest,
    signal?: AbortSignal,
  ): Promise<CreateExternalPartySetupProposalResponse>
  generateExternalPartyTopology(
    request: GenerateExternalPartyTopologyRequest,
    signal?: AbortSignal,
  ): Promise<GenerateExternalPartyTopologyResponse>
  metadata: AdapterMetadata<'validator'>
  offboardUser(username: string, signal?: AbortSignal): Promise<void>
  onboardUser(request: OnboardUserRequest, signal?: AbortSignal): Promise<OnboardUserResponse>
  requestJson<T>(request: ValidatorInternalRequest): Promise<T>
  requestOptionalJson<T>(request: ValidatorInternalRequest): Promise<T | null>
  submitExternalPartyTopology(
    request: SubmitExternalPartyTopologyRequest,
    signal?: AbortSignal,
  ): Promise<SubmitExternalPartyTopologyResponse>
}

export const VALIDATOR_INTERNAL_OPERATOR_WARNING =
  'EXPERIMENTAL: validator-internal is operator-only and upstream provides no compatibility guarantees.'

export function requireExperimentalConfirmation(enabled: boolean, commandPath: string): void {
  if (enabled) return

  throw new CantonctlError(ErrorCode.EXPERIMENTAL_CONFIRMATION_REQUIRED, {
    suggestion:
      `Re-run "cantonctl ${commandPath} --experimental" to acknowledge the operator-only ` +
      'validator-internal contract.',
  })
}

export function createValidatorInternalAdapter(
  options: ValidatorInternalAdapterOptions,
): ValidatorInternalAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    profile: options.profile,
    service: 'validator',
    sourceIds: ['splice-validator-internal-openapi'],
    token: options.token,
    warnings: [
      VALIDATOR_INTERNAL_OPERATOR_WARNING,
      'These endpoints are intentionally isolated from the GA cantonctl adapter surface.',
    ],
  })

  return {
    async createExternalPartySetupProposal(request, signal) {
      return transport.requestJson<CreateExternalPartySetupProposalResponse>({
        body: request,
        method: 'POST',
        path: '/v0/admin/external-party/setup-proposal',
        signal,
      })
    },

    async generateExternalPartyTopology(request, signal) {
      return transport.requestJson<GenerateExternalPartyTopologyResponse>({
        body: request,
        method: 'POST',
        path: '/v0/admin/external-party/topology/generate',
        signal,
      })
    },

    metadata: transport.metadata,

    async offboardUser(username, signal) {
      await transport.requestOptionalJson<unknown>({
        method: 'POST',
        path: '/v0/admin/users/offboard',
        query: {username},
        signal,
      })
    },

    async onboardUser(request, signal) {
      return transport.requestJson<OnboardUserResponse>({
        body: request,
        method: 'POST',
        path: '/v0/admin/users',
        signal,
      })
    },

    async requestJson<T>(request: ValidatorInternalRequest) {
      return transport.requestJson<T>({
        body: request.body,
        bodyContentType: request.bodyContentType,
        method: request.method,
        path: request.path,
        query: request.query,
        signal: request.signal,
      })
    },

    async requestOptionalJson<T>(request: ValidatorInternalRequest) {
      return transport.requestOptionalJson<T>({
        body: request.body,
        bodyContentType: request.bodyContentType,
        method: request.method,
        path: request.path,
        query: request.query,
        signal: request.signal,
      })
    },

    async submitExternalPartyTopology(request, signal) {
      return transport.requestJson<SubmitExternalPartyTopologyResponse>({
        body: request,
        method: 'POST',
        path: '/v0/admin/external-party/topology/submit',
        signal,
      })
    },
  }
}
