import {cantonJsonLedgerApiMetadata} from '../../generated/ledger-json-api/canton-json-ledger-api.js'
import type {
  CantonJsonLedgerApiComponents,
  CantonJsonLedgerApiOperations,
} from '../../generated/ledger-json-api/index.js'
import {ErrorCode} from '../errors.js'
import {
  createAdapterTransport,
  type AdapterFetchFn,
  type AdapterMetadata,
  type AdapterProfileContext,
  isRecord,
  readNumber,
  readRecord,
  readString,
} from './common.js'

export interface LedgerAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token: string
}

export interface SubmitRequest {
  actAs: string[]
  commandId: string
  commands: unknown[]
  readAs?: string[]
  submissionId?: string
  synchronizerId?: string
  userId?: string
  workflowId?: string
}

export interface ContractFilter {
  party: string
  templateIds?: string[]
}

export interface LedgerActiveContract {
  contractId?: string
  createdAt?: string
  offset?: number
  payload?: unknown
  templateId?: string
}

export interface LedgerAdapter {
  allocateParty(params: {displayName: string; identifierHint?: string}, signal?: AbortSignal): Promise<{partyDetails: Record<string, unknown>}>
  getActiveContracts(params: {filter: ContractFilter}, signal?: AbortSignal): Promise<{activeContracts: LedgerActiveContract[]}>
  getLedgerEnd(signal?: AbortSignal): Promise<LedgerGetLedgerEndResponse>
  getParties(signal?: AbortSignal): Promise<{partyDetails: Array<Record<string, unknown>>}>
  getVersion(signal?: AbortSignal): Promise<LedgerGetVersionResponse>
  metadata: AdapterMetadata<'ledger'> & {
    generatedSpec: typeof cantonJsonLedgerApiMetadata
  }
  submitAndWait(request: SubmitRequest, signal?: AbortSignal): Promise<{transaction: Record<string, unknown>}>
  uploadDar(darBytes: Uint8Array, signal?: AbortSignal): Promise<{mainPackageId: string}>
}

export type LedgerGetVersionResponse =
  CantonJsonLedgerApiOperations['getV2Version']['responses'][200]['content']['application/json']
export type LedgerGetLedgerEndResponse =
  CantonJsonLedgerApiOperations['getV2StateLedger-end']['responses'][200]['content']['application/json']
export type LedgerSubmitAndWaitRequestBody = CantonJsonLedgerApiComponents['schemas']['JsSubmitAndWaitForTransactionRequest']
export type LedgerSubmitAndWaitResponse =
  CantonJsonLedgerApiOperations['postV2CommandsSubmit-and-wait-for-transaction']['responses'][200]['content']['application/json']
export type LedgerGetActiveContractsRequest = CantonJsonLedgerApiComponents['schemas']['GetActiveContractsRequest']
export type LedgerGetActiveContractsResponse =
  CantonJsonLedgerApiOperations['postV2StateActive-contracts']['responses'][200]['content']['application/json']

