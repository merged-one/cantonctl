import type {CantonctlConfig} from './config.js'
import {resolveProfile} from './compat.js'
import {
  createAnsAdapter,
  createLedgerAdapter,
  createScanAdapter,
  createScanProxyAdapter,
  createTokenStandardAdapter,
  createValidatorUserAdapter,
  type AdapterProfileContext,
  type AnsAdapter,
  type AnsAdapterOptions,
  type LedgerAdapter,
  type LedgerAdapterOptions,
  type LedgerDisclosedContract,
  type LedgerInterfaceView,
  type ScanAdapter,
  type ScanAdapterOptions,
  type ScanProxyAdapter,
  type ScanProxyAdapterOptions,
  type TokenStandardAdapter,
  type TokenStandardAdapterOptions,
  type ValidatorUserAdapter,
  type ValidatorUserAdapterOptions,
} from './adapters/index.js'
import {CantonctlError, ErrorCode} from './errors.js'
import {isRecord, readRecord, readString} from './adapters/common.js'

export const TOKEN_HOLDING_INTERFACE_ID =
  '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding'
export const TOKEN_TRANSFER_FACTORY_INTERFACE_ID =
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory'
export const TOKEN_TRANSFER_FACTORY_CHOICE = 'TransferFactory_Transfer'

interface TransferFactoryResponse {
  choiceContext?: {
    choiceContextData?: unknown
    disclosedContracts?: unknown[]
  }
  factoryId: string
  transferKind: string
}

export interface ScanUpdatesResult {
  endpoint: string
  raw?: unknown
  source: 'scan'
  updates: Array<Record<string, unknown>>
  warnings: readonly string[]
}

export interface ScanAcsResult {
  createdEvents: Array<Record<string, unknown>>
  endpoint: string
  nextPageToken?: number
  raw?: unknown
  snapshot: {
    migrationId?: number
    recordTime?: string
  }
  source: 'scan'
  warnings: readonly string[]
}

export interface ScanCurrentStateResult {
  dsoInfo: Record<string, unknown>
  endpoint: string
  issuingMiningRounds: unknown[]
  openMiningRounds: unknown[]
  source: 'scan' | 'scanProxy'
  warnings: readonly string[]
}

export interface StableAnsEntry {
  amount?: string
  contractId?: string
  description?: string
  expiresAt?: string
  name?: string
  paymentDuration?: string
  paymentInterval?: string
  unit?: string
  url?: string
  user?: string
}

export interface AnsListResult {
  endpoint: string
  entries: StableAnsEntry[]
  source: 'ans' | 'scan' | 'scanProxy'
  warnings: readonly string[]
}

export interface AnsCreateResult {
  endpoint: string
  response: Record<string, unknown>
  source: 'ans'
  warnings: readonly string[]
}

export interface TokenHolding {
  amount?: string
  contractId?: string
  instrumentId?: {admin?: string; id?: string}
  lock?: unknown
  meta?: unknown
  owner?: string
  synchronizerId?: string
  templateId?: string
}

export interface TokenHoldingsResult {
  endpoint: string
  holdings: TokenHolding[]
  interfaceId: typeof TOKEN_HOLDING_INTERFACE_ID
  warnings: readonly string[]
}

export interface TokenTransferResult {
  endpoint: {
    ledger: string
    tokenStandard: string
  }
  factoryId: string
  transaction: Record<string, unknown>
  transferKind: string
  warnings: readonly string[]
}

export interface TrafficBuyResult {
  endpoint: string
  requestContractId: string
  source: 'validator-user'
  status: {status: 'created'}
  trackingId: string
  warnings: readonly string[]
}

export interface TrafficStatusResult {
  endpoint: string
  source: 'validator-user'
  status: Record<string, unknown>
  trackingId: string
  warnings: readonly string[]
}

