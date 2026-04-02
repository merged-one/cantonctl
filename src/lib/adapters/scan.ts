import {spliceScanExternalMetadata} from '../../generated/splice/scan-external.js'
import type {
  SpliceScanExternalComponents,
  SpliceScanExternalOperations,
} from '../../generated/splice/index.js'
import {
  createAdapterTransport,
  type AdapterFetchFn,
  type AdapterMetadata,
  type AdapterProfileContext,
  isRecord,
  readArray,
  readNumber,
  readRecord,
  readString,
} from './common.js'

export interface ScanAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token?: string
}

export interface NormalizedScanUpdate {
  eventCount?: number
  externalTransactionHash?: string
  kind: 'reassignment' | 'transaction' | 'unknown'
  migrationId?: number
  recordTime?: string
  rootEventCount?: number
  updateId?: string
}

export interface ScanUpdateHistoryResult {
  raw: ScanUpdateHistoryResponse
  updates: NormalizedScanUpdate[]
}

export interface ScanAdapter {
  getAcsSnapshot(
    request: ScanAcsRequest,
    signal?: AbortSignal,
  ): Promise<ScanAcsResponse>
  getAcsSnapshotTimestampBefore(
    params: {before: string; migrationId: number},
    signal?: AbortSignal,
  ): Promise<ScanAcsSnapshotTimestampResponse>
  getClosedRounds(signal?: AbortSignal): Promise<ScanGetClosedRoundsResponse>
  getDsoInfo(signal?: AbortSignal): Promise<ScanGetDsoInfoResponse>
  getOpenAndIssuingMiningRounds(
    request: ScanGetOpenAndIssuingMiningRoundsRequest,
    signal?: AbortSignal,
  ): Promise<ScanGetOpenAndIssuingMiningRoundsResponse>
  getUpdateHistory(
    request: ScanUpdateHistoryRequest,
    signal?: AbortSignal,
  ): Promise<ScanUpdateHistoryResult>
  listAnsEntries(
    params: {namePrefix?: string; pageSize: number},
    signal?: AbortSignal,
  ): Promise<ScanListEntriesResponse>
  listDsoScans(signal?: AbortSignal): Promise<ScanListDsoScansResponse>
  listValidatorLicenses(
    params?: {after?: number; limit?: number},
    signal?: AbortSignal,
  ): Promise<ScanListValidatorLicensesResponse>
  lookupAnsEntryByName(
    name: string,
    signal?: AbortSignal,
  ): Promise<ScanLookupEntryByNameResponse | null>
  lookupAnsEntryByParty(
    party: string,
    signal?: AbortSignal,
  ): Promise<ScanLookupEntryByPartyResponse | null>
  metadata: AdapterMetadata<'scan'> & {
    generatedSpec: typeof spliceScanExternalMetadata
  }
}

export type ScanGetDsoInfoResponse =
  SpliceScanExternalOperations['getDsoInfo']['responses'][200]['content']['application/json']
export type ScanListDsoScansResponse =
  SpliceScanExternalOperations['listDsoScans']['responses'][200]['content']['application/json']
export type ScanListValidatorLicensesResponse =
  SpliceScanExternalOperations['listValidatorLicenses']['responses'][200]['content']['application/json']
export type ScanGetClosedRoundsResponse =
  SpliceScanExternalOperations['getClosedRounds']['responses'][200]['content']['application/json']
export type ScanAcsRequest = SpliceScanExternalComponents['schemas']['AcsRequest']
export type ScanAcsResponse =
  SpliceScanExternalOperations['getAcsSnapshotAt']['responses'][200]['content']['application/json']
export type ScanAcsSnapshotTimestampResponse =
  SpliceScanExternalComponents['schemas']['AcsSnapshotTimestampResponse']
export type ScanGetOpenAndIssuingMiningRoundsRequest =
  SpliceScanExternalComponents['schemas']['GetOpenAndIssuingMiningRoundsRequest']
export type ScanGetOpenAndIssuingMiningRoundsResponse =
  SpliceScanExternalOperations['getOpenAndIssuingMiningRounds']['responses'][200]['content']['application/json']
export type ScanUpdateHistoryRequest = SpliceScanExternalComponents['schemas']['UpdateHistoryRequestV2']
export type ScanUpdateHistoryResponse =
  SpliceScanExternalOperations['getUpdateHistoryV2']['responses'][200]['content']['application/json']
export type ScanUpdateHistoryItem = SpliceScanExternalComponents['schemas']['UpdateHistoryItemV2']
export type ScanListEntriesResponse = SpliceScanExternalComponents['schemas']['ListEntriesResponse']
export type ScanLookupEntryByNameResponse = SpliceScanExternalComponents['schemas']['LookupEntryByNameResponse']
export type ScanLookupEntryByPartyResponse = SpliceScanExternalComponents['schemas']['LookupEntryByPartyResponse']