export function createLedgerAdapter(options: LedgerAdapterOptions): LedgerAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    errorCodes: {
      auth: ErrorCode.LEDGER_AUTH_EXPIRED,
      connection: ErrorCode.LEDGER_CONNECTION_FAILED,
      request: ErrorCode.LEDGER_CONNECTION_FAILED,
    },
    fetch: options.fetch,
    profile: options.profile,
    service: 'ledger',
    sourceIds: [cantonJsonLedgerApiMetadata.sourceId],
    token: options.token,
  })

  const metadata = {
    ...transport.metadata,
    generatedSpec: cantonJsonLedgerApiMetadata,
  }

  return {
    metadata,

    async allocateParty(params, signal) {
      const response = await transport.requestJson<Record<string, unknown>>({
        body: {
          displayName: params.displayName,
          partyIdHint: params.identifierHint ?? params.displayName,
        },
        method: 'POST',
        path: '/v2/parties',
        signal,
      })

      return {
        partyDetails: isRecord(response.partyDetails) ? response.partyDetails : {},
      }
    },

    async getActiveContracts(params, signal) {
      const ledgerEnd = await transport.requestJson<LedgerGetLedgerEndResponse>({
        method: 'GET',
        path: '/v2/state/ledger-end',
        signal,
      })

      const cumulative = (params.filter.templateIds?.length ?? 0) > 0
        ? params.filter.templateIds!.map(templateId => ({
          identifierFilter: {
            TemplateFilter: {
              value: {
                includeCreatedEventBlob: false,
                templateId,
              },
            },
          },
        }))
        : [{
          identifierFilter: {
            WildcardFilter: {
              value: {
                includeCreatedEventBlob: false,
              },
            },
          },
        }]

      const body = {
        activeAtOffset: ledgerEnd.offset ?? 0,
        filter: {
          filtersByParty: {
            [params.filter.party]: {
              cumulative,
            },
          },
        },
        verbose: true,
      } as LedgerGetActiveContractsRequest

      const raw = await transport.requestJson<LedgerGetActiveContractsResponse>({
        body,
        method: 'POST',
        path: '/v2/state/active-contracts',
        signal,
      })

      return {
        activeContracts: normalizeLedgerActiveContractsResponse(raw),
      }
    },

    async getLedgerEnd(signal) {
      return transport.requestJson<LedgerGetLedgerEndResponse>({
        method: 'GET',
        path: '/v2/state/ledger-end',
        signal,
      })
    },

    async getParties(signal) {
      const response = await transport.requestJson<Record<string, unknown>>({
        method: 'GET',
        path: '/v2/parties',
        signal,
      })
      const partyDetails = Array.isArray(response.partyDetails)
        ? response.partyDetails.filter(isRecord)
        : []

      return {partyDetails}
    },

    async getVersion(signal) {
      return transport.requestJson<LedgerGetVersionResponse>({
        method: 'GET',
        path: '/v2/version',
        signal,
      })
    },

    async submitAndWait(request, signal) {
      const body: LedgerSubmitAndWaitRequestBody = {
        commands: {
          actAs: request.actAs,
          commandId: request.commandId,
          commands: request.commands as CantonJsonLedgerApiComponents['schemas']['Command'][],
          readAs: request.readAs,
          submissionId: request.submissionId,
          synchronizerId: request.synchronizerId,
          userId: request.userId,
          workflowId: request.workflowId,
        },
      }

      const response = await transport.requestJson<LedgerSubmitAndWaitResponse>({
        body,
        errorCodes: {request: ErrorCode.LEDGER_COMMAND_REJECTED},
        method: 'POST',
        path: '/v2/commands/submit-and-wait-for-transaction',
        signal,
      })

      return {
        transaction: isRecord(response.transaction) ? response.transaction : {},
      }
    },

    async uploadDar(darBytes, signal) {
      const response = await transport.requestJson<Record<string, unknown>>({
        body: darBytes,
        errorCodes: {request: ErrorCode.DEPLOY_UPLOAD_FAILED},
        method: 'POST',
        path: '/v2/dars',
        signal,
      })

      return {
        // The generated schema is currently empty here, but existing callers expect
        // the historical mainPackageId field when the participant provides it.
        mainPackageId: readString(response, 'mainPackageId') as string,
      }
    },
  }
}

export function normalizeLedgerActiveContractsResponse(
  response: LedgerGetActiveContractsResponse | unknown,
): LedgerActiveContract[] {
  if (!Array.isArray(response)) {
    return []
  }

  const activeContracts: LedgerActiveContract[] = []
  for (const item of response) {
    if (!isRecord(item)) continue
    const contractEntry = readRecord(item, 'contractEntry')
    const activeContract = contractEntry ? readRecord(contractEntry, 'JsActiveContract') : undefined
    const createdEvent = activeContract ? readRecord(activeContract, 'createdEvent') : undefined
    if (!createdEvent) continue

    activeContracts.push({
      contractId: readString(createdEvent, 'contractId'),
      createdAt: readString(createdEvent, 'createdAt'),
      offset: readNumber(createdEvent, 'offset'),
      payload: createdEvent.createArgument,
      templateId: readString(createdEvent, 'templateId'),
    })
  }

  return activeContracts
}