export interface StableSplice {
  createAnsEntry(options: {
    ansBaseUrl?: string
    description: string
    name: string
    profile?: AdapterProfileContext
    signal?: AbortSignal
    token?: string
    url: string
  }): Promise<AnsCreateResult>
  createTrafficBuy(options: {
    domainId: string
    expiresAt?: string
    profile?: AdapterProfileContext
    receivingValidatorPartyId: string
    signal?: AbortSignal
    token?: string
    trackingId?: string
    trafficAmount: number
    validatorBaseUrl?: string
  }): Promise<TrafficBuyResult>
  getScanAcs(options: {
    after?: number
    before?: string
    migrationId: number
    pageSize: number
    partyIds?: string[]
    profile?: AdapterProfileContext
    recordTime?: string
    recordTimeMatch?: 'exact' | 'at_or_before'
    scanBaseUrl?: string
    signal?: AbortSignal
    templates?: string[]
  }): Promise<ScanAcsResult>
  getScanCurrentState(options: {
    profile?: AdapterProfileContext
    scanBaseUrl?: string
    scanProxyBaseUrl?: string
    signal?: AbortSignal
  }): Promise<ScanCurrentStateResult>
  getTrafficRequestStatus(options: {
    profile?: AdapterProfileContext
    signal?: AbortSignal
    token?: string
    trackingId: string
    validatorBaseUrl?: string
  }): Promise<TrafficStatusResult>
  listAnsEntries(options: {
    ansBaseUrl?: string
    name?: string
    namePrefix?: string
    pageSize?: number
    party?: string
    profile?: AdapterProfileContext
    scanBaseUrl?: string
    scanProxyBaseUrl?: string
    signal?: AbortSignal
    source?: 'ans' | 'auto' | 'scan' | 'scanProxy'
    token?: string
  }): Promise<AnsListResult>
  listScanUpdates(options: {
    after?: {migrationId: number; recordTime: string}
    pageSize: number
    profile?: AdapterProfileContext
    scanBaseUrl?: string
    signal?: AbortSignal
  }): Promise<ScanUpdatesResult>
  listTokenHoldings(options: {
    instrumentAdmin?: string
    instrumentId?: string
    ledgerBaseUrl?: string
    party: string
    profile?: AdapterProfileContext
    signal?: AbortSignal
    token?: string
  }): Promise<TokenHoldingsResult>
  transferToken(options: {
    amount: string
    executeBefore?: string
    inputHoldingCids?: string[]
    instrumentAdmin: string
    instrumentId: string
    ledgerBaseUrl?: string
    profile?: AdapterProfileContext
    receiver: string
    requestedAt?: string
    sender: string
    signal?: AbortSignal
    token?: string
    tokenStandardBaseUrl?: string
  }): Promise<TokenTransferResult>
}

export interface StableSpliceDeps {
  createAnsAdapter?: (options: AnsAdapterOptions) => AnsAdapter
  createLedgerAdapter?: (options: LedgerAdapterOptions) => LedgerAdapter
  createScanAdapter?: (options: ScanAdapterOptions) => ScanAdapter
  createScanProxyAdapter?: (options: ScanProxyAdapterOptions) => ScanProxyAdapter
  createTokenStandardAdapter?: (options: TokenStandardAdapterOptions) => TokenStandardAdapter
  createValidatorUserAdapter?: (options: ValidatorUserAdapterOptions) => ValidatorUserAdapter
  now?: () => Date
}

