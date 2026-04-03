import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {StableSplice} from '../lib/splice-public.js'
import AnsCreate from './ans/create.js'
import AnsList from './ans/list.js'
import ScanAcs from './scan/acs.js'
import ScanCurrentState from './scan/current-state.js'
import ScanUpdates from './scan/updates.js'
import TokenHoldings from './token/holdings.js'
import TokenTransfer from './token/transfer.js'
import ValidatorTrafficBuy from './validator/traffic-buy.js'
import ValidatorTrafficStatus from './validator/traffic-status.js'

const CLI_ROOT = process.cwd()

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    profiles: {
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ans: {url: 'https://ans.example.com'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com/api/validator'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

describe('stable splice command surface', () => {
  it('emits scan update history in json mode', async () => {
    class TestScanUpdates extends ScanUpdates {
      protected override createStableSplice(): StableSplice {
        return {
          listScanUpdates: async () => ({
            endpoint: 'https://scan.example.com',
            source: 'scan',
            updates: [{kind: 'transaction', recordTime: '2026-04-02T20:00:00Z', updateId: 'update-1'}],
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestScanUpdates.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: 'https://scan.example.com',
      source: 'scan',
      updates: [{kind: 'transaction', recordTime: '2026-04-02T20:00:00Z', updateId: 'update-1'}],
    }))
  })

  it('renders scan update history in human mode', async () => {
    class TestScanUpdates extends ScanUpdates {
      protected override createStableSplice(): StableSplice {
        return {
          listScanUpdates: async () => ({
            endpoint: 'https://scan.example.com',
            source: 'scan',
            updates: [{
              eventCount: 3,
              kind: 'transaction',
              migrationId: 7,
              recordTime: '2026-04-02T20:00:00Z',
              updateId: 'update-1',
            }],
            warnings: ['partial-history'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestScanUpdates.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('update-1')
    expect(result.stdout).toContain('transaction')
    expect(result.stderr).toContain('partial-history')
  })

  it('serializes invalid scan cursor arguments', async () => {
    class TestScanUpdates extends ScanUpdates {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestScanUpdates.run([
      '--json',
      '--after-migration-id',
      '7',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
    }))
  })

  it('emits token holdings in json mode', async () => {
    class TestTokenHoldings extends TokenHoldings {
      protected override createStableSplice(): StableSplice {
        return {
          listTokenHoldings: async () => ({
            endpoint: 'https://ledger.example.com',
            holdings: [{
              amount: '5.0000000000',
              contractId: 'holding-1',
              instrumentId: {admin: 'Registry', id: 'USD'},
              owner: 'Alice',
            }],
            interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestTokenHoldings.run([
      '--json',
      '--party',
      'Alice',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      holdings: [
        expect.objectContaining({
          amount: '5.0000000000',
          contractId: 'holding-1',
          owner: 'Alice',
        }),
      ],
      interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
    }))
  })

  it('emits ans create results in json mode', async () => {
    class TestAnsCreate extends AnsCreate {
      protected override createStableSplice(): StableSplice {
        return {
          createAnsEntry: async () => ({
            endpoint: 'https://ans.example.com',
            response: {
              entryContextCid: 'entry-context-1',
              subscriptionRequestCid: 'subscription-1',
            },
            source: 'ans',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAnsCreate.run([
      '--json',
      '--description',
      'Alice profile',
      '--name',
      'alice.unverified.ans',
      '--token',
      'jwt-token',
      '--url',
      'https://alice.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      response: expect.objectContaining({
        entryContextCid: 'entry-context-1',
        subscriptionRequestCid: 'subscription-1',
      }),
      source: 'ans',
    }))
  })

  it('renders ans create results in human mode', async () => {
    class TestAnsCreate extends AnsCreate {
      protected override createStableSplice(): StableSplice {
        return {
          createAnsEntry: async () => ({
            endpoint: 'https://ans.example.com',
            response: {
              entryContextCid: 'entry-context-1',
              name: 'alice.unverified.ans',
              subscriptionRequestCid: 'subscription-1',
            },
            source: 'ans',
            warnings: ['ownership-check-pending'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAnsCreate.run([
      '--description',
      'Alice profile',
      '--name',
      'alice.unverified.ans',
      '--url',
      'https://alice.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Entry: alice.unverified.ans')
    expect(result.stdout).toContain('Subscription request: subscription-1')
    expect(result.stderr).toContain('ownership-check-pending')
  })

  it('emits validator traffic status in json mode', async () => {
    class TestValidatorTrafficStatus extends ValidatorTrafficStatus {
      protected override createStableSplice(): StableSplice {
        return {
          getTrafficRequestStatus: async () => ({
            endpoint: 'https://validator.example.com/api/validator',
            source: 'validator-user',
            status: {status: 'completed', transaction_id: 'tx-traffic-1'},
            trackingId: 'traffic-1',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestValidatorTrafficStatus.run([
      '--json',
      '--token',
      'jwt-token',
      '--tracking-id',
      'traffic-1',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      source: 'validator-user',
      status: {
        status: 'completed',
        transaction_id: 'tx-traffic-1',
      },
      trackingId: 'traffic-1',
    }))
  })

  it('lists ans entries in json mode', async () => {
    class TestAnsList extends AnsList {
      protected override createStableSplice(): StableSplice {
        return {
          listAnsEntries: async () => ({
            endpoint: 'https://ans.example.com',
            entries: [{
              contractId: 'ans-1',
              name: 'alice.unverified.ans',
              url: 'https://alice.example.com',
              user: 'Alice',
            }],
            source: 'ans',
            warnings: ['using-owned-service'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAnsList.run([
      '--json',
      '--party',
      'Alice',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.warnings).toEqual(['using-owned-service'])
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: 'https://ans.example.com',
      entries: [expect.objectContaining({name: 'alice.unverified.ans', user: 'Alice'})],
      source: 'ans',
    }))
  })

  it('renders ans listings in human mode', async () => {
    class TestAnsList extends AnsList {
      protected override createStableSplice(): StableSplice {
        return {
          listAnsEntries: async () => ({
            endpoint: 'https://ans.example.com',
            entries: [{
              contractId: 'ans-1',
              name: 'alice.unverified.ans',
              url: 'https://alice.example.com',
              user: 'Alice',
            }],
            source: 'scanProxy',
            warnings: ['using-scan-proxy'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAnsList.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Source: scanProxy')
    expect(result.stdout).toContain('alice.unverified.ans')
    expect(result.stderr).toContain('using-scan-proxy')
  })

  it('renders scan current-state summaries in human mode', async () => {
    class TestScanCurrentState extends ScanCurrentState {
      protected override createStableSplice(): StableSplice {
        return {
          getScanCurrentState: async () => ({
            dsoInfo: {dso_party_id: 'DSO::1220'},
            endpoint: 'https://scan-proxy.example.com',
            issuingMiningRounds: [{round: 1}],
            openMiningRounds: [{round: 2}, {round: 3}],
            source: 'scanProxy',
            warnings: ['fallback-to-scan-proxy'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestScanCurrentState.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Source: scanProxy')
    expect(result.stdout).toContain('Endpoint: https://scan-proxy.example.com')
    expect(result.stdout).toContain('DSO party: DSO::1220')
    expect(result.stderr).toContain('fallback-to-scan-proxy')
  })

  it('emits scan current-state summaries in json mode when explicit endpoints bypass profile resolution', async () => {
    const getScanCurrentState = vi.fn(async () => ({
      dsoInfo: {dso_party_id: null},
      endpoint: 'https://scan.example.com',
      issuingMiningRounds: [{round: 1}],
      openMiningRounds: [],
      source: 'scan',
      warnings: ['direct-scan-read'],
    }))

    class TestScanCurrentState extends ScanCurrentState {
      protected override createStableSplice(): StableSplice {
        return {
          getScanCurrentState,
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestScanCurrentState.run([
      '--json',
      '--scan-url',
      'https://scan.example.com',
      '--scan-proxy-url',
      'https://scan-proxy.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(getScanCurrentState).toHaveBeenCalledWith({
      profile: undefined,
      scanBaseUrl: 'https://scan.example.com',
      scanProxyBaseUrl: 'https://scan-proxy.example.com',
    })

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.warnings).toEqual(['direct-scan-read'])
    expect(json.data).toEqual(expect.objectContaining({
      dsoInfo: {dso_party_id: null},
      endpoint: 'https://scan.example.com',
      source: 'scan',
    }))
  })

  it('emits scan acs snapshots in json mode', async () => {
    class TestScanAcs extends ScanAcs {
      protected override createStableSplice(): StableSplice {
        return {
          getScanAcs: async () => ({
            createdEvents: [{
              contractId: 'contract-1',
              createdAt: '2026-04-02T20:10:00Z',
              templateId: 'Pkg:Template',
            }],
            endpoint: 'https://scan.example.com',
            nextPageToken: 26,
            snapshot: {
              migrationId: 7,
              recordTime: '2026-04-02T20:10:00Z',
            },
            source: 'scan',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestScanAcs.run([
      '--json',
      '--migration-id',
      '7',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      createdEvents: [expect.objectContaining({contractId: 'contract-1'})],
      nextPageToken: 26,
      snapshot: expect.objectContaining({migrationId: 7}),
      source: 'scan',
    }))
  })

  it('renders scan acs snapshots in human mode', async () => {
    class TestScanAcs extends ScanAcs {
      protected override createStableSplice(): StableSplice {
        return {
          getScanAcs: async () => ({
            createdEvents: [{
              contractId: 'contract-1',
              createdAt: '2026-04-02T20:10:00Z',
              templateId: 'Pkg:Template',
            }],
            endpoint: 'https://scan.example.com',
            nextPageToken: 26,
            snapshot: {
              migrationId: 7,
              recordTime: '2026-04-02T20:10:00Z',
            },
            source: 'scan',
            warnings: ['public-snapshot'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestScanAcs.run(['--migration-id', '7'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Snapshot: migration 7')
    expect(result.stdout).toContain('contract-1')
    expect(result.stdout).toContain('Next page token: 26')
    expect(result.stderr).toContain('public-snapshot')
  })

  it('renders token transfer results in human mode', async () => {
    class TestTokenTransfer extends TokenTransfer {
      protected override createStableSplice(): StableSplice {
        return {
          transferToken: async () => ({
            endpoint: {
              ledger: 'https://ledger.example.com',
              tokenStandard: 'https://tokens.example.com',
            },
            factoryId: 'factory-1',
            transaction: {updateId: 'tx-1'},
            transferKind: 'direct',
            warnings: ['delegated-to-ledger'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestTokenTransfer.run([
      '--amount',
      '10.0',
      '--instrument-admin',
      'Registry',
      '--instrument-id',
      'USD',
      '--receiver',
      'Bob',
      '--sender',
      'Alice',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Transfer kind: direct')
    expect(result.stdout).toContain('Factory: factory-1')
    expect(result.stdout).toContain('Ledger endpoint: https://ledger.example.com')
    expect(result.stderr).toContain('delegated-to-ledger')
  })

  it('emits token transfer results in json mode when explicit endpoints bypass profile resolution', async () => {
    const transferToken = vi.fn(async () => ({
      endpoint: {
        ledger: 'https://ledger.example.com',
        tokenStandard: 'https://tokens.example.com',
      },
      factoryId: 'factory-1',
      transaction: {updateId: 'tx-1'},
      transferKind: 'direct',
      warnings: ['delegated-to-ledger'],
    }))

    class TestTokenTransfer extends TokenTransfer {
      protected override createStableSplice(): StableSplice {
        return {
          transferToken,
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestTokenTransfer.run([
      '--json',
      '--amount',
      '10.0',
      '--instrument-admin',
      'Registry',
      '--instrument-id',
      'USD',
      '--ledger-url',
      'https://ledger.example.com',
      '--receiver',
      'Bob',
      '--sender',
      'Alice',
      '--token',
      'jwt',
      '--token-standard-url',
      'https://tokens.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(transferToken).toHaveBeenCalledWith(expect.objectContaining({
      ledgerBaseUrl: 'https://ledger.example.com',
      profile: undefined,
      sender: 'Alice',
      token: 'jwt',
      tokenStandardBaseUrl: 'https://tokens.example.com',
    }))

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.warnings).toEqual(['delegated-to-ledger'])
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: expect.objectContaining({
        ledger: 'https://ledger.example.com',
        tokenStandard: 'https://tokens.example.com',
      }),
      transferKind: 'direct',
    }))
  })

  it('serializes token transfer failures through the stable surface error handler', async () => {
    class TestTokenTransfer extends TokenTransfer {
      protected override createStableSplice(): StableSplice {
        return {
          transferToken: async () => {
            throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
              suggestion: 'Select a configured profile or supply explicit URLs.',
            })
          },
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestTokenTransfer.run([
      '--json',
      '--amount',
      '10.0',
      '--instrument-admin',
      'Registry',
      '--instrument-id',
      'USD',
      '--receiver',
      'Bob',
      '--sender',
      'Alice',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_NOT_FOUND,
      suggestion: 'Select a configured profile or supply explicit URLs.',
    }))
  })

  it('renders token holdings in human mode', async () => {
    class TestTokenHoldings extends TokenHoldings {
      protected override createStableSplice(): StableSplice {
        return {
          listTokenHoldings: async () => ({
            endpoint: 'https://ledger.example.com',
            holdings: [{
              amount: '5.0000000000',
              contractId: 'holding-1',
              instrumentId: {admin: 'Registry', id: 'USD'},
              owner: 'Alice',
            }],
            interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
            warnings: ['ledger-read-through'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestTokenHoldings.run(['--party', 'Alice'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('holding-1')
    expect(result.stdout).toContain('Registry:USD')
    expect(result.stderr).toContain('ledger-read-through')
  })

  it('emits validator traffic purchase results in json mode', async () => {
    class TestValidatorTrafficBuy extends ValidatorTrafficBuy {
      protected override createStableSplice(): StableSplice {
        return {
          createTrafficBuy: async () => ({
            endpoint: 'https://validator.example.com/api/validator',
            requestContractId: 'request-1',
            source: 'validator-user',
            status: {status: 'created'},
            trackingId: 'traffic-1',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestValidatorTrafficBuy.run([
      '--json',
      '--domain-id',
      'domain::1',
      '--receiving-validator-party-id',
      'AliceValidator',
      '--traffic-amount',
      '4096',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      requestContractId: 'request-1',
      source: 'validator-user',
      trackingId: 'traffic-1',
    }))
  })

  it('renders validator traffic purchases in human mode', async () => {
    class TestValidatorTrafficBuy extends ValidatorTrafficBuy {
      protected override createStableSplice(): StableSplice {
        return {
          createTrafficBuy: async () => ({
            endpoint: 'https://validator.example.com/api/validator',
            requestContractId: 'request-1',
            source: 'validator-user',
            status: {status: 'created'},
            trackingId: 'traffic-1',
            warnings: ['operator-only'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestValidatorTrafficBuy.run([
      '--domain-id',
      'domain::1',
      '--receiving-validator-party-id',
      'AliceValidator',
      '--traffic-amount',
      '4096',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Tracking id: traffic-1')
    expect(result.stdout).toContain('Request contract: request-1')
    expect(result.stderr).toContain('operator-only')
  })

  it('renders validator traffic status in human mode', async () => {
    class TestValidatorTrafficStatus extends ValidatorTrafficStatus {
      protected override createStableSplice(): StableSplice {
        return {
          getTrafficRequestStatus: async () => ({
            endpoint: 'https://validator.example.com/api/validator',
            source: 'validator-user',
            status: {status: 'completed', transaction_id: 'tx-traffic-1'},
            trackingId: 'traffic-1',
            warnings: ['follow-up-check'],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestValidatorTrafficStatus.run([
      '--tracking-id',
      'traffic-1',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Tracking id: traffic-1')
    expect(result.stdout).toContain('"transaction_id": "tx-traffic-1"')
    expect(result.stderr).toContain('follow-up-check')
  })

  it('serializes stable-surface errors through the shared handler', async () => {
    class TestScanCurrentState extends ScanCurrentState {
      protected override createStableSplice(): StableSplice {
        return {
          getScanCurrentState: async () => {
            throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
              suggestion: 'Pick a profile',
            })
          },
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestScanCurrentState.run([
      '--json',
      '--scan-url',
      'https://scan.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: 'Pick a profile',
    }))
  })
})
