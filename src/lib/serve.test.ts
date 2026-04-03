import * as net from 'node:net'

import {afterEach, describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from './config.js'
import type {CompatibilityReport} from './compat.js'
import {createServeServer, type LedgerClientLike, type ServeServer} from './serve.js'
import type {StableSplice} from './splice-public.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
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
    project: {name: 'serve-test', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Expected numeric test port'))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

async function requestJson<T>(
  port: number,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  })

  if (!response.ok) {
    throw new Error(`Unexpected ${response.status}: ${await response.text()}`)
  }

  return response.json() as Promise<T>
}

function createLedgerClientFactory() {
  return vi.fn(({baseUrl, token}: {baseUrl: string; token: string}): LedgerClientLike => ({
    allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
    getActiveContracts: vi.fn(async () => ({
      activeContracts: baseUrl.includes('ledger.example.com')
        ? [{
          contractId: 'remote-contract-1',
          payload: {owner: 'Alice'},
          templateId: 'Remote:Holding',
        }]
        : [],
    })),
    getParties: vi.fn(async () => ({
      partyDetails: baseUrl.includes('ledger.example.com')
        ? [{displayName: 'Alice', identifier: 'Alice::remote', party: 'Alice', isLocal: false}]
        : [{displayName: 'Alice', identifier: 'Alice::sandbox', party: 'Alice', isLocal: true}],
    })),
    getVersion: vi.fn(async () => ({
      tokenUsed: token,
      version: baseUrl.includes('ledger.example.com') ? '3.5.0' : '3.4.11',
    })),
    submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
    uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-1'})),
  }))
}

interface TestContext {
  createStableSplice: ReturnType<typeof vi.fn<() => StableSplice>>
  port: number
  server: ServeServer
}

async function startServer(): Promise<TestContext> {
  const config = createConfig()
  const port = await getFreePort()
  const remoteProfile = config.profiles?.['splice-devnet']
  if (!remoteProfile) {
    throw new Error('Expected splice-devnet profile in test config')
  }

  const createStableSplice = vi.fn<() => StableSplice>(() => ({
    listScanUpdates: vi.fn(async (options) => ({
      endpoint: remoteProfile.services.scan?.url ?? 'https://scan.example.com',
      source: 'scan',
      updates: [{
        kind: 'transaction',
        migrationId: 7,
        recordTime: '2026-04-02T20:00:00Z',
        updateId: 'update-1',
      }],
      warnings: options.profile ? [`scan:${options.profile.name}`] : [],
    })),
    listTokenHoldings: vi.fn(async (options) => ({
      endpoint: remoteProfile.services.ledger?.url ?? 'https://ledger.example.com',
      holdings: [{
        amount: '5.0000000000',
        contractId: 'holding-1',
        owner: options.party,
      }],
      interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
      warnings: options.profile ? [`ledger:${options.profile.name}`] : [],
    })),
  } as unknown as StableSplice))

  const server = createServeServer({
    builder: {
      build: vi.fn(async () => ({cached: true, darPath: null, durationMs: 1, success: true})),
      buildWithCodegen: vi.fn(async () => ({cached: true, darPath: null, durationMs: 1, success: true})),
      watch: vi.fn(),
    },
    createCompatibilityReport: vi.fn((resolvedConfig: CantonctlConfig, profileName?: string) => ({
      checks: [{
        detail: 'stable',
        name: `compat:${profileName ?? resolvedConfig['default-profile']}`,
        status: 'pass' as const,
      }],
      failed: 0,
      passed: 1,
      profile: {
        experimental: false,
        kind: (profileName === 'splice-devnet' ? 'remote-validator' : 'sandbox') as CompatibilityReport['profile']['kind'],
        name: profileName ?? 'sandbox',
      },
      services: [],
      warned: 0,
    })),
    createLedgerClient: createLedgerClientFactory(),
    createStableSplice,
    createToken: vi.fn(async () => 'sandbox-token'),
    loadProjectConfig: vi.fn(async () => config),
    output: {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      result: vi.fn(),
      spinner: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    },
    resolveProfileToken: vi.fn(async ({profileName}) => profileName === 'splice-devnet' ? 'remote-token' : 'sandbox-token'),
    testRunner: {
      run: vi.fn(async () => ({durationMs: 1, output: 'ok', passed: true, success: true})),
    },
    probeService: vi.fn(async ({endpoint, service}) => ({
      detail: endpoint,
      endpoint,
      healthy: service !== 'validator',
      status: service === 'validator' ? 'unreachable' as const : 'healthy' as const,
    })),
  })

  await server.start({
    ledgerUrl: 'http://localhost:7575',
    multiNode: false,
    port,
    projectDir: '/tmp/serve-test',
  })

  return {createStableSplice, port, server}
}