export function createStableSplice(deps: StableSpliceDeps = {}): StableSplice {
  const createAns = deps.createAnsAdapter ?? createAnsAdapter
  const createLedger = deps.createLedgerAdapter ?? createLedgerAdapter
  const createScan = deps.createScanAdapter ?? createScanAdapter
  const createScanProxy = deps.createScanProxyAdapter ?? createScanProxyAdapter
  const createTokenStandard = deps.createTokenStandardAdapter ?? createTokenStandardAdapter
  const createValidatorUser = deps.createValidatorUserAdapter ?? createValidatorUserAdapter
  const now = deps.now ?? (() => new Date())

  return {
    async createAnsEntry(options) {
      const adapter = createAns({
        baseUrl: options.ansBaseUrl,
        profile: options.profile,
        token: requireToken(options.token, 'ans'),
      })
      const response = await adapter.createEntry({
        description: options.description,
        name: options.name,
        url: options.url,
      }, options.signal)

      return {
        endpoint: adapter.metadata.baseUrl,
        response: toRecord(response),
        source: 'ans',
        warnings: adapter.metadata.warnings,
      }
    },

    async createTrafficBuy(options) {
      const adapter = createValidatorUser({
        baseUrl: options.validatorBaseUrl,
        profile: options.profile,
        token: requireToken(options.token, 'validator'),
      })
      const issuedAt = now()
      const trackingId = options.trackingId ?? `cantonctl-traffic-${issuedAt.getTime()}`
      const expiresAtMicros = options.expiresAt
        ? toUnixMicros(options.expiresAt)
        : (issuedAt.getTime() + 15 * 60 * 1000) * 1000

      const response = await adapter.createBuyTrafficRequest({
        domain_id: options.domainId,
        expires_at: expiresAtMicros,
        receiving_validator_party_id: options.receivingValidatorPartyId,
        tracking_id: trackingId,
        traffic_amount: options.trafficAmount,
      }, options.signal)

      return {
        endpoint: adapter.metadata.baseUrl,
        requestContractId: response.request_contract_id,
        source: 'validator-user',
        status: {status: 'created'},
        trackingId,
        warnings: adapter.metadata.warnings,
      }
    },

    async getScanAcs(options) {
      const adapter = createScan({
        baseUrl: options.scanBaseUrl,
        profile: options.profile,
      })
      const recordTime = options.recordTime
        ?? (await adapter.getAcsSnapshotTimestampBefore({
          before: options.before ?? now().toISOString(),
          migrationId: options.migrationId,
        }, options.signal)).record_time

      const response = await adapter.getAcsSnapshot({
        after: options.after,
        migration_id: options.migrationId,
        page_size: options.pageSize,
        party_ids: options.partyIds,
        record_time: recordTime,
        record_time_match: options.recordTimeMatch ?? 'exact',
        templates: options.templates,
      }, options.signal)

      return {
        createdEvents: Array.isArray(response.created_events)
          ? response.created_events.map(event => normalizeScanCreatedEvent(event))
          : [],
        endpoint: adapter.metadata.baseUrl,
        nextPageToken: response.next_page_token,
        raw: toRecord(response),
        snapshot: {
          migrationId: response.migration_id,
          recordTime: response.record_time,
        },
        source: 'scan',
        warnings: adapter.metadata.warnings,
      }
    },

    async getScanCurrentState(options) {
      const useScan = !!(options.scanBaseUrl || options.profile?.services.scan?.url)
      if (useScan) {
        const adapter = createScan({
          baseUrl: options.scanBaseUrl,
          profile: options.profile,
        })
        const dsoInfo = await adapter.getDsoInfo(options.signal)
        const rounds = await adapter.getOpenAndIssuingMiningRounds({
          cached_issuing_round_contract_ids: [],
          cached_open_mining_round_contract_ids: [],
        }, options.signal)

        return {
          dsoInfo: toRecord(dsoInfo),
          endpoint: adapter.metadata.baseUrl,
          issuingMiningRounds: Array.isArray(rounds.issuing_mining_rounds) ? rounds.issuing_mining_rounds : [],
          openMiningRounds: Array.isArray(rounds.open_mining_rounds) ? rounds.open_mining_rounds : [],
          source: 'scan',
          warnings: adapter.metadata.warnings,
        }
      }

      const adapter = createScanProxy({
        baseUrl: options.scanProxyBaseUrl,
        profile: options.profile,
      })
      const dsoInfo = await adapter.getDsoInfo(options.signal)
      const rounds = await adapter.getOpenAndIssuingMiningRounds(options.signal)

      return {
        dsoInfo: toRecord(dsoInfo),
        endpoint: adapter.metadata.baseUrl,
        issuingMiningRounds: Array.isArray(rounds.issuing_mining_rounds) ? rounds.issuing_mining_rounds : [],
        openMiningRounds: Array.isArray(rounds.open_mining_rounds) ? rounds.open_mining_rounds : [],
        source: 'scanProxy',
        warnings: adapter.metadata.warnings,
      }
    },

    async getTrafficRequestStatus(options) {
      const adapter = createValidatorUser({
        baseUrl: options.validatorBaseUrl,
        profile: options.profile,
        token: requireToken(options.token, 'validator'),
      })
      const status = await adapter.getBuyTrafficRequestStatus(options.trackingId, options.signal)
      if (!status) {
        throw new CantonctlError(ErrorCode.SERVICE_REQUEST_FAILED, {
          context: {trackingId: options.trackingId},
          suggestion: `No validator traffic request with tracking id "${options.trackingId}" was found.`,
        })
      }

      return {
        endpoint: adapter.metadata.baseUrl,
        source: 'validator-user',
        status: toRecord(status),
        trackingId: options.trackingId,
        warnings: adapter.metadata.warnings,
      }
    },

    async listAnsEntries(options) {
      const pageSize = options.pageSize ?? 20
      const source = pickAnsSource(options)

      if (source === 'ans') {
        const adapter = createAns({
          baseUrl: options.ansBaseUrl,
          profile: options.profile,
          token: requireToken(options.token, 'ans'),
        })
        const response = await adapter.listEntries(options.signal)

        return {
          endpoint: adapter.metadata.baseUrl,
          entries: response.entries
            .map(entry => normalizeOwnedAnsEntry(entry))
            .filter(entry => matchesAnsFilters(entry, options)),
          source: 'ans',
          warnings: adapter.metadata.warnings,
        }
      }

      if (source === 'scan') {
        const adapter = createScan({
          baseUrl: options.scanBaseUrl,
          profile: options.profile,
        })

        return {
          endpoint: adapter.metadata.baseUrl,
          entries: await queryPublicAnsEntries({
            lookupByName: (name, signal) => adapter.lookupAnsEntryByName(name, signal),
            lookupByParty: (party, signal) => adapter.lookupAnsEntryByParty(party, signal),
            list: (params, signal) => adapter.listAnsEntries(params, signal),
            options,
          }),
          source: 'scan',
          warnings: adapter.metadata.warnings,
        }
      }

      const adapter = createScanProxy({
        baseUrl: options.scanProxyBaseUrl,
        profile: options.profile,
      })

      return {
        endpoint: adapter.metadata.baseUrl,
        entries: await queryPublicAnsEntries({
          lookupByName: (name, signal) => adapter.lookupAnsEntryByName(name, signal),
          lookupByParty: (party, signal) => adapter.lookupAnsEntryByParty(party, signal),
          list: (params, signal) => adapter.listAnsEntries(params, signal),
          options,
        }),
        source: 'scanProxy',
        warnings: adapter.metadata.warnings,
      }
    },

    async listScanUpdates(options) {
      const adapter = createScan({
        baseUrl: options.scanBaseUrl,
        profile: options.profile,
      })
      const response = await adapter.getUpdateHistory({
        after: options.after
          ? {
            after_migration_id: options.after.migrationId,
            after_record_time: options.after.recordTime,
          }
          : undefined,
        page_size: options.pageSize,
      }, options.signal)

      return {
        endpoint: adapter.metadata.baseUrl,
        raw: toRecord(response.raw),
        source: 'scan',
        updates: response.updates.map(update => toRecord(update)),
        warnings: adapter.metadata.warnings,
      }
    },

    async listTokenHoldings(options) {
      const adapter = createLedger({
        baseUrl: options.ledgerBaseUrl,
        profile: options.profile,
        token: requireToken(options.token, 'ledger'),
      })
      const response = await adapter.getActiveContracts({
        filter: {
          interfaceIds: [TOKEN_HOLDING_INTERFACE_ID],
          party: options.party,
        },
      }, options.signal)

      return {
        endpoint: adapter.metadata.baseUrl,
        holdings: response.activeContracts
          .map(contract => normalizeTokenHolding(contract.interfaceViews, contract))
          .filter((holding): holding is TokenHolding => holding !== null)
          .filter(holding => {
            if (options.instrumentAdmin && holding.instrumentId?.admin !== options.instrumentAdmin) {
              return false
            }
            if (options.instrumentId && holding.instrumentId?.id !== options.instrumentId) {
              return false
            }
            return true
          }),
        interfaceId: TOKEN_HOLDING_INTERFACE_ID,
        warnings: adapter.metadata.warnings,
      }
    },

    async transferToken(options) {
      const tokenStandard = createTokenStandard({
        baseUrl: options.tokenStandardBaseUrl,
        profile: options.profile,
        token: requireToken(options.token, 'tokenStandard'),
      })
      const ledger = createLedger({
        baseUrl: options.ledgerBaseUrl,
        profile: options.profile,
        token: requireToken(options.token, 'ledger'),
      })
      const issuedAt = now()
      const requestedAt = options.requestedAt ?? issuedAt.toISOString()
      const executeBefore = options.executeBefore ?? new Date(issuedAt.getTime() + 15 * 60 * 1000).toISOString()
      const baseChoiceArgument = {
        expectedAdmin: options.instrumentAdmin,
        extraArgs: {
          context: {values: {}},
          meta: {values: {}},
        },
        transfer: {
          amount: options.amount,
          executeBefore,
          inputHoldingCids: options.inputHoldingCids ?? [],
          instrumentId: {
            admin: options.instrumentAdmin,
            id: options.instrumentId,
          },
          meta: {values: {}},
          receiver: options.receiver,
          requestedAt,
          sender: options.sender,
        },
      }

      const factory = await tokenStandard.families.transferInstruction.requestJson<TransferFactoryResponse>({
        body: {
          choiceArguments: baseChoiceArgument,
        },
        method: 'POST',
        path: '/registry/transfer-instruction/v1/transfer-factory',
        signal: options.signal,
      })

      const choiceArgument = {
        ...baseChoiceArgument,
        extraArgs: {
          context: factory.choiceContext?.choiceContextData ?? {values: {}},
          meta: {values: {}},
        },
      }

      const transaction = await ledger.submitAndWait({
        actAs: [options.sender],
        commandId: `cantonctl-token-transfer-${issuedAt.getTime()}`,
        commands: [{
          ExerciseCommand: {
            choice: TOKEN_TRANSFER_FACTORY_CHOICE,
            choiceArgument,
            contractId: factory.factoryId,
            templateId: TOKEN_TRANSFER_FACTORY_INTERFACE_ID,
          },
        }],
        disclosedContracts: normalizeDisclosedContracts(factory.choiceContext?.disclosedContracts),
      }, options.signal)

      return {
        endpoint: {
          ledger: ledger.metadata.baseUrl,
          tokenStandard: tokenStandard.metadata.baseUrl,
        },
        factoryId: factory.factoryId,
        transaction: transaction.transaction,
        transferKind: factory.transferKind,
        warnings: tokenStandard.metadata.warnings,
      }
    },
  }
}

