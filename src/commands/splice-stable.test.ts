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
  it('exposes ans command metadata', () => {
    expect(AnsCreate.description).toContain('Create an ANS entry')
    expect(AnsCreate.examples).toEqual(expect.arrayContaining([
      expect.stringContaining('ans create'),
    ]))
    expect(AnsCreate.flags).toEqual(expect.objectContaining({
      'ans-url': expect.any(Object),
      description: expect.any(Object),
      json: expect.any(Object),
      name: expect.any(Object),
      profile: expect.any(Object),
      token: expect.any(Object),
      url: expect.any(Object),
    }))

    expect(AnsList.description).toContain('List ANS entries')
    expect(AnsList.examples).toEqual(expect.arrayContaining([
      expect.stringContaining('ans list'),
    ]))
    expect(AnsList.flags).toEqual(expect.objectContaining({
      'ans-url': expect.any(Object),
      json: expect.any(Object),
      name: expect.any(Object),
      'name-prefix': expect.any(Object),
      'page-size': expect.any(Object),
      party: expect.any(Object),
      profile: expect.any(Object),
      'scan-proxy-url': expect.any(Object),
      'scan-url': expect.any(Object),
      source: expect.any(Object),
      token: expect.any(Object),
    }))
  })

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

  it('renders ans create fallback values when explicit endpoints bypass profile resolution', async () => {
    class TestAnsCreate extends AnsCreate {
      protected override createStableSplice(): StableSplice {
        return {
          createAnsEntry: async () => ({
            endpoint: 'https://ans.example.com',
            response: {},
            source: 'ans',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestAnsCreate.run([
      '--ans-url',
      'https://ans.example.com',
      '--description',
      'Alice profile',
      '--name',
      'alice.unverified.ans',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Entry: alice.unverified.ans')
    expect(result.stdout).toContain('Subscription request: -')
    expect(result.stdout).toContain('Entry context: -')
  })

  it('executes ans create through the instance run path', async () => {
    const createAnsEntry = vi.fn().mockResolvedValue({
      endpoint: 'https://ans.example.com',
      response: {
        entryContextCid: 'entry-context-1',
        name: 'alice.unverified.ans',
        subscriptionRequestCid: 'subscription-1',
      },
      source: 'ans',
      warnings: [],
    })

    const command = new AnsCreate([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        'ans-url': undefined,
        description: 'Alice profile',
        json: false,
        name: 'alice.unverified.ans',
        profile: 'splice-devnet',
        token: 'jwt-token',
        url: 'https://alice.example.com',
      },
    } as never)
    vi.spyOn(command as unknown as {createStableSplice: () => StableSplice}, 'createStableSplice')
      .mockReturnValue({createAnsEntry} as unknown as StableSplice)
    vi.spyOn(
      command as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(createConfig().profiles?.['splice-devnet'] as never)

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeUndefined()
    expect(createAnsEntry).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Alice profile',
      name: 'alice.unverified.ans',
      token: 'jwt-token',
      url: 'https://alice.example.com',
    }))
  })

  it('routes ans create failures through the shared command error handler', async () => {
    const failure = new CantonctlError(ErrorCode.CONFIG_NOT_FOUND)
    const handleCommandError = vi.fn()

    const command = new AnsCreate([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        'ans-url': undefined,
        description: 'Alice profile',
        json: false,
        name: 'alice.unverified.ans',
        profile: 'splice-devnet',
        token: undefined,
        url: '',
      },
    } as never)
    vi.spyOn(command as unknown as {createStableSplice: () => StableSplice}, 'createStableSplice')
      .mockReturnValue({
        createAnsEntry: async () => {
          throw failure
        },
      } as unknown as StableSplice)
    vi.spyOn(
      command as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(createConfig().profiles?.['splice-devnet'] as never)
    vi.spyOn(
      command as unknown as {handleCommandError: (error: unknown, out: unknown) => never},
      'handleCommandError',
    ).mockImplementation((error: unknown) => {
      handleCommandError(error)
      throw error as never
    })

    await expect(command.run()).rejects.toBe(failure)
    expect(handleCommandError).toHaveBeenCalledWith(failure)
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

  it('renders ans listing fallbacks when explicit scan endpoints bypass profile resolution', async () => {
    class TestAnsList extends AnsList {
      protected override createStableSplice(): StableSplice {
        return {
          listAnsEntries: async () => ({
            endpoint: 'https://scan.example.com',
            entries: [{}],
            source: 'scan',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestAnsList.run([
      '--scan-url',
      'https://scan.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Source: scan')
    expect(result.stdout).toContain('-')
  })

  it('executes ans list through the instance run path', async () => {
    const listAnsEntries = vi.fn().mockResolvedValue({
      endpoint: 'https://ans.example.com',
      entries: [{
        contractId: 'ans-1',
        name: 'alice.unverified.ans',
        url: 'https://alice.example.com',
        user: 'Alice',
      }],
      source: 'ans',
      warnings: [],
    })

    const command = new AnsList([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        'ans-url': undefined,
        json: false,
        name: undefined,
        'name-prefix': 'alice',
        'page-size': 20,
        party: 'Alice',
        profile: 'splice-devnet',
        'scan-proxy-url': undefined,
        'scan-url': undefined,
        source: 'auto',
        token: 'jwt-token',
      },
    } as never)
    vi.spyOn(command as unknown as {createStableSplice: () => StableSplice}, 'createStableSplice')
      .mockReturnValue({listAnsEntries} as unknown as StableSplice)
    vi.spyOn(
      command as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(createConfig().profiles?.['splice-devnet'] as never)

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeUndefined()
    expect(listAnsEntries).toHaveBeenCalledWith(expect.objectContaining({
      namePrefix: 'alice',
      party: 'Alice',
      source: 'auto',
      token: 'jwt-token',
    }))
  })

  it('routes ans list failures through the shared command error handler', async () => {
    const failure = new CantonctlError(ErrorCode.CONFIG_NOT_FOUND)
    const handleCommandError = vi.fn()

    const command = new AnsList([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        'ans-url': undefined,
        json: false,
        name: undefined,
        'name-prefix': undefined,
        'page-size': 20,
        party: undefined,
        profile: 'splice-devnet',
        'scan-proxy-url': undefined,
        'scan-url': undefined,
        source: 'auto',
        token: undefined,
      },
    } as never)
    vi.spyOn(command as unknown as {createStableSplice: () => StableSplice}, 'createStableSplice')
      .mockReturnValue({
        listAnsEntries: async () => {
          throw failure
        },
      } as unknown as StableSplice)
    vi.spyOn(
      command as unknown as {
        maybeLoadProfileContext: (options: {needsProfile: boolean; profileName?: string}) => Promise<unknown>
      },
      'maybeLoadProfileContext',
    ).mockResolvedValue(createConfig().profiles?.['splice-devnet'] as never)
    vi.spyOn(
      command as unknown as {handleCommandError: (error: unknown, out: unknown) => never},
      'handleCommandError',
    ).mockImplementation((error: unknown) => {
      handleCommandError(error)
      throw error as never
    })

    await expect(command.run()).rejects.toBe(failure)
    expect(handleCommandError).toHaveBeenCalledWith(failure)
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

  it('emits scan current-state summaries when only scan-proxy is explicitly supplied', async () => {
    const getScanCurrentState = vi.fn(async () => ({
      dsoInfo: {dso_party_id: null},
      endpoint: 'https://scan-proxy.example.com',
      issuingMiningRounds: [],
      openMiningRounds: [],
      source: 'scanProxy',
      warnings: [],
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
      '--scan-proxy-url',
      'https://scan-proxy.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(getScanCurrentState).toHaveBeenCalledWith({
      profile: undefined,
      scanBaseUrl: undefined,
      scanProxyBaseUrl: 'https://scan-proxy.example.com',
    })
  })

  it('renders a fallback dso party label when scan current-state omits it', async () => {
    class TestScanCurrentState extends ScanCurrentState {
      protected override createStableSplice(): StableSplice {
        return {
          getScanCurrentState: async () => ({
            dsoInfo: {dso_party_id: null},
            endpoint: 'https://scan.example.com',
            issuingMiningRounds: [],
            openMiningRounds: [],
            source: 'scan',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestScanCurrentState.run([
      '--scan-url',
      'https://scan.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('DSO party: -')
  })

  it('serializes invalid scan acs record-time-match values through the shared handler', async () => {
    const command = new ScanAcs([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {
        after: undefined,
        before: undefined,
        json: true,
        'migration-id': 7,
        'page-size': 25,
        'party-id': undefined,
        profile: undefined,
        'record-time': undefined,
        'record-time-match': 'invalid',
        'scan-url': undefined,
        template: undefined,
      },
    } as never)

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: 'Use --record-time-match exact or --record-time-match at_or_before.',
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

  it('renders scan acs fallback fields when explicit scan endpoints bypass profile resolution', async () => {
    class TestScanAcs extends ScanAcs {
      protected override createStableSplice(): StableSplice {
        return {
          getScanAcs: async () => ({
            createdEvents: [{}],
            endpoint: 'https://scan.example.com',
            snapshot: {},
            source: 'scan',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestScanAcs.run([
      '--migration-id',
      '7',
      '--scan-url',
      'https://scan.example.com',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Snapshot: migration - @ -')
    expect(result.stdout).toContain('-')
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

  it('renders token holding fallbacks when explicit ledger endpoints bypass profile resolution', async () => {
    class TestTokenHoldings extends TokenHoldings {
      protected override createStableSplice(): StableSplice {
        return {
          listTokenHoldings: async () => ({
            endpoint: 'https://ledger.example.com',
            holdings: [{}],
            interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
            warnings: [],
          }),
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestTokenHoldings.run([
      '--ledger-url',
      'https://ledger.example.com',
      '--party',
      'Alice',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('?:?')
    expect(result.stdout).toContain('-')
  })

  it('serializes token holding failures through the shared error handler', async () => {
    class TestTokenHoldings extends TokenHoldings {
      protected override createStableSplice(): StableSplice {
        return {
          listTokenHoldings: async () => {
            throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
              suggestion: 'Select a ledger profile or supply --ledger-url.',
            })
          },
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
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_NOT_FOUND,
        suggestion: 'Select a ledger profile or supply --ledger-url.',
      }),
      success: false,
    }))
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

  it('emits validator traffic purchases in json mode when explicit urls bypass profile resolution', async () => {
    const createTrafficBuy = vi.fn(async () => ({
      endpoint: 'https://validator.example.com/api/validator',
      requestContractId: 'request-1',
      source: 'validator-user',
      status: {status: 'created'},
      trackingId: 'traffic-1',
      warnings: [],
    }))

    class TestValidatorTrafficBuy extends ValidatorTrafficBuy {
      protected override createStableSplice(): StableSplice {
        return {
          createTrafficBuy,
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
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
      '--validator-url',
      'https://validator.example.com/api/validator',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(createTrafficBuy).toHaveBeenCalledWith(expect.objectContaining({
      profile: undefined,
      validatorBaseUrl: 'https://validator.example.com/api/validator',
    }))
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

  it('renders unknown validator traffic status when upstream omits the status field', async () => {
    class TestValidatorTrafficStatus extends ValidatorTrafficStatus {
      protected override createStableSplice(): StableSplice {
        return {
          getTrafficRequestStatus: async () => ({
            endpoint: 'https://validator.example.com/api/validator',
            source: 'validator-user',
            status: {},
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
      '--tracking-id',
      'traffic-1',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Status: unknown')
  })

  it('emits validator traffic status in json mode when explicit urls bypass profile resolution', async () => {
    const getTrafficRequestStatus = vi.fn(async () => ({
      endpoint: 'https://validator.example.com/api/validator',
      source: 'validator-user',
      status: {status: 'completed'},
      trackingId: 'traffic-1',
      warnings: [],
    }))

    class TestValidatorTrafficStatus extends ValidatorTrafficStatus {
      protected override createStableSplice(): StableSplice {
        return {
          getTrafficRequestStatus,
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestValidatorTrafficStatus.run([
      '--json',
      '--tracking-id',
      'traffic-1',
      '--validator-url',
      'https://validator.example.com/api/validator',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(getTrafficRequestStatus).toHaveBeenCalledWith(expect.objectContaining({
      profile: undefined,
      validatorBaseUrl: 'https://validator.example.com/api/validator',
    }))
  })

  it('routes validator traffic errors through the shared command handler', async () => {
    class TestValidatorTrafficBuy extends ValidatorTrafficBuy {
      protected override createStableSplice(): StableSplice {
        return {
          createTrafficBuy: async () => {
            throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
              suggestion: 'Select a validator profile or supply --validator-url.',
            })
          },
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    class TestValidatorTrafficStatus extends ValidatorTrafficStatus {
      protected override createStableSplice(): StableSplice {
        return {
          getTrafficRequestStatus: async () => {
            throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
              suggestion: 'Select a validator profile or supply --validator-url.',
            })
          },
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const buyResult = await captureOutput(() => TestValidatorTrafficBuy.run([
      '--json',
      '--domain-id',
      'domain::1',
      '--receiving-validator-party-id',
      'AliceValidator',
      '--traffic-amount',
      '4096',
    ], {root: CLI_ROOT}))
    expect(buyResult.error).toBeDefined()
    expect(parseJson(buyResult.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_NOT_FOUND,
      }),
      success: false,
    }))

    const statusResult = await captureOutput(() => TestValidatorTrafficStatus.run([
      '--json',
      '--tracking-id',
      'traffic-1',
    ], {root: CLI_ROOT}))
    expect(statusResult.error).toBeDefined()
    expect(parseJson(statusResult.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_NOT_FOUND,
      }),
      success: false,
    }))
  })

  it('renders scan update fallbacks and passes cursor tuples when explicit scan endpoints bypass profile resolution', async () => {
    const listScanUpdates = vi.fn(async () => ({
      endpoint: 'https://scan.example.com',
      source: 'scan',
      updates: [{rootEventCount: 4}, {}],
      warnings: [],
    }))

    class TestScanUpdates extends ScanUpdates {
      protected override createStableSplice(): StableSplice {
        return {
          listScanUpdates,
        } as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('config should not load when explicit endpoints are supplied')
      }
    }

    const result = await captureOutput(() => TestScanUpdates.run([
      '--scan-url',
      'https://scan.example.com',
      '--after-migration-id',
      '7',
      '--after-record-time',
      '2026-04-02T20:00:00Z',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(listScanUpdates).toHaveBeenCalledWith(expect.objectContaining({
      after: {
        migrationId: 7,
        recordTime: '2026-04-02T20:00:00Z',
      },
      profile: undefined,
      scanBaseUrl: 'https://scan.example.com',
    }))
    expect(result.stdout).toContain('unknown')
    expect(result.stdout).toContain('4')
    expect(result.stdout).toContain('-')
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
