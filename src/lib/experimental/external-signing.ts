/**
 * Experimental external-signing adapter.
 *
 * These flows expose advanced prepare/sign/execute mechanics with trust and UX
 * assumptions that are not settled for general cantonctl usage yet. Keep all
 * callers explicit and experimental until a later milestone promotes them.
 */

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
} from '../adapters/common.js'

export interface ExternalSigningAdapterOptions {
  baseUrl?: string
  fetch?: AdapterFetchFn
  profile?: AdapterProfileContext
  token: string
}

export interface ExternalSigningAdapter {
  executeSubmission(
    request: ExternalSigningExecuteSubmissionRequest,
    signal?: AbortSignal,
  ): Promise<ExternalSigningExecuteSubmissionResponse>
  executeSubmissionAndWait(
    request: ExternalSigningExecuteSubmissionAndWaitRequest,
    signal?: AbortSignal,
  ): Promise<ExternalSigningExecuteSubmissionAndWaitResponse>
  executeSubmissionAndWaitForTransaction(
    request: ExternalSigningExecuteSubmissionAndWaitForTransactionRequest,
    signal?: AbortSignal,
  ): Promise<ExternalSigningExecuteSubmissionAndWaitForTransactionResponse>
  metadata: AdapterMetadata<'ledger'> & {
    generatedSpec: typeof cantonJsonLedgerApiMetadata
  }
  prepareSubmission(
    request: ExternalSigningPrepareSubmissionRequest,
    signal?: AbortSignal,
  ): Promise<ExternalSigningPrepareSubmissionResponse>
}

export type ExternalSigningPrepareSubmissionRequest =
  CantonJsonLedgerApiComponents['schemas']['JsPrepareSubmissionRequest']
export type ExternalSigningPrepareSubmissionResponse =
  CantonJsonLedgerApiOperations['postV2Interactive-submissionPrepare']['responses'][200]['content']['application/json']
export type ExternalSigningExecuteSubmissionRequest =
  CantonJsonLedgerApiComponents['schemas']['JsExecuteSubmissionRequest']
export type ExternalSigningExecuteSubmissionResponse =
  CantonJsonLedgerApiOperations['postV2Interactive-submissionExecute']['responses'][200]['content']['application/json']
export type ExternalSigningExecuteSubmissionAndWaitRequest =
  CantonJsonLedgerApiComponents['schemas']['JsExecuteSubmissionAndWaitRequest']
export type ExternalSigningExecuteSubmissionAndWaitResponse =
  CantonJsonLedgerApiOperations['postV2Interactive-submissionExecuteandwait']['responses'][200]['content']['application/json']
export type ExternalSigningExecuteSubmissionAndWaitForTransactionRequest =
  CantonJsonLedgerApiComponents['schemas']['JsExecuteSubmissionAndWaitForTransactionRequest']
export type ExternalSigningExecuteSubmissionAndWaitForTransactionResponse =
  CantonJsonLedgerApiOperations['postV2Interactive-submissionExecuteandwaitfortransaction']['responses'][200]['content']['application/json']

export function createExternalSigningAdapter(
  options: ExternalSigningAdapterOptions,
): ExternalSigningAdapter {
  const transport = createAdapterTransport({
    baseUrl: options.baseUrl,
    errorCodes: {
      auth: ErrorCode.LEDGER_AUTH_EXPIRED,
      connection: ErrorCode.LEDGER_CONNECTION_FAILED,
      request: ErrorCode.LEDGER_COMMAND_REJECTED,
    },
    fetch: options.fetch,
    profile: options.profile,
    service: 'ledger',
    sourceIds: [cantonJsonLedgerApiMetadata.sourceId],
    token: options.token,
    warnings: [
      'experimental: external-signing stays internal until cantonctl defines a stable trust model and user-facing workflow for prepared transactions.',
      'Do not treat prepared transaction helper flows as a GA cantonctl contract yet.',
    ],
  })

  const metadata = {
    ...transport.metadata,
    generatedSpec: cantonJsonLedgerApiMetadata,
  }

  return {
    metadata,

    async executeSubmission(request, signal) {
      return transport.requestJson<ExternalSigningExecuteSubmissionResponse>({
        body: request,
        method: 'POST',
        path: '/v2/interactive-submission/execute',
        signal,
      })
    },

    async executeSubmissionAndWait(request, signal) {
      return transport.requestJson<ExternalSigningExecuteSubmissionAndWaitResponse>({
        body: request,
        method: 'POST',
        path: '/v2/interactive-submission/executeAndWait',
        signal,
      })
    },

    async executeSubmissionAndWaitForTransaction(request, signal) {
      return transport.requestJson<ExternalSigningExecuteSubmissionAndWaitForTransactionResponse>({
        body: request,
        method: 'POST',
        path: '/v2/interactive-submission/executeAndWaitForTransaction',
        signal,
      })
    },

    async prepareSubmission(request, signal) {
      return transport.requestJson<ExternalSigningPrepareSubmissionResponse>({
        body: request,
        method: 'POST',
        path: '/v2/interactive-submission/prepare',
        signal,
      })
    },
  }
}