export function resolveStableSpliceProfile(
  config: CantonctlConfig,
  profileName?: string,
): AdapterProfileContext {
  const {profile} = resolveProfile(config, profileName)
  return {
    experimental: profile.experimental,
    kind: profile.kind,
    name: profile.name,
    services: profile.services,
  }
}

function matchesAnsFilters(
  entry: StableAnsEntry,
  options: {name?: string; namePrefix?: string},
): boolean {
  if (options.name && entry.name !== options.name) {
    return false
  }
  if (options.namePrefix && !entry.name?.startsWith(options.namePrefix)) {
    return false
  }
  return true
}

function normalizeOwnedAnsEntry(entry: {
  amount?: string
  contractId?: string
  expiresAt?: string
  name?: string
  paymentDuration?: string
  paymentInterval?: string
  unit?: string
}): StableAnsEntry {
  return {
    amount: typeof entry.amount === 'string' ? entry.amount : undefined,
    contractId: typeof entry.contractId === 'string' ? entry.contractId : undefined,
    expiresAt: typeof entry.expiresAt === 'string' ? entry.expiresAt : undefined,
    name: typeof entry.name === 'string' ? entry.name : undefined,
    paymentDuration: typeof entry.paymentDuration === 'string' ? entry.paymentDuration : undefined,
    paymentInterval: typeof entry.paymentInterval === 'string' ? entry.paymentInterval : undefined,
    unit: typeof entry.unit === 'string' ? entry.unit : undefined,
  }
}

