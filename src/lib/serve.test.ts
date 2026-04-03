import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

import {afterEach, describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from './config.js'
import type {CompatibilityReport} from './compat.js'
import {
  buildFileTree,
  createServeServer,
  defaultProbeService,
  getLedgerBaseUrl,
  isAuthError,
  parsePort,
  scanDamlTemplates,
  type LedgerClientLike,
  type ServeServer,
  usesLocalLedgerRuntime,
} from './serve.js'
import type {StableSplice} from './splice-public.js'
import {CantonctlError, ErrorCode} from './errors.js'

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
  projectDir: string
  server: ServeServer
}

async function createProjectDir(options: {multiNode?: boolean} = {}): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'serve-test-'))
  await fs.mkdir(path.join(projectDir, 'daml'), {recursive: true})
  await fs.mkdir(path.join(projectDir, '.daml', 'dist'), {recursive: true})
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Serve Test\n', 'utf8')
  await fs.writeFile(path.join(projectDir, 'daml.yaml'), 'name: serve-test\nversion: 1.2.3\n', 'utf8')
  await fs.writeFile(
    path.join(projectDir, 'daml', 'Model.daml'),
    [
      'module Model where',
      '',
      'template Iou',
      '  with',
      '    issuer : Party',
      '    owner : Party',
      '  where',
      '    signatory issuer, owner',
      '',
    ].join('\n'),
    'utf8',
  )
  await fs.writeFile(path.join(projectDir, '.daml', 'dist', 'serve-test.dar'), 'fake-dar', 'utf8')

  if (options.multiNode) {
    await fs.mkdir(path.join(projectDir, '.cantonctl'), {recursive: true})
    await fs.writeFile(path.join(projectDir, '.cantonctl', 'canton.conf'), 'participants = []\n', 'utf8')
    await fs.writeFile(
      path.join(projectDir, '.cantonctl', 'docker-compose.yml'),
      [
        'services:',
        '  canton:',
        '    ports:',
        '      - "10001:10001"',
        '      - "10002:10002"',
        '    healthcheck:',
        '      test: ["CMD-SHELL", "curl -sf http://localhost:7575/v2/version && curl -sf http://localhost:7576/v2/version"]',
        '',
      ].join('\n'),
      'utf8',
    )
  }

  return projectDir
}

async function request(
  port: number,
  reqPath: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${reqPath}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  })
}

async function startServer(options: {multiNode?: boolean} = {}): Promise<TestContext> {
  const config = createConfig()
  const port = await getFreePort()
  const projectDir = await createProjectDir(options)
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
      build: vi.fn(async () => ({
        cached: false,
        darPath: path.join(projectDir, '.daml', 'dist', 'serve-test.dar'),
        durationMs: 1,
        success: true,
      })),
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
    multiNode: options.multiNode ? true : false,
    port,
    projectDir,
  })

  return {createStableSplice, port, projectDir, server}
}

let activeServer: ServeServer | null = null
let activeProjectDir: string | null = null

afterEach(async () => {
  await activeServer?.stop()
  activeServer = null
  if (activeProjectDir) {
    await fs.rm(activeProjectDir, {force: true, recursive: true})
    activeProjectDir = null
  }
})

