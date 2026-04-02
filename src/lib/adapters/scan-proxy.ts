import type {SpliceScanExternalComponents} from '../../generated/splice/index.js'
import {
  createAdapterTransport,
  type AdapterFetchFn,
  type AdapterMetadata,
  type AdapterProfileContext,
} from './common.js'

export interface ScanProxyAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token?: string
}

type ScanSchema = SpliceScanExternalComponents['schemas']

export type ScanProxyGetDsoPartyIdResponse = ScanSchema['GetDsoPartyIdResponse']
export type ScanProxyGetDsoInfoResponse = ScanSchema['GetDsoInfoResponse']
export type ScanProxyListEntriesResponse = ScanSchema['ListEntriesResponse']
export type ScanProxyLookupEntryByPartyResponse = ScanSchema['LookupEntryByPartyResponse']
export type ScanProxyLookupEntryByNameResponse = ScanSchema['LookupEntryByNameResponse']
export type ScanProxyGetAnsRulesRequest = ScanSchema['GetAnsRulesRequest']
export type ScanProxyGetAnsRulesResponse = ScanSchema['GetAnsRulesResponse']
export type ScanProxyLookupTransferPreapprovalByPartyResponse =
  ScanSchema['LookupTransferPreapprovalByPartyResponse']
export type ScanProxyLookupTransferCommandCounterByPartyResponse =
  ScanSchema['LookupTransferCommandCounterByPartyResponse']
export type ScanProxyLookupTransferCommandStatusResponse =
  ScanSchema['LookupTransferCommandStatusResponse']
export type ScanProxyContractWithState = ScanSchema['ContractWithState']

export interface ScanProxyGetOpenAndIssuingMiningRoundsResponse {
  issuing_mining_rounds: ScanProxyContractWithState[]
  open_mining_rounds: ScanProxyContractWithState[]
}

export interface ScanProxyGetAmuletRulesResponse {
  amulet_rules: ScanProxyContractWithState
}

export interface ScanProxyAdapter {
  getAmuletRules(signal?: AbortSignal): Promise<ScanProxyGetAmuletRulesResponse>
  getAnsRules(request: ScanProxyGetAnsRulesRequest, signal?: AbortSignal): Promise<ScanProxyGetAnsRulesResponse>
  getDsoInfo(signal?: AbortSignal): Promise<ScanProxyGetDsoInfoResponse>
  getDsoPartyId(signal?: AbortSignal): Promise<ScanProxyGetDsoPartyIdResponse>
  getOpenAndIssuingMiningRounds(signal?: AbortSignal): Promise<ScanProxyGetOpenAndIssuingMiningRoundsResponse>
  listAnsEntries(params: {namePrefix?: string; pageSize: number}, signal?: AbortSignal): Promise<ScanProxyListEntriesResponse>
  lookupAnsEntryByName(name: string, signal?: AbortSignal): Promise<ScanProxyLookupEntryByNameResponse | null>
  lookupAnsEntryByParty(party: string, signal?: AbortSignal): Promise<ScanProxyLookupEntryByPartyResponse | null>
  lookupTransferCommandCounterByParty(
    party: string,
    signal?: AbortSignal,
  ): Promise<ScanProxyLookupTransferCommandCounterByPartyResponse | null>
  lookupTransferCommandStatus(
    params: {nonce: number; sender: string},
    signal?: AbortSignal,
  ): Promise<ScanProxyLookupTransferCommandStatusResponse | null>
  lookupTransferPreapprovalByParty(
    party: string,
    signal?: AbortSignal,
  ): Promise<ScanProxyLookupTransferPreapprovalByPartyResponse | null>
  metadata: AdapterMetadata<'scanProxy'>
}

export function createScanProxyAdapter(options: ScanProxyAdapterOptions): ScanProxyAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    profile: options.profile,
    service: 'scanProxy',
    sourceIds: ['splice-scan-proxy-openapi'],
    token: options.token,
    warnings: [
      'scan-proxy is intentionally narrow and read-mostly inside cantonctl until the upstream proxy contract is promoted.',
    ],
  })

  return {
    metadata: transport.metadata,

    async getAmuletRules(signal) {
      return transport.requestJson<ScanProxyGetAmuletRulesResponse>({
        method: 'GET',
        path: '/v0/scan-proxy/amulet-rules',
        signal,
      })
    },

    async getAnsRules(request, signal) {
      return transport.requestJson<ScanProxyGetAnsRulesResponse>({
        body: request,
        method: 'POST',
        path: '/v0/scan-proxy/ans-rules',
        signal,
      })
    },

    async getDsoInfo(signal) {
      return transport.requestJson<ScanProxyGetDsoInfoResponse>({
        method: 'GET',
        path: '/v0/scan-proxy/dso',
        signal,
      })
    },

    async getDsoPartyId(signal) {
      return transport.requestJson<ScanProxyGetDsoPartyIdResponse>({
        method: 'GET',
        path: '/v0/scan-proxy/dso-party-id',
        signal,
      })
    },

    async getOpenAndIssuingMiningRounds(signal) {
      return transport.requestJson<ScanProxyGetOpenAndIssuingMiningRoundsResponse>({
        method: 'GET',
        path: '/v0/scan-proxy/open-and-issuing-mining-rounds',
        signal,
      })
    },

    async listAnsEntries(params, signal) {
      return transport.requestJson<ScanProxyListEntriesResponse>({
        method: 'GET',
        path: '/v0/scan-proxy/ans-entries',
        query: {
          name_prefix: params.namePrefix,
          page_size: params.pageSize,
        },
        signal,
      })
    },

    async lookupAnsEntryByName(name, signal) {
      return transport.requestOptionalJson<ScanProxyLookupEntryByNameResponse>({
        method: 'GET',
        path: `/v0/scan-proxy/ans-entries/by-name/${encodeURIComponent(name)}`,
        signal,
      })
    },

    async lookupAnsEntryByParty(party, signal) {
      return transport.requestOptionalJson<ScanProxyLookupEntryByPartyResponse>({
        method: 'GET',
        path: `/v0/scan-proxy/ans-entries/by-party/${encodeURIComponent(party)}`,
        signal,
      })
    },

    async lookupTransferCommandCounterByParty(party, signal) {
      return transport.requestOptionalJson<ScanProxyLookupTransferCommandCounterByPartyResponse>({
        method: 'GET',
        path: `/v0/scan-proxy/transfer-command-counter/${encodeURIComponent(party)}`,
        signal,
      })
    },

    async lookupTransferCommandStatus(params, signal) {
      return transport.requestOptionalJson<ScanProxyLookupTransferCommandStatusResponse>({
        method: 'GET',
        path: '/v0/scan-proxy/transfer-command/status',
        query: {
          nonce: params.nonce,
          sender: params.sender,
        },
        signal,
      })
    },

    async lookupTransferPreapprovalByParty(party, signal) {
      return transport.requestOptionalJson<ScanProxyLookupTransferPreapprovalByPartyResponse>({
        method: 'GET',
        path: `/v0/scan-proxy/transfer-preapprovals/by-party/${encodeURIComponent(party)}`,
        signal,
      })
    },
  }
}