function normalizePublicAnsEntry(entry: unknown): StableAnsEntry {
  if (!isRecord(entry)) {
    return {}
  }

  return {
    contractId: readString(entry, 'contract_id') ?? readString(entry, 'contractId'),
    description: readString(entry, 'description'),
    expiresAt: readString(entry, 'expires_at') ?? readString(entry, 'expiresAt'),
    name: readString(entry, 'name'),
    url: readString(entry, 'url'),
    user: readString(entry, 'user'),
  }
}

function normalizeScanCreatedEvent(event: unknown): Record<string, unknown> {
  if (!isRecord(event)) {
    return {}
  }

  return {
    contractId: readString(event, 'contract_id'),
    createdAt: readString(event, 'created_at'),
    observers: Array.isArray(event.observers) ? event.observers : [],
    payload: event.create_arguments,
    signatories: Array.isArray(event.signatories) ? event.signatories : [],
    templateId: readString(event, 'template_id'),
  }
}

function normalizeTokenHolding(
  interfaceViews: LedgerInterfaceView[] | undefined,
  contract: {
    contractId?: string
    synchronizerId?: string
    templateId?: string
  },
): TokenHolding | null {
  const holdingView = interfaceViews?.find(view => view.interfaceId?.includes('HoldingV1:Holding'))
  if (!holdingView || !isRecord(holdingView.viewValue)) {
    return null
  }

  const instrumentId = readRecord(holdingView.viewValue, 'instrumentId')

  return {
    amount: readString(holdingView.viewValue, 'amount'),
    contractId: contract.contractId,
    instrumentId: instrumentId
      ? {
        admin: readString(instrumentId, 'admin'),
        id: readString(instrumentId, 'id'),
      }
      : undefined,
    lock: holdingView.viewValue.lock,
    meta: holdingView.viewValue.meta,
    owner: readString(holdingView.viewValue, 'owner'),
    synchronizerId: contract.synchronizerId,
    templateId: contract.templateId,
  }
}