describe('createServeServer', () => {
  it('builds filtered file trees and scans templates directly', async () => {
    const projectDir = await createProjectDir()
    activeProjectDir = projectDir

    await fs.mkdir(path.join(projectDir, 'node_modules', 'ignored'), {recursive: true})
    await fs.mkdir(path.join(projectDir, '.hidden'), {recursive: true})
    await fs.writeFile(path.join(projectDir, 'node_modules', 'ignored', 'skip.txt'), 'skip', 'utf8')
    await fs.writeFile(path.join(projectDir, '.hidden', 'skip.txt'), 'skip', 'utf8')

    const files = await buildFileTree(projectDir, projectDir)
    const templates = await scanDamlTemplates(projectDir)

    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'README.md', type: 'file'}),
      expect.objectContaining({name: 'daml', type: 'directory'}),
    ]))
    expect(files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({name: '.hidden'}),
      expect.objectContaining({name: 'node_modules'}),
    ]))
    expect(templates).toEqual([
      expect.objectContaining({name: 'Iou'}),
    ])
  })

  it('computes profile ledger URLs, port parsing, and local-runtime heuristics', () => {
    const sandboxProfile = createConfig().profiles!.sandbox
    const remoteProfile = createConfig().profiles!['splice-devnet']

    expect(getLedgerBaseUrl(sandboxProfile, 'http://fallback:7575')).toBe('http://localhost:7575')
    expect(getLedgerBaseUrl(remoteProfile, 'http://fallback:7575')).toBe('https://ledger.example.com')
    expect(parsePort('https://ledger.example.com', 7575)).toBe(443)
    expect(parsePort('not-a-url', 7575)).toBe(7575)
    expect(usesLocalLedgerRuntime(sandboxProfile, false)).toBe(true)
    expect(usesLocalLedgerRuntime({
      ...sandboxProfile,
      kind: 'canton-multi',
      services: {...sandboxProfile.services, ledger: {url: 'https://ledger.example.com'}},
    }, true)).toBe(true)
    expect(usesLocalLedgerRuntime(remoteProfile, false)).toBe(false)
  })

  it('probes services and distinguishes auth failures', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce(new Response('', {status: 401}))
    fetchSpy.mockResolvedValueOnce(new Response('', {status: 503}))
    fetchSpy.mockRejectedValueOnce(new Error('network down'))

    await expect(defaultProbeService({
      endpoint: 'https://service.example.com',
      service: 'validator',
    })).resolves.toEqual({
      detail: 'HTTP 401',
      endpoint: 'https://service.example.com',
      healthy: false,
      status: 'auth-required',
    })
    await expect(defaultProbeService({
      endpoint: 'https://service.example.com',
      service: 'validator',
    })).resolves.toEqual({
      detail: 'HTTP 503',
      endpoint: 'https://service.example.com',
      healthy: false,
      status: 'unreachable',
    })
    await expect(defaultProbeService({
      endpoint: 'https://service.example.com',
      service: 'validator',
    })).resolves.toEqual({
      detail: 'network down',
      endpoint: 'https://service.example.com',
      healthy: false,
      status: 'unreachable',
    })
    expect(isAuthError(new CantonctlError(ErrorCode.LEDGER_AUTH_EXPIRED))).toBe(true)
    expect(isAuthError(new CantonctlError(ErrorCode.SERVICE_AUTH_FAILED))).toBe(true)
    expect(isAuthError(new Error('boom'))).toBe(false)

    fetchSpy.mockRestore()
  })

  it('lists the active profile and supports runtime profile switching', async () => {
    const context = await startServer()
    activeServer = context.server
    activeProjectDir = context.projectDir

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
    activeProjectDir = context.projectDir

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
    activeProjectDir = context.projectDir

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

  it('exposes project files, project metadata, and parsed templates', async () => {
    const context = await startServer()
    activeServer = context.server
    activeProjectDir = context.projectDir

    const project = await requestJson<{
      name: string
      projectDir: string
      version: string
    }>(context.port, '/api/project')
    expect(project).toEqual({
      name: 'serve-test',
      projectDir: context.projectDir,
      version: '1.2.3',
    })

    const files = await requestJson<Array<{children?: Array<{name: string}>; name: string; type: string}>>(
      context.port,
      '/api/files',
    )
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'README.md', type: 'file'}),
      expect.objectContaining({
        name: 'daml',
        type: 'directory',
        children: [expect.objectContaining({name: 'Model.daml'})],
      }),
    ]))

    const readme = await requestJson<{content: string; path: string}>(context.port, '/api/files/README.md')
    expect(readme).toEqual({content: '# Serve Test\n', path: 'README.md'})

    const templates = await requestJson<{templates: Array<{name: string}>}>(context.port, '/api/templates')
    expect(templates.templates).toEqual([expect.objectContaining({name: 'Iou'})])

    const template = await requestJson<{name: string}>(context.port, '/api/templates/Iou')
    expect(template.name).toBe('Iou')
  })

  it('updates files, rebuilds daml sources, and returns 404 for missing assets', async () => {
    const context = await startServer()
    activeServer = context.server
    activeProjectDir = context.projectDir

    const savedReadme = await requestJson<{path: string; saved: boolean}>(context.port, '/api/files/README.md', {
      body: JSON.stringify({content: '# Updated\n'}),
      method: 'PUT',
    })
    expect(savedReadme).toEqual({path: 'README.md', saved: true})

    const savedDaml = await requestJson<{path: string; saved: boolean}>(context.port, '/api/files/daml/Model.daml', {
      body: JSON.stringify({content: 'module Model where\n\ntemplate Loan with lender : Party where signatory lender\n'}),
      method: 'PUT',
    })
    expect(savedDaml).toEqual({path: 'daml/Model.daml', saved: true})

    const missingFile = await request(context.port, '/api/files/missing.txt')
    expect(missingFile.status).toBe(404)

    const missingTemplate = await request(context.port, '/api/templates/Missing')
    expect(missingTemplate.status).toBe(404)
  })

  it('serves health summaries and reports command failures', async () => {
    const context = await startServer()
    activeServer = context.server
    activeProjectDir = context.projectDir

    const health = await requestJson<{
      services: Array<{name: string; status: string}>
      healthy: boolean
      profile: {experimental: boolean; kind: string; name: string}
      version?: string
    }>(context.port, '/api/health')
    expect(health).toEqual(expect.objectContaining({
      healthy: true,
      profile: {experimental: false, kind: 'sandbox', name: 'sandbox'},
      services: [expect.objectContaining({name: 'ledger', status: 'healthy'})],
      version: '3.4.11',
    }))

    const failedProfileSwitch = await request(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'missing'}),
      method: 'PUT',
    })
    expect(failedProfileSwitch.status).toBe(400)

    const badCommand = await request(context.port, '/api/commands', {
      body: JSON.stringify({actAs: [], commands: []}),
      method: 'POST',
    })
    expect(badCommand.status).toBe(200)
  })

  it('supports party, contract, command, build, and test routes', async () => {
    const context = await startServer()
    activeServer = context.server
    activeProjectDir = context.projectDir

    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'splice-devnet'}),
      method: 'PUT',
    })

    const parties = await requestJson<{partyDetails: Array<{party: string}>}>(context.port, '/api/parties')
    expect(parties.partyDetails).toEqual([
      expect.objectContaining({party: 'Alice'}),
    ])

    const allocated = await requestJson<{partyDetails: {party: string}}>(context.port, '/api/parties', {
      body: JSON.stringify({displayName: 'Bob'}),
      method: 'POST',
    })
    expect(allocated.partyDetails).toEqual({party: 'Alice'})

    const contracts = await requestJson<{activeContracts: Array<{contractId: string}>}>(
      context.port,
      '/api/contracts?party=Alice',
    )
    expect(contracts.activeContracts).toEqual([
      expect.objectContaining({contractId: 'remote-contract-1'}),
    ])

    const multiContracts = await requestJson<{contracts: Record<string, Array<{contractId: string}>>}>(
      context.port,
      '/api/contracts/multi?parties=Alice,Bob',
    )
    expect(multiContracts.contracts.Alice).toEqual([
      expect.objectContaining({contractId: 'remote-contract-1'}),
    ])
    expect(multiContracts.contracts.Bob).toEqual([
      expect.objectContaining({contractId: 'remote-contract-1'}),
    ])

    const submitted = await requestJson<{updateId?: string}>(context.port, '/api/commands', {
      body: JSON.stringify({actAs: ['Alice'], commands: []}),
      method: 'POST',
    })
    expect(submitted.updateId).toBe('tx-1')

    const build = await requestJson<{darPath: string}>(context.port, '/api/build', {method: 'POST'})
    expect(build.darPath).toContain('.daml/dist/serve-test.dar')

    const testResult = await requestJson<{passed: boolean}>(context.port, '/api/test', {method: 'POST'})
    expect(testResult.passed).toBe(true)
  })

  it('reports auto-detected multi-node topology status', async () => {
    const context = await startServer({multiNode: true})
    activeServer = context.server
    activeProjectDir = context.projectDir

    const topology = await requestJson<{
      mode: string
      participants: Array<{name: string; port: number}>
      synchronizer: {admin: number; publicApi: number} | null
    }>(context.port, '/api/topology')
    expect(topology.mode).toBe('multi')
    expect(topology.participants).toEqual([
      {name: 'participant1', port: 7575},
      {name: 'participant2', port: 7576},
    ])
    expect(topology.synchronizer).toEqual({admin: 10001, publicApi: 10002})

    const status = await requestJson<{
      participants: Array<{contractCount: number; healthy: boolean; name: string}>
    }>(context.port, '/api/topology/status')
    expect(status.participants).toEqual([
      expect.objectContaining({contractCount: 0, healthy: true, name: 'participant1'}),
      expect.objectContaining({contractCount: 0, healthy: true, name: 'participant2'}),
    ])
  })

  it('validates route inputs and blocks path traversal', async () => {
    const context = await startServer()
    activeServer = context.server
    activeProjectDir = context.projectDir

    const badProfile = await request(context.port, '/api/profile', {
      body: JSON.stringify({name: ''}),
      method: 'PUT',
    })
    expect(badProfile.status).toBe(400)

    const missingHoldingsParty = await request(context.port, '/api/splice/token-holdings')
    expect(missingHoldingsParty.status).toBe(400)

    const partialAfter = await request(context.port, '/api/splice/scan/updates?afterMigrationId=7')
    expect(partialAfter.status).toBe(400)

    const missingContractsParty = await request(context.port, '/api/contracts')
    expect(missingContractsParty.status).toBe(400)

    const missingMultiParties = await request(context.port, '/api/contracts/multi')
    expect(missingMultiParties.status).toBe(400)

    const traversal = await request(context.port, '/api/files/%2E%2E%2Fsecret.txt')
    expect(traversal.status).toBe(403)
  })
})