export function createScanAdapter(options: ScanAdapterOptions): ScanAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    profile: options.profile,
    service: 'scan',
    sourceIds: [spliceScanExternalMetadata.sourceId],
    token: options.token,
  })

  const metadata = {
    ...transport.metadata,
    generatedSpec: spliceScanExternalMetadata,
  }

  return {
    metadata,

    async getAcsSnapshot(request, signal) {
      return transport.requestJson<ScanAcsResponse>({
        body: request,
        method: 'POST',
        path: '/v0/state/acs',
        signal,
      })
    },

    async getAcsSnapshotTimestampBefore(params, signal) {
      return transport.requestJson<ScanAcsSnapshotTimestampResponse>({
        method: 'GET',
        path: '/v0/state/acs/snapshot-timestamp',
        query: {
          before: params.before,
          migration_id: params.migrationId,
        },
        signal,
      })
    },

    async getClosedRounds(signal) {
      return transport.requestJson<ScanGetClosedRoundsResponse>({
        method: 'GET',
        path: '/v0/closed-rounds',
        signal,
      })
    },

    async getDsoInfo(signal) {
      return transport.requestJson<ScanGetDsoInfoResponse>({
        method: 'GET',
        path: '/v0/dso',
        signal,
      })
    },

    async getOpenAndIssuingMiningRounds(request, signal) {
      return transport.requestJson<ScanGetOpenAndIssuingMiningRoundsResponse>({
        body: request,
        method: 'POST',
        path: '/v0/open-and-issuing-mining-rounds',
        signal,
      })
    },

    async getUpdateHistory(request, signal) {
      const raw = await transport.requestJson<ScanUpdateHistoryResponse>({
        body: request,
        method: 'POST',
        path: '/v2/updates',
        signal,
      })

      return {
        raw,
        updates: normalizeScanUpdateHistoryResponse(raw),
      }
    },

    async listAnsEntries(params, signal) {
      return transport.requestJson<ScanListEntriesResponse>({
        method: 'GET',
        path: '/v0/ans-entries',
        query: {
          name_prefix: params.namePrefix,
          page_size: params.pageSize,
        },
        signal,
      })
    },

    async listDsoScans(signal) {
      return transport.requestJson<ScanListDsoScansResponse>({
        method: 'GET',
        path: '/v0/scans',
        signal,
      })
    },

    async listValidatorLicenses(params, signal) {
      return transport.requestJson<ScanListValidatorLicensesResponse>({
        method: 'GET',
        path: '/v0/admin/validator/licenses',
        query: {
          after: params?.after,
          limit: params?.limit,
        },
        signal,
      })
    },

    async lookupAnsEntryByName(name, signal) {
      return transport.requestOptionalJson<ScanLookupEntryByNameResponse>({
        method: 'GET',
        path: `/v0/ans-entries/by-name/${encodeURIComponent(name)}`,
        signal,
      })
    },

    async lookupAnsEntryByParty(party, signal) {
      return transport.requestOptionalJson<ScanLookupEntryByPartyResponse>({
        method: 'GET',
        path: `/v0/ans-entries/by-party/${encodeURIComponent(party)}`,
        signal,
      })
    },
  }
}

export function normalizeScanUpdateHistoryResponse(
  response: ScanUpdateHistoryResponse | unknown,
): NormalizedScanUpdate[] {
  if (!isRecord(response) || !Array.isArray(response.transactions)) {
    return []
  }

  return response.transactions.map(transaction => normalizeScanUpdateHistoryItem(transaction))
}

export function normalizeScanUpdateHistoryItem(
  item: ScanUpdateHistoryItem | unknown,
): NormalizedScanUpdate {
  if (!isRecord(item)) {
    return {kind: 'unknown'}
  }

  const rootEventIds = readArray(item, 'root_event_ids')
  const eventsById = readRecord(item, 'events_by_id')
  const event = readRecord(item, 'event')
  const eventMigrationId = event ? readNumber(event, 'migration_id') : undefined
  const kind = rootEventIds || eventsById
    ? 'transaction'
    : event
      ? 'reassignment'
      : 'unknown'

  return {
    eventCount: eventsById ? Object.keys(eventsById).length : undefined,
    externalTransactionHash: readString(item, 'external_transaction_hash'),
    kind,
    migrationId: readNumber(item, 'migration_id') ?? eventMigrationId,
    recordTime: readString(item, 'record_time'),
    rootEventCount: rootEventIds?.length,
    updateId: readString(item, 'update_id'),
  }
}
