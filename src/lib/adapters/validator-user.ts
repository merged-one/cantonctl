import {createAdapterTransport, type AdapterFetchFn, type AdapterMetadata, type AdapterProfileContext} from './common.js'

export interface ValidatorUserAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token?: string
}

export interface CreateBuyTrafficRequest {
  domain_id: string
  expires_at: number
  receiving_validator_party_id: string
  tracking_id: string
  traffic_amount: number
}

export interface CreateBuyTrafficRequestResponse {
  request_contract_id: string
}

export type GetBuyTrafficRequestStatusResponse =
  | {status: 'created'}
  | {status: 'completed'; transaction_id: string}
  | {failure_reason: 'expired' | 'rejected'; rejection_reason?: string; status: 'failed'}

export interface ValidatorUserAdapter {
  createBuyTrafficRequest(
    request: CreateBuyTrafficRequest,
    signal?: AbortSignal,
  ): Promise<CreateBuyTrafficRequestResponse>
  getBuyTrafficRequestStatus(
    trackingId: string,
    signal?: AbortSignal,
  ): Promise<GetBuyTrafficRequestStatusResponse | null>
  metadata: AdapterMetadata<'validator'> & {
    upstreamSourceIds: ['splice-wallet-external-openapi']
  }
}

export function createValidatorUserAdapter(options: ValidatorUserAdapterOptions): ValidatorUserAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    profile: options.profile,
    service: 'validator',
    sourceIds: ['splice-wallet-external-openapi'],
    token: options.token,
  })

  return {
    metadata: transport.metadata as ValidatorUserAdapter['metadata'],

    async createBuyTrafficRequest(request, signal) {
      return transport.requestJson<CreateBuyTrafficRequestResponse>({
        body: request,
        method: 'POST',
        path: '/v0/wallet/buy-traffic-requests',
        signal,
      })
    },

    async getBuyTrafficRequestStatus(trackingId, signal) {
      return transport.requestOptionalJson<GetBuyTrafficRequestStatusResponse>({
        method: 'POST',
        path: `/v0/wallet/buy-traffic-requests/${encodeURIComponent(trackingId)}/status`,
        signal,
      })
    },
  }
}
