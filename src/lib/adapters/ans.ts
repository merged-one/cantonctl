import {spliceAnsExternalMetadata} from '../../generated/splice/ans-external.js'
import type {
  SpliceAnsExternalComponents,
  SpliceAnsExternalOperations,
} from '../../generated/splice/index.js'
import {
  createAdapterTransport,
  type AdapterFetchFn,
  type AdapterMetadata,
  type AdapterProfileContext,
  isRecord,
  readString,
} from './common.js'

export interface AnsAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token?: string
}

export interface NormalizedAnsEntry {
  amount?: string
  contractId?: string
  expiresAt?: string
  name?: string
  paymentDuration?: string
  paymentInterval?: string
  unit?: string
}

export interface AnsAdapter {
  createEntry(request: AnsCreateEntryRequest, signal?: AbortSignal): Promise<AnsCreateEntryResponse>
  listEntries(signal?: AbortSignal): Promise<{entries: NormalizedAnsEntry[]}>
  metadata: AdapterMetadata<'ans'> & {
    generatedSpec: typeof spliceAnsExternalMetadata
  }
}

export type AnsCreateEntryRequest = SpliceAnsExternalComponents['schemas']['CreateAnsEntryRequest']
export type AnsCreateEntryResponse =
  SpliceAnsExternalOperations['createAnsEntry']['responses'][200]['content']['application/json']
export type AnsListEntriesResponse =
  SpliceAnsExternalOperations['listAnsEntries']['responses'][200]['content']['application/json']

export function createAnsAdapter(options: AnsAdapterOptions): AnsAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    profile: options.profile,
    service: 'ans',
    sourceIds: [spliceAnsExternalMetadata.sourceId],
    token: options.token,
  })

  const metadata = {
    ...transport.metadata,
    generatedSpec: spliceAnsExternalMetadata,
  }

  return {
    metadata,

    async createEntry(request, signal) {
      return transport.requestJson<AnsCreateEntryResponse>({
        body: request,
        method: 'POST',
        path: '/v0/entry/create',
        signal,
      })
    },

    async listEntries(signal) {
      const response = await transport.requestJson<AnsListEntriesResponse>({
        method: 'GET',
        path: '/v0/entry/all',
        signal,
      })

      return {
        entries: normalizeAnsEntriesResponse(response),
      }
    },
  }
}

export function normalizeAnsEntriesResponse(response: AnsListEntriesResponse | unknown): NormalizedAnsEntry[] {
  if (!isRecord(response) || !Array.isArray(response.entries)) {
    return []
  }

  return response.entries.map(entry => normalizeAnsEntry(entry))
}

export function normalizeAnsEntry(entry: unknown): NormalizedAnsEntry {
  if (!isRecord(entry)) {
    return {}
  }

  return {
    amount: readString(entry, 'amount'),
    contractId: readString(entry, 'contractId'),
    expiresAt: readString(entry, 'expiresAt'),
    name: readString(entry, 'name'),
    paymentDuration: readString(entry, 'paymentDuration'),
    paymentInterval: readString(entry, 'paymentInterval'),
    unit: readString(entry, 'unit'),
  }
}