let activeServer: ServeServer | null = null

afterEach(async () => {
  await activeServer?.stop()
  activeServer = null
})

describe('createServeServer', () => {
  it('lists the active profile and supports runtime profile switching', async () => {
    const context = await startServer()
    activeServer = context.server

    const initial = await requestJson<{
      profiles: Array<{isDefault: boolean; kind: string; name: string; services: string[]}>
      selectedProfile: {kind: string; name: string}
      source: string
    }>(context.port, '/api/profile')

    expect(initial.selectedProfile).toEqual(expect.objectContaining({kind: 'sandbox', name: 'sandbox'}))
    expect(initial.source).toBe('default-profile')
    expect(initial.profiles).toEqual([
      expect.objectContaining({isDefault: true, kind: 'sandbox', name: 'sandbox', services: ['ledger']}),
      expect.objectContaining({
        isDefault: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: ['ans', 'ledger', 'scan', 'tokenStandard', 'validator'],
      }),
    ])

    const updated = await requestJson<{
      selectedProfile: {kind: string; name: string}
      source: string
    }>(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'splice-devnet'}),
      method: 'PUT',
    })

    expect(updated.selectedProfile).toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    expect(updated.source).toBe('argument')
  })

  it('returns profile service health and compatibility summaries for the active profile', async () => {
    const context = await startServer()
    activeServer = context.server

    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'splice-devnet'}),
      method: 'PUT',
    })

    const status = await requestJson<{
      healthy: boolean
      profile: {kind: string; name: string}
      services: Array<{endpoint?: string; healthy: boolean; name: string; status: string; version?: string}>
    }>(context.port, '/api/profile/status')

    expect(status.profile).toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    expect(status.healthy).toBe(false)
    expect(status.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        endpoint: 'https://ledger.example.com',
        healthy: true,
        name: 'ledger',
        status: 'healthy',
        version: '3.5.0',
      }),
      expect.objectContaining({
        endpoint: 'https://scan.example.com',
        healthy: true,
        name: 'scan',
        status: 'healthy',
      }),
      expect.objectContaining({
        endpoint: 'https://validator.example.com/api/validator',
        healthy: false,
        name: 'validator',
        status: 'unreachable',
      }),
    ]))

    const compat = await requestJson<{
      checks: Array<{name: string; status: string}>
      profile: {kind: string; name: string}
    }>(context.port, '/api/profile/compat')

    expect(compat.profile).toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    expect(compat.checks).toEqual([
      expect.objectContaining({name: 'compat:splice-devnet', status: 'pass'}),
    ])
  })

  it('routes stable Splice reads through the active profile', async () => {
    const context = await startServer()
    activeServer = context.server

    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'splice-devnet'}),
      method: 'PUT',
    })

    const holdings = await requestJson<{
      holdings: Array<{amount: string; contractId: string; owner: string}>
      warnings: string[]
    }>(context.port, '/api/splice/token-holdings?party=Alice')
    expect(holdings.holdings).toEqual([
      expect.objectContaining({amount: '5.0000000000', contractId: 'holding-1', owner: 'Alice'}),
    ])
    expect(holdings.warnings).toEqual(['ledger:splice-devnet'])

    const updates = await requestJson<{
      updates: Array<{kind: string; migrationId: number; recordTime: string; updateId: string}>
      warnings: string[]
    }>(context.port, '/api/splice/scan/updates?pageSize=5')
    expect(updates.updates).toEqual([
      expect.objectContaining({
        kind: 'transaction',
        migrationId: 7,
        recordTime: '2026-04-02T20:00:00Z',
        updateId: 'update-1',
      }),
    ])
    expect(updates.warnings).toEqual(['scan:splice-devnet'])

    expect(context.createStableSplice).toHaveBeenCalled()
  })
})