async function queryPublicAnsEntries(options: {
  lookupByName(name: string, signal?: AbortSignal): Promise<Record<string, unknown> | null>
  lookupByParty(party: string, signal?: AbortSignal): Promise<Record<string, unknown> | null>
  list(
    params: {namePrefix?: string; pageSize: number},
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  options: {
    name?: string
    namePrefix?: string
    pageSize?: number
    party?: string
    signal?: AbortSignal
  }
}): Promise<StableAnsEntry[]> {
  if (options.options.name) {
    const response = await options.lookupByName(options.options.name, options.options.signal)
    return response && isRecord(response) ? [normalizePublicAnsEntry(response.entry)] : []
  }

  if (options.options.party) {
    const response = await options.lookupByParty(options.options.party, options.options.signal)
    return response && isRecord(response) ? [normalizePublicAnsEntry(response.entry)] : []
  }

  const response = await options.list({
    namePrefix: options.options.namePrefix,
    pageSize: options.options.pageSize ?? 20,
  }, options.options.signal)

  return isRecord(response) && Array.isArray(response.entries)
    ? response.entries.map(entry => normalizePublicAnsEntry(entry))
    : []
}

function pickAnsSource(options: {
  ansBaseUrl?: string
  profile?: AdapterProfileContext
  party?: string
  scanBaseUrl?: string
  scanProxyBaseUrl?: string
  source?: 'ans' | 'auto' | 'scan' | 'scanProxy'
  token?: string
}): 'ans' | 'scan' | 'scanProxy' {
  if (options.source && options.source !== 'auto') {
    return options.source
  }

  const hasAns = !!(options.ansBaseUrl || options.profile?.services.ans?.url)
  if (hasAns && !options.party && hasUsableToken(options.token)) {
    return 'ans'
  }

  if (options.scanBaseUrl || options.profile?.services.scan?.url) {
    return 'scan'
  }

  if (options.scanProxyBaseUrl || options.profile?.services.scanProxy?.url) {
    return 'scanProxy'
  }

  if (hasAns) {
    return 'ans'
  }

  throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
    suggestion: 'Configure ans, scan, or scanProxy on the selected profile, or pass an explicit service URL.',
  })
}

function normalizeDisclosedContracts(contracts: unknown[] | undefined): LedgerDisclosedContract[] | undefined {
  if (!Array.isArray(contracts)) {
    return undefined
  }

  return contracts
    .filter(isRecord)
    .map(contract => ({
      contractId: readString(contract, 'contractId') ?? '',
      createdEventBlob: readString(contract, 'createdEventBlob') ?? '',
      synchronizerId: readString(contract, 'synchronizerId') ?? '',
      templateId: readString(contract, 'templateId') ?? '',
    }))
}

function requireToken(token: string | undefined, service: string): string {
  if (hasUsableToken(token)) {
    return token
  }

  throw new CantonctlError(ErrorCode.SERVICE_AUTH_FAILED, {
    context: {service},
    suggestion: `Pass --token <jwt> to authenticate against the ${service} surface.`,
  })
}

function hasUsableToken(token: string | undefined): token is string {
  return !!token && token.trim().length > 0
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function toUnixMicros(value: string): number {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
      context: {value},
      suggestion: `Use an ISO-8601 timestamp for "${value}", for example 2026-04-02T20:15:00Z.`,
    })
  }

  return parsed * 1000
}
