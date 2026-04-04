import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {WebSocket} from 'ws'

import {afterEach, describe, expect, it, vi} from 'vitest'

import * as configModule from './config.js'
import * as credentialStoreModule from './credential-store.js'
import * as keytarBackendModule from './keytar-backend.js'
import * as splicePublicModule from './splice-public.js'
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
  type ServeServerDeps,
  usesLocalLedgerRuntime,
} from './serve.js'
import type {StableSplice} from './splice-public.js'
import {CantonctlError, ErrorCode} from './errors.js'
import {generateTopology, serializeTopologyManifest} from './topology.js'

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
  createLedgerClient: ReturnType<typeof vi.fn>
  createStableSplice: ReturnType<typeof vi.fn<() => StableSplice>>
  deps: Partial<ServeServerDeps>
  port: number
  projectDir: string
  server: ServeServer
}

interface StartServerOptions {
  config?: CantonctlConfig
  deps?: Partial<ServeServerDeps>
  multiNode?: boolean
  omitDeps?: Array<keyof ServeServerDeps>
  projectDirSetup?: (projectDir: string) => Promise<void>
  start?: Partial<Parameters<ServeServer['start']>[0]>
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
    const topology = generateTopology({
      cantonImage: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
      config: createConfig(),
      projectName: 'serve-test',
    })
    await fs.mkdir(path.join(projectDir, '.cantonctl'), {recursive: true})
    await fs.writeFile(path.join(projectDir, '.cantonctl', 'canton.conf'), topology.cantonConf, 'utf8')
    await fs.writeFile(path.join(projectDir, '.cantonctl', 'docker-compose.yml'), topology.dockerCompose, 'utf8')
    await fs.writeFile(path.join(projectDir, '.cantonctl', 'topology.json'), serializeTopologyManifest(topology), 'utf8')
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

async function startServer(options: StartServerOptions = {}): Promise<TestContext> {
  const config = options.config ?? createConfig()
  const port = options.start?.port ?? await getFreePort()
  const projectDir = options.start?.projectDir ?? await createProjectDir({multiNode: options.multiNode})
  await options.projectDirSetup?.(projectDir)
  const remoteProfile = config.profiles?.['splice-devnet']

  const createStableSplice = vi.fn<() => StableSplice>(() => ({
    listScanUpdates: vi.fn(async (options) => ({
      endpoint: remoteProfile?.services.scan?.url ?? 'https://scan.example.com',
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
      endpoint: remoteProfile?.services.ledger?.url ?? 'https://ledger.example.com',
      holdings: [{
        amount: '5.0000000000',
        contractId: 'holding-1',
        owner: options.party,
      }],
      interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
      warnings: options.profile ? [`ledger:${options.profile.name}`] : [],
    })),
  } as unknown as StableSplice))

  const createLedgerClient = createLedgerClientFactory()
  const deps: Partial<ServeServerDeps> = {
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
    createLedgerClient,
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
    ...options.deps,
  }
  for (const key of options.omitDeps ?? []) {
    delete deps[key]
  }

  const server = createServeServer(deps as ServeServerDeps)

  await server.start({
    ledgerUrl: 'http://localhost:7575',
    multiNode: options.multiNode ? true : false,
    port,
    projectDir,
    ...options.start,
  })

  return {createLedgerClient, createStableSplice, deps, port, projectDir, server}
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
  vi.restoreAllMocks()
})

describe('createServeServer', () => {
  it('covers helper fallbacks, non-daml scans, and healthy service probes', async () => {
    const projectDir = await createProjectDir()
    activeProjectDir = projectDir
    await fs.writeFile(path.join(projectDir, 'daml', 'Notes.txt'), 'skip', 'utf8')

    const sandboxProfile = createConfig().profiles!.sandbox

    expect(await scanDamlTemplates('/definitely/missing')).toEqual([])
    expect(await scanDamlTemplates(projectDir)).toEqual([
      expect.objectContaining({name: 'Iou'}),
    ])
    expect(getLedgerBaseUrl({
      ...sandboxProfile,
      services: {},
    } as any, 'http://fallback:7575')).toBe('http://fallback:7575')
    expect(getLedgerBaseUrl({
      ...sandboxProfile,
      services: {ledger: {}},
    } as any, 'http://fallback:7575')).toBe('http://localhost:7575')
    expect(parsePort('http://ledger.example.com', 7575)).toBe(80)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', {status: 200}))
    await expect(defaultProbeService({
      endpoint: 'https://service.example.com',
      service: 'scan',
    })).resolves.toEqual({
      detail: 'https://service.example.com',
      endpoint: 'https://service.example.com',
      healthy: true,
      status: 'healthy',
    })
    expect(fetchSpy).toHaveBeenCalledWith('https://service.example.com', {method: 'GET'})
  })

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

  it('covers single-node topology, project metadata fallbacks, and file-root middleware handoff', async () => {
    const context = await startServer({
      projectDirSetup: async (projectDir) => {
        await fs.writeFile(path.join(projectDir, 'daml.yaml'), 'sdk-version: 3.4.11\n', 'utf8')
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const topology = await requestJson<{
      mode: string
      participants: Array<{name: string; port: number}>
      selection: null
      synchronizer: null
      topology: null
    }>(context.port, '/api/topology')
    const project = await requestJson<{
      name: string
      projectDir: string
      version: string
    }>(context.port, '/api/project')
    const rootPost = await request(context.port, '/api/files/', {
      body: JSON.stringify({content: 'ignored'}),
      method: 'POST',
    })

    expect(topology).toEqual({
      mode: 'single',
      participants: [{name: 'sandbox', port: 7575}],
      selection: null,
      synchronizer: null,
      topology: null,
    })
    expect(project).toEqual({
      name: 'unknown',
      projectDir: context.projectDir,
      version: '0.0.0',
    })
    expect(rootPost.status).toBe(404)
  })

  it('switches profiles using the name field and falls back to configured service endpoints', async () => {
    const context = await startServer({
      deps: {
        probeService: vi.fn(async ({service}) => ({
          detail: `probe:${service}`,
          endpoint: undefined,
          healthy: true,
          status: 'healthy' as const,
        })),
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const updated = await requestJson<{
      selectedProfile: {kind: string; name: string}
      source: string
    }>(context.port, '/api/profile', {
      body: JSON.stringify({name: 'splice-devnet'}),
      method: 'PUT',
    })
    const status = await requestJson<{
      services: Array<{detail?: string; endpoint?: string; name: string}>
    }>(context.port, '/api/profile/status')

    expect(updated.selectedProfile).toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    expect(updated.source).toBe('argument')
    expect(status.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'probe:scan',
        endpoint: 'https://scan.example.com',
        name: 'scan',
      }),
      expect.objectContaining({
        detail: 'probe:validator',
        endpoint: 'https://validator.example.com/api/validator',
        name: 'validator',
      }),
    ]))
  })

  it('reports auto-detected multi-node topology status', async () => {
    const context = await startServer({multiNode: true})
    activeServer = context.server
    activeProjectDir = context.projectDir

    const topology = await requestJson<{
      mode: string
      participants: Array<{name: string; port: number}>
      selection: {
        'base-port': number
        'canton-image': string
        selectedBy: string
        topologyName: string
      } | null
      synchronizer: {admin: number; publicApi: number} | null
    }>(context.port, '/api/topology')
    expect(topology.mode).toBe('net')
    expect(topology.participants).toEqual([
      {name: 'participant1', port: 10013},
      {name: 'participant2', port: 10023},
    ])
    expect(topology.selection).toEqual({
      'base-port': 10000,
      'canton-image': 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
      selectedBy: 'default',
      topologyName: 'default',
    })
    expect(topology.synchronizer).toEqual({admin: 10001, publicApi: 10002})

    const status = await requestJson<{
      participants: Array<{contractCount: number; healthy: boolean; name: string}>
    }>(context.port, '/api/topology/status')
    expect(status.participants).toEqual([
      expect.objectContaining({contractCount: 0, healthy: true, name: 'participant1'}),
      expect.objectContaining({contractCount: 0, healthy: true, name: 'participant2'}),
    ])
  })

  it('counts topology contracts using identifier fallbacks when party ids are absent', async () => {
    const participant1: LedgerClientLike = {
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
      getActiveContracts: vi.fn(async ({filter}) => ({
        activeContracts: filter.party === 'Alice::identifier'
          ? [{contractId: 'identifier-contract'}]
          : [],
      })),
      getParties: vi.fn(async () => ({
        partyDetails: [{identifier: 'Alice::identifier'}],
      })),
      getVersion: vi.fn(async () => ({version: '3.4.11'})),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
      uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-1'})),
    }
    const participant2: LedgerClientLike = {
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Bob'}})),
      getActiveContracts: vi.fn(async () => ({activeContracts: []})),
      getParties: vi.fn(async () => ({partyDetails: []})),
      getVersion: vi.fn(async () => ({version: '3.4.11'})),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-2'}})),
      uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-2'})),
    }
    let clientCall = 0

    const context = await startServer({
      deps: {
        createLedgerClient: vi.fn(() => {
          clientCall++
          return clientCall === 1 ? participant1 : participant2
        }),
      },
      multiNode: true,
      start: {multiNode: true},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const status = await requestJson<{
      participants: Array<{contractCount: number; name: string}>
    }>(context.port, '/api/topology/status')

    expect(status.participants).toEqual([
      expect.objectContaining({contractCount: 1, name: 'participant1'}),
      expect.objectContaining({contractCount: 0, name: 'participant2'}),
    ])
  })

  it('validates route inputs and blocks path traversal', async () => {
    const context = await startServer()
    activeServer = context.server
    activeProjectDir = context.projectDir
    const siblingDir = `${context.projectDir}-sibling`
    await fs.mkdir(siblingDir, {recursive: true})
    await fs.writeFile(path.join(siblingDir, 'secret.txt'), 'secret', 'utf8')

    const badProfile = await request(context.port, '/api/profile', {
      body: JSON.stringify({name: ''}),
      method: 'PUT',
    })
    expect(badProfile.status).toBe(400)

    const missingHoldingsParty = await request(context.port, '/api/splice/token-holdings')
    expect(missingHoldingsParty.status).toBe(400)

    const partialAfter = await request(context.port, '/api/splice/scan/updates?afterMigrationId=7')
    expect(partialAfter.status).toBe(400)

    const invalidAfterMigrationId = await request(
      context.port,
      '/api/splice/scan/updates?afterMigrationId=abc&afterRecordTime=2026-04-02T20:00:00Z',
    )
    expect(invalidAfterMigrationId.status).toBe(400)

    const missingContractsParty = await request(context.port, '/api/contracts')
    expect(missingContractsParty.status).toBe(400)

    const missingMultiParties = await request(context.port, '/api/contracts/multi')
    expect(missingMultiParties.status).toBe(400)

    const traversal = await request(context.port, '/api/files/%2E%2E%2Fsecret.txt')
    expect(traversal.status).toBe(403)

    const siblingTraversal = await request(
      context.port,
      `/api/files/${encodeURIComponent(`../${path.basename(siblingDir)}/secret.txt`)}`,
    )
    expect(siblingTraversal.status).toBe(403)

    const siblingOverwrite = await request(
      context.port,
      `/api/files/${encodeURIComponent(`../${path.basename(siblingDir)}/secret.txt`)}`,
      {
        body: JSON.stringify({content: 'pwned'}),
        headers: {'content-type': 'application/json'},
        method: 'PUT',
      },
    )
    expect(siblingOverwrite.status).toBe(403)
  })

  it('falls back on empty profile payloads and invalid scan page sizes', async () => {
    const stableSplice = {
      listScanUpdates: vi.fn(async (options) => ({
        source: 'scan',
        updates: [],
        warnings: [String(options.pageSize)],
      })),
      listTokenHoldings: vi.fn(async () => ({
        holdings: [],
        interfaceId: 'iface',
        warnings: [],
      })),
    }
    const context = await startServer({
      deps: {
        createStableSplice: vi.fn(() => stableSplice as never),
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const badProfile = await request(context.port, '/api/profile', {
      body: JSON.stringify({}),
      method: 'PUT',
    })
    const updates = await requestJson<{warnings: string[]}>(context.port, '/api/splice/scan/updates?pageSize=bad')
    const defaultUpdates = await requestJson<{warnings: string[]}>(context.port, '/api/splice/scan/updates')

    expect(badProfile.status).toBe(400)
    expect(updates.warnings).toEqual(['20'])
    expect(defaultUpdates.warnings).toEqual(['20'])
  })

  it('warns on initial build failures, serves static assets, and still starts the server', async () => {
    const port = await getFreePort()
    const projectDir = await createProjectDir()
    const staticDir = path.join(projectDir, 'playground-dist')
    await fs.mkdir(staticDir, {recursive: true})
    await fs.writeFile(path.join(staticDir, 'index.html'), '<html><body>Playground</body></html>', 'utf8')

    const output = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      result: vi.fn(),
      spinner: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }

    const server = createServeServer({
      builder: {
        build: vi.fn().mockRejectedValue(new Error('startup build failed')),
        buildWithCodegen: vi.fn(async () => ({cached: true, darPath: null, durationMs: 1, success: true})),
        watch: vi.fn(),
      },
      createLedgerClient: createLedgerClientFactory(),
      createStableSplice: vi.fn(() => ({
        listScanUpdates: vi.fn(async () => ({source: 'scan', updates: [], warnings: []})),
        listTokenHoldings: vi.fn(async () => ({holdings: [], interfaceId: 'iface', warnings: []})),
      }) as unknown as StableSplice),
      createToken: vi.fn(async () => 'sandbox-token'),
      loadProjectConfig: vi.fn(async () => createConfig()),
      output,
      probeService: vi.fn(async ({endpoint}) => ({
        detail: endpoint,
        endpoint,
        healthy: true,
        status: 'healthy' as const,
      })),
      resolveProfileToken: vi.fn(async () => 'sandbox-token'),
      testRunner: {
        run: vi.fn(async () => ({durationMs: 1, output: 'ok', passed: true, success: true})),
      },
    })

    activeServer = server
    activeProjectDir = projectDir
    await server.start({
      ledgerUrl: 'http://localhost:7575',
      multiNode: false,
      port,
      projectDir,
      staticDir,
    })

    const index = await request(port, '/')
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('Playground')
    expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('Initial build failed'))
  })

  it('stops cleanly before the server is started', async () => {
    const server = createServeServer({
      builder: {
        build: vi.fn(),
        buildWithCodegen: vi.fn(),
        watch: vi.fn(),
      },
      createLedgerClient: createLedgerClientFactory(),
      createStableSplice: vi.fn(() => ({
        listScanUpdates: vi.fn(),
        listTokenHoldings: vi.fn(),
      }) as unknown as StableSplice),
      createToken: vi.fn(async () => 'sandbox-token'),
      loadProjectConfig: vi.fn(async () => createConfig()),
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
      testRunner: {run: vi.fn()},
    })

    await expect(server.stop()).resolves.toBeUndefined()
  })

  it('uses default dependency resolvers for tokens, project config, probes, and stable splice factories', async () => {
    const config: CantonctlConfig = {
      'default-profile': 'shared',
      networkProfiles: {devnet: 'oidc'},
      profiles: {
        shared: {
          experimental: false,
          kind: 'remote-validator',
          name: 'shared',
          services: {
            auth: {kind: 'shared-secret'},
            ledger: {url: 'https://shared.example.com'},
            validator: {} as never,
          },
        },
        none: {
          experimental: false,
          kind: 'remote-validator',
          name: 'none',
          services: {
            auth: {kind: 'none'},
            ledger: {url: 'https://none.example.com'},
          },
        },
        multi: {
          experimental: false,
          kind: 'canton-multi',
          name: 'multi',
          services: {
            ledger: {url: 'https://multi.example.com'},
          },
        },
        localnet: {
          experimental: true,
          kind: 'splice-localnet',
          name: 'localnet',
          services: {
            ledger: {url: 'https://localnet.example.com'},
            localnet: {distribution: 'splice-localnet', version: '0.5.x'},
          },
        },
        oidc: {
          experimental: false,
          kind: 'remote-validator',
          name: 'oidc',
          services: {
            auth: {issuer: 'https://login.example.com', kind: 'oidc'},
            ledger: {url: 'https://oidc.example.com'},
            ans: {url: 'https://ans.example.com'},
          },
        },
        missing: {
          experimental: false,
          kind: 'remote-validator',
          name: 'missing',
          services: {
            auth: {issuer: 'https://login.example.com', kind: 'oidc'},
            ledger: {url: 'https://missing.example.com'},
          },
        },
      },
      project: {name: 'serve-test', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const resolve = vi.fn(async (networkName: string) => networkName === 'devnet' ? 'stored-token' : undefined)
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)
    vi.spyOn(keytarBackendModule, 'createBackendWithFallback').mockResolvedValue({
      backend: {} as never,
      isKeychain: false,
    })
    vi.spyOn(credentialStoreModule, 'createCredentialStore').mockReturnValue({
      list: vi.fn(),
      remove: vi.fn(),
      resolve,
      resolveRecord: vi.fn(),
      retrieve: vi.fn(),
      retrieveRecord: vi.fn(),
      store: vi.fn(),
    } as never)
    const createStableSpliceSpy = vi.spyOn(splicePublicModule, 'createStableSplice').mockReturnValue({
      listScanUpdates: vi.fn(async () => ({source: 'scan', updates: [], warnings: []})),
      listTokenHoldings: vi.fn(async () => ({holdings: [], interfaceId: 'iface', warnings: []})),
    } as never)
    const realFetch = globalThis.fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
        return realFetch(input as never, init)
      }

      return new Response('', {status: 200})
    })

    const createLedgerClient = vi.fn(({baseUrl, token}: {baseUrl: string; token: string}): LedgerClientLike => ({
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
      getActiveContracts: vi.fn(async () => ({activeContracts: []})),
      getParties: vi.fn(async () => ({partyDetails: []})),
      getVersion: vi.fn(async () => ({tokenUsed: token, version: '3.4.11'})),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
      uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-1'})),
    }))

    const context = await startServer({
      deps: {
        createLedgerClient,
        createToken: vi.fn(async () => 'sandbox-token'),
      },
      omitDeps: ['createStableSplice', 'loadProjectConfig', 'probeService', 'resolveProfileToken'],
      start: {
        profileName: 'shared',
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    await requestJson(context.port, '/api/profile/status')
    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'none'}),
      method: 'PUT',
    })
    await requestJson(context.port, '/api/profile/status')
    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'multi'}),
      method: 'PUT',
    })
    await requestJson(context.port, '/api/profile/status')
    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'localnet'}),
      method: 'PUT',
    })
    const localnetStatus = await requestJson<{
      services: Array<{name: string; status: string}>
    }>(context.port, '/api/service-health')
    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'oidc'}),
      method: 'PUT',
    })
    await requestJson(context.port, '/api/profile/status')
    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'missing'}),
      method: 'PUT',
    })
    await requestJson(context.port, '/api/profile/status')

    expect(createStableSpliceSpy).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('devnet')
    expect(resolve).toHaveBeenCalledWith('missing')
    expect(fetchSpy).toHaveBeenCalledWith('https://ans.example.com', {method: 'GET'})
    expect(localnetStatus.services).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'localnet', status: 'configured'}),
    ]))
    expect(createLedgerClient.mock.calls).toEqual(expect.arrayContaining([
      [expect.objectContaining({baseUrl: 'https://shared.example.com', token: 'sandbox-token'})],
      [expect.objectContaining({baseUrl: 'https://none.example.com', token: 'sandbox-token'})],
      [expect.objectContaining({baseUrl: 'https://multi.example.com', token: 'sandbox-token'})],
      [expect.objectContaining({baseUrl: 'https://localnet.example.com', token: 'sandbox-token'})],
      [expect.objectContaining({baseUrl: 'https://oidc.example.com', token: 'stored-token'})],
      [expect.objectContaining({baseUrl: 'https://missing.example.com', token: ''})],
    ]))
  })

  it('falls back to an empty startup token when a remote profile has no stored credential', async () => {
    const createLedgerClient = vi.fn(({baseUrl, token}: {baseUrl: string; token: string}): LedgerClientLike => ({
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
      getActiveContracts: vi.fn(async () => ({activeContracts: []})),
      getParties: vi.fn(async () => ({partyDetails: []})),
      getVersion: vi.fn(async () => ({tokenUsed: token, version: '3.4.11'})),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
      uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-1'})),
    }))

    const context = await startServer({
      deps: {
        createLedgerClient,
        resolveProfileToken: vi.fn(async () => undefined),
      },
      start: {profileName: 'splice-devnet'},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const health = await requestJson<{healthy: boolean}>(context.port, '/api/health')

    expect(health.healthy).toBe(true)
    expect(createLedgerClient).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://ledger.example.com',
      token: '',
    }))
  })

  it('uses the profile name for credential lookup when no network mapping exists', async () => {
    const config: CantonctlConfig = {
      'default-profile': 'oidc',
      profiles: {
        oidc: {
          experimental: false,
          kind: 'remote-validator',
          name: 'oidc',
          services: {
            auth: {issuer: 'https://login.example.com', kind: 'oidc'},
            ledger: {url: 'https://oidc.example.com'},
          },
        },
      },
      project: {name: 'serve-test', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const resolve = vi.fn(async () => undefined)
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)
    vi.spyOn(keytarBackendModule, 'createBackendWithFallback').mockResolvedValue({
      backend: {} as never,
      isKeychain: false,
    })
    vi.spyOn(credentialStoreModule, 'createCredentialStore').mockReturnValue({
      list: vi.fn(),
      remove: vi.fn(),
      resolve,
      resolveRecord: vi.fn(),
      retrieve: vi.fn(),
      retrieveRecord: vi.fn(),
      store: vi.fn(),
    } as never)

    const context = await startServer({
      deps: {
        createLedgerClient: createLedgerClientFactory(),
      },
      omitDeps: ['loadProjectConfig', 'resolveProfileToken'],
      start: {profileName: 'oidc'},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    await requestJson(context.port, '/api/profile/status')
    expect(resolve).toHaveBeenCalledWith('oidc')
  })

  it('reports null profile status when no runtime profiles are configured', async () => {
    const config: CantonctlConfig = {
      project: {name: 'serve-test', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const context = await startServer({config})
    activeServer = context.server
    activeProjectDir = context.projectDir

    const profile = await requestJson<{
      profiles: unknown[]
      selectedProfile: null
      source: null
    }>(context.port, '/api/profile')
    const status = await requestJson<{
      healthy: boolean
      profile: null
      services: unknown[]
    }>(context.port, '/api/profile/status')
    const serviceHealth = await requestJson<{
      healthy: boolean
      profile: null
      services: unknown[]
    }>(context.port, '/api/service-health')
    const health = await requestJson<{
      healthy: boolean
      profile: null
      version?: string
    }>(context.port, '/api/health')
    const compat = await request(context.port, '/api/profile/compat')

    expect(profile).toEqual({profiles: [], selectedProfile: null, source: null})
    expect(status).toEqual({healthy: false, profile: null, services: []})
    expect(serviceHealth).toEqual({healthy: false, profile: null, services: []})
    expect(health).toEqual({healthy: false, profile: null, services: [], version: undefined})
    expect(compat.status).toBe(404)
  })

  it('reports null profile summaries when the selected profile disappears after startup', async () => {
    const config = createConfig()
    const context = await startServer({config})
    activeServer = context.server
    activeProjectDir = context.projectDir

    delete config.profiles!.sandbox

    const profile = await requestJson<{
      profiles: Array<{name: string}>
      selectedProfile: null
      source: string | null
    }>(context.port, '/api/profile')
    const status = await requestJson<{
      healthy: boolean
      profile: null
      services: unknown[]
    }>(context.port, '/api/profile/status')

    expect(profile.selectedProfile).toBeNull()
    expect(profile.source).toBe('default-profile')
    expect(status).toEqual({healthy: false, profile: null, services: []})
  })

  it('reports auth-required and unconfigured services for degraded profiles', async () => {
    const config: CantonctlConfig = {
      'default-profile': 'problem',
      profiles: {
        problem: {
          experimental: false,
          kind: 'remote-validator',
          name: 'problem',
          services: {
            auth: {issuer: 'https://login.example.com', kind: 'oidc'},
            ledger: {url: 'https://problem.example.com'},
            validator: {} as never,
          },
        },
      },
      project: {name: 'serve-test', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const context = await startServer({
      config,
      deps: {
        createLedgerClient: vi.fn(({baseUrl}: {baseUrl: string}) => ({
          allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
          getActiveContracts: vi.fn(async () => ({activeContracts: []})),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => {
            if (baseUrl === 'https://problem.example.com') {
              throw new CantonctlError(ErrorCode.LEDGER_AUTH_EXPIRED)
            }

            return {version: '3.4.11'}
          }),
          submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
          uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-1'})),
        })),
      },
      start: {profileName: 'problem'},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const status = await requestJson<{
      healthy: boolean
      services: Array<{name: string; status: string}>
    }>(context.port, '/api/profile/status')
    const serviceHealth = await requestJson<{
      healthy: boolean
      services: Array<{name: string; status: string}>
    }>(context.port, '/api/service-health')

    expect(status.healthy).toBe(false)
    expect(status.services).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'auth', status: 'configured'}),
      expect.objectContaining({name: 'ledger', status: 'auth-required'}),
      expect.objectContaining({name: 'validator', status: 'unconfigured'}),
    ]))
    expect(serviceHealth.services).toEqual(status.services)
  })

  it('normalizes non-string ledger versions and generic ledger failures', async () => {
    const config: CantonctlConfig = {
      'default-profile': 'versionless',
      profiles: {
        versionless: {
          experimental: false,
          kind: 'remote-validator',
          name: 'versionless',
          services: {
            ledger: {url: 'https://versionless.example.com'},
            validator: {} as never,
          },
        },
        unreachable: {
          experimental: false,
          kind: 'remote-validator',
          name: 'unreachable',
          services: {
            ledger: {url: 'https://unreachable.example.com'},
            validator: {} as never,
          },
        },
      },
      project: {name: 'serve-test', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const context = await startServer({
      config,
      deps: {
        createLedgerClient: vi.fn(({baseUrl}: {baseUrl: string}) => ({
          allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
          getActiveContracts: vi.fn(async () => ({activeContracts: []})),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => {
            if (baseUrl === 'https://versionless.example.com') {
              return {version: 123 as unknown as string}
            }

            throw new Error('ledger down')
          }),
          submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
          uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-1'})),
        })),
      },
      start: {profileName: 'versionless'},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const versionlessStatus = await requestJson<{
      services: Array<{name: string; status: string; version?: string}>
    }>(context.port, '/api/profile/status')
    await requestJson(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'unreachable'}),
      method: 'PUT',
    })
    const unreachableStatus = await requestJson<{
      services: Array<{error?: string; name: string; status: string}>
    }>(context.port, '/api/profile/status')

    expect(versionlessStatus.services).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'ledger', status: 'healthy'}),
    ]))
    expect(versionlessStatus.services.find(service => service.name === 'ledger')).not.toHaveProperty('version')
    expect(unreachableStatus.services).toEqual(expect.arrayContaining([
      expect.objectContaining({error: 'ledger down', name: 'ledger', status: 'unreachable'}),
    ]))
  })

  it('covers multi-node routing fallbacks and degraded participant status', async () => {
    let failBobContracts = false
    const participant1: LedgerClientLike = {
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
      getActiveContracts: vi.fn(async ({filter}) => {
        if (filter.party === 'Bob' && failBobContracts) throw new Error('bob missing')
        return {
          activeContracts: [{contractId: `${filter.party}-contract`}],
        }
      }),
      getParties: vi.fn(async () => ({
        partyDetails: [
          {identifier: '', isLocal: true},
          {party: 'Alice', isLocal: true},
        ],
      })),
      getVersion: vi.fn(async () => ({version: '3.4.11'})),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
      uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-1'})),
    }
    const participant2: LedgerClientLike = {
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Bob'}})),
      getActiveContracts: vi.fn(async () => ({activeContracts: []})),
      getParties: vi.fn(async () => { throw new Error('participant2 unavailable') }),
      getVersion: vi.fn(async () => { throw new Error('unhealthy') }),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-2'}})),
      uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-2'})),
    }
    let clientCall = 0

    const context = await startServer({
      deps: {
        createLedgerClient: vi.fn(() => {
          clientCall++
          return clientCall === 1 ? participant1 : participant2
        }),
      },
      multiNode: true,
      start: {multiNode: true},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const topologyStatus = await requestJson<{
      participants: Array<{contractCount: number; healthy: boolean; name: string}>
    }>(context.port, '/api/topology/status')
    const filteredContracts = await requestJson<{activeContracts: Array<{contractId: string}>}>(
      context.port,
      '/api/contracts?party=Bob&templateId=Remote:Holding',
    )

    failBobContracts = true
    const multiContracts = await requestJson<{contracts: Record<string, Array<{contractId: string}>>}>(
      context.port,
      '/api/contracts/multi?parties=Alice,Bob',
    )

    expect(topologyStatus.participants).toEqual([
      expect.objectContaining({contractCount: 1, healthy: true, name: 'participant1'}),
      expect.objectContaining({contractCount: 0, healthy: false, name: 'participant2'}),
    ])
    expect(filteredContracts.activeContracts).toEqual([
      {contractId: 'Bob-contract'},
    ])
    expect(participant1.getActiveContracts).toHaveBeenCalledWith({
      filter: {party: 'Bob', templateIds: ['Remote:Holding']},
    })
    expect(multiContracts.contracts.Alice).toEqual([{contractId: 'Alice-contract'}])
    expect(multiContracts.contracts.Bob).toEqual([])
  })

  it('skips empty party identifiers when counting topology contracts', async () => {
    const participant1: LedgerClientLike = {
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
      getActiveContracts: vi.fn(async () => ({activeContracts: [{contractId: 'ignored'}]})),
      getParties: vi.fn(async () => ({
        partyDetails: [{}],
      })),
      getVersion: vi.fn(async () => ({version: '3.4.11'})),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
      uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-1'})),
    }
    const participant2: LedgerClientLike = {
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Bob'}})),
      getActiveContracts: vi.fn(async () => ({activeContracts: []})),
      getParties: vi.fn(async () => ({partyDetails: []})),
      getVersion: vi.fn(async () => ({version: '3.4.11'})),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-2'}})),
      uploadDar: vi.fn(async () => ({mainPackageId: 'pkg-2'})),
    }
    let clientCall = 0

    const context = await startServer({
      deps: {
        createLedgerClient: vi.fn(() => {
          clientCall++
          return clientCall === 1 ? participant1 : participant2
        }),
      },
      multiNode: true,
      start: {multiNode: true},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const status = await requestJson<{
      participants: Array<{contractCount: number; name: string}>
    }>(context.port, '/api/topology/status')

    expect(status.participants).toEqual([
      expect.objectContaining({contractCount: 0, name: 'participant1'}),
      expect.objectContaining({contractCount: 0, name: 'participant2'}),
    ])
    expect(participant1.getActiveContracts).not.toHaveBeenCalled()
  })

  it('handles no-profile splice queries and missing project files', async () => {
    const stableSplice = {
      listScanUpdates: vi.fn(async (options) => ({
        source: 'scan',
        updates: [],
        warnings: [
          options.after ? `${options.after.migrationId}:${options.after.recordTime}` : 'none',
          String(options.pageSize),
          options.profile ? options.profile.name : 'no-profile',
        ],
      })),
      listTokenHoldings: vi.fn(async (options) => ({
        holdings: [],
        interfaceId: 'iface',
        warnings: [
          options.instrumentAdmin ?? 'no-admin',
          options.instrumentId ?? 'no-instrument',
          options.profile ? options.profile.name : 'no-profile',
          options.token ?? 'no-token',
        ],
      })),
    }
    const config: CantonctlConfig = {
      project: {name: 'serve-test', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const context = await startServer({
      config,
      deps: {
        createStableSplice: vi.fn(() => stableSplice as never),
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const holdings = await requestJson<{warnings: string[]}>(context.port, '/api/splice/token-holdings?party=Alice&instrumentAdmin=Admin&instrumentId=Token')
    const updates = await requestJson<{warnings: string[]}>(context.port, '/api/splice/scan/updates?afterMigrationId=7&afterRecordTime=2026-04-02T20:00:00Z&pageSize=0')

    expect(holdings.warnings).toEqual(['Admin', 'Token', 'no-profile', 'no-token'])
    expect(updates.warnings).toEqual(['7:2026-04-02T20:00:00Z', '20', 'no-profile'])

    await fs.rm(context.projectDir, {force: true, recursive: true})
    expect((await request(context.port, '/api/project')).status).toBe(500)
    expect((await request(context.port, '/api/files')).status).toBe(500)
  })

  it('surfaces route-level command, build, and test failures and upload warnings', async () => {
    let failAllocate = false
    let failBuildRoute = false
    let failCommands = false
    let failContracts = false
    let failParties = false
    let failTestRoute = false
    let failUpload = false
    const projectDir = await createProjectDir()

    const client: LedgerClientLike = {
      allocateParty: vi.fn(async () => {
        if (failAllocate) throw new Error('allocate failed')
        return {partyDetails: {party: 'Alice'}}
      }),
      getActiveContracts: vi.fn(async ({filter}) => {
        if (failContracts) throw new Error('contracts failed')
        return {activeContracts: [{contractId: `${filter.party}-contract`}]}
      }),
      getParties: vi.fn(async () => {
        if (failParties) throw new Error('parties failed')
        return {partyDetails: [{party: 'Alice'}]}
      }),
      getVersion: vi.fn(async () => ({version: '3.4.11'})),
      submitAndWait: vi.fn(async () => {
        if (failCommands) throw new Error('command failed')
        return {transaction: {updateId: 123 as unknown as string}}
      }),
      uploadDar: vi.fn(async () => {
        if (failUpload) throw new Error('upload failed')
        return {mainPackageId: 'pkg-1'}
      }),
    }
    const output = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      result: vi.fn(),
      spinner: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }
    const builder = {
      build: vi.fn(async ({force}: {force?: boolean; projectDir: string}) => {
        if (force && failBuildRoute) throw new Error('build failed')
        return {
          cached: false,
          darPath: path.join(projectDir, '.daml', 'dist', 'serve-test.dar'),
          durationMs: 1,
          success: true,
        }
      }),
      buildWithCodegen: vi.fn(async () => ({cached: true, darPath: null, durationMs: 1, success: true})),
      watch: vi.fn(),
    }
    const testRunner = {
      run: vi.fn(async () => {
        if (failTestRoute) throw new Error('tests failed')
        return {durationMs: 1, output: 'ok', passed: true, success: true}
      }),
    }

    const context = await startServer({
      start: {projectDir},
      deps: {
        builder,
        createLedgerClient: vi.fn(() => client),
        output,
        testRunner,
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const commandResult = await requestJson<{updateId?: string}>(context.port, '/api/commands', {
      body: JSON.stringify({commands: []}),
      method: 'POST',
    })
    expect(commandResult.updateId).toBeUndefined()

    failUpload = true
    const buildResult = await requestJson<{darPath: string}>(context.port, '/api/build', {method: 'POST'})
    expect(buildResult.darPath).toContain('serve-test.dar')
    expect(output.warn).toHaveBeenCalledWith('DAR upload to sandbox failed: Error: upload failed')

    failCommands = true
    expect((await request(context.port, '/api/commands', {
      body: JSON.stringify({actAs: ['Alice'], commands: []}),
      method: 'POST',
    })).status).toBe(500)

    failContracts = true
    expect((await request(context.port, '/api/contracts?party=Alice')).status).toBe(500)

    failParties = true
    expect((await request(context.port, '/api/parties')).status).toBe(500)

    failAllocate = true
    expect((await request(context.port, '/api/parties', {
      body: JSON.stringify({displayName: 'Bob'}),
      method: 'POST',
    })).status).toBe(500)

    failBuildRoute = true
    expect((await request(context.port, '/api/build', {method: 'POST'})).status).toBe(500)

    failTestRoute = true
    expect((await request(context.port, '/api/test', {method: 'POST'})).status).toBe(500)
  })

  it('warns when dar upload fails after saving a daml file', async () => {
    const output = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      result: vi.fn(),
      spinner: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }
    const client: LedgerClientLike = {
      allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
      getActiveContracts: vi.fn(async () => ({activeContracts: []})),
      getParties: vi.fn(async () => ({partyDetails: []})),
      getVersion: vi.fn(async () => ({version: '3.4.11'})),
      submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
      uploadDar: vi.fn(async () => { throw new Error('save upload failed') }),
    }

    const context = await startServer({
      deps: {
        createLedgerClient: vi.fn(() => client),
        output,
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const savedDaml = await requestJson<{path: string; saved: boolean}>(context.port, '/api/files/daml/Model.daml', {
      body: JSON.stringify({content: 'module Model where\n'}),
      method: 'PUT',
    })

    expect(savedDaml).toEqual({path: 'daml/Model.daml', saved: true})
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(output.warn).toHaveBeenCalledWith('DAR upload to sandbox failed: Error: save upload failed')
  })

  it('serves SPA fallbacks and emits websocket connection events', async () => {
    const projectDir = await createProjectDir()
    const port = await getFreePort()
    const staticDir = path.join(projectDir, 'playground-dist')
    await fs.mkdir(staticDir, {recursive: true})
    await fs.writeFile(path.join(staticDir, 'index.html'), '<html><body>Fallback</body></html>', 'utf8')

    const context = await startServer({
      projectDirSetup: async () => undefined,
      start: {
        multiNode: false,
        port,
        projectDir,
        staticDir,
      },
      deps: {
        builder: {
          build: vi.fn(async () => ({
            cached: true,
            darPath: path.join(projectDir, '.daml', 'dist', 'serve-test.dar'),
            durationMs: 1,
            success: true,
          })),
          buildWithCodegen: vi.fn(async () => ({cached: true, darPath: null, durationMs: 1, success: true})),
          watch: vi.fn(),
        },
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const connected = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${context.port}`)
      socket.once('message', (message) => {
        const payload = String(message)
        socket.close()
        resolve(payload)
      })
      socket.once('error', reject)
    })
    const fallback = await request(context.port, '/missing-route')

    expect(connected).toBe(JSON.stringify({type: 'connected'}))
    expect(fallback.status).toBe(200)
    expect(await fallback.text()).toContain('Fallback')
  }, 20_000)

  it('surfaces generic profile switch and splice route failures', async () => {
    const baseProfiles = createConfig().profiles!
    const config: CantonctlConfig = {
      ...createConfig(),
      profiles: new Proxy(baseProfiles, {
        get(target, prop, receiver) {
          if (prop === 'boom') {
            throw new Error('profile exploded')
          }

          return Reflect.get(target, prop, receiver)
        },
      }),
    }
    const stableSplice = {
      listScanUpdates: vi.fn(async () => { throw new Error('scan failed') }),
      listTokenHoldings: vi.fn(async () => { throw new Error('holdings failed') }),
    }

    const context = await startServer({
      config,
      deps: {
        createStableSplice: vi.fn(() => stableSplice as never),
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    expect((await request(context.port, '/api/profile', {
      body: JSON.stringify({profile: 'boom'}),
      method: 'PUT',
    })).status).toBe(500)
    expect((await request(context.port, '/api/splice/token-holdings?party=Alice')).status).toBe(500)
    expect((await request(context.port, '/api/splice/scan/updates?pageSize=5')).status).toBe(500)
  })

  it('serializes non-Error splice route failures', async () => {
    const stableSplice = {
      listScanUpdates: vi.fn(async () => { throw 'scan string failure' }),
      listTokenHoldings: vi.fn(async () => { throw 'holdings string failure' }),
    }

    const context = await startServer({
      deps: {
        createStableSplice: vi.fn(() => stableSplice as never),
      },
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const holdings = await request(context.port, '/api/splice/token-holdings?party=Alice')
    const updates = await request(context.port, '/api/splice/scan/updates?pageSize=5')

    expect(holdings.status).toBe(500)
    expect(await holdings.json()).toEqual({error: 'holdings string failure'})
    expect(updates.status).toBe(500)
    expect(await updates.json()).toEqual({error: 'scan string failure'})
  })

  it('covers file middleware edge cases and daml save failures', async () => {
    let failFileBuild = false
    const projectDir = await createProjectDir()
    const port = await getFreePort()
    const builder = {
      build: vi.fn(async () => {
        if (failFileBuild) throw new Error('watch build failed')
        return {
          cached: false,
          darPath: path.join(projectDir, '.daml', 'dist', 'serve-test.dar'),
          durationMs: 1,
          success: true,
        }
      }),
      buildWithCodegen: vi.fn(async () => ({cached: true, darPath: null, durationMs: 1, success: true})),
      watch: vi.fn(),
    }

    const context = await startServer({
      deps: {builder},
      start: {port, projectDir},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const fileTree = await requestJson<Array<{name: string}>>(context.port, '/api/files/')
    expect(fileTree).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'README.md'}),
    ]))

    const unsupportedMethod = await request(context.port, '/api/files/README.md', {
      body: JSON.stringify({content: 'ignored'}),
      method: 'POST',
    })
    expect(unsupportedMethod.status).toBe(404)

    failFileBuild = true
    const websocketEventsPromise = new Promise<string[]>((resolve, reject) => {
      const events: string[] = []
      const socket = new WebSocket(`ws://127.0.0.1:${context.port}`)
      socket.on('message', (message) => {
        events.push(String(message))
        if (events.some(event => event.includes('"type":"build:error"'))) {
          socket.close()
          resolve(events)
        }
      })
      socket.once('error', reject)
    })

    const savedDaml = await requestJson<{path: string; saved: boolean}>(context.port, '/api/files/daml/Model.daml', {
      body: JSON.stringify({content: 'module Model where\n'}),
      method: 'PUT',
    })
    const websocketEvents = await websocketEventsPromise
    expect(savedDaml).toEqual({path: 'daml/Model.daml', saved: true})
    expect(websocketEvents).toEqual(expect.arrayContaining([
      JSON.stringify({type: 'connected'}),
      JSON.stringify({type: 'build:start'}),
      JSON.stringify({output: 'Error: watch build failed', type: 'build:error'}),
    ]))

    const invalidSave = await request(context.port, '/api/files/daml/Bad.daml', {
      body: JSON.stringify({}),
      method: 'PUT',
    })
    expect(invalidSave.status).toBe(500)
  })

  it('emits cached save builds and skips uploads when build routes have no dar path', async () => {
    let buildCall = 0
    const projectDir = await createProjectDir()
    const port = await getFreePort()
    const uploadDar = vi.fn(async () => ({mainPackageId: 'pkg-1'}))
    const builder = {
      build: vi.fn(async ({force}: {force?: boolean; projectDir: string}) => {
        if (force) {
          return {
            cached: false,
            darPath: null,
            durationMs: 1,
            success: true,
          }
        }

        buildCall++
        if (buildCall === 1) {
          return {
            cached: false,
            darPath: path.join(projectDir, '.daml', 'dist', 'serve-test.dar'),
            durationMs: 1,
            success: true,
          }
        }

        return {
          cached: true,
          darPath: path.join(projectDir, '.daml', 'dist', 'serve-test.dar'),
          durationMs: 1,
          success: true,
        }
      }),
      buildWithCodegen: vi.fn(async () => ({cached: true, darPath: null, durationMs: 1, success: true})),
      watch: vi.fn(),
    }

    const context = await startServer({
      deps: {
        builder,
        createLedgerClient: vi.fn(() => ({
          allocateParty: vi.fn(async () => ({partyDetails: {party: 'Alice'}})),
          getActiveContracts: vi.fn(async () => ({activeContracts: []})),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(async () => ({transaction: {updateId: 'tx-1'}})),
          uploadDar,
        })),
      },
      start: {port, projectDir},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const websocketEventsPromise = new Promise<string[]>((resolve, reject) => {
      const events: string[] = []
      const socket = new WebSocket(`ws://127.0.0.1:${context.port}`)
      socket.on('message', (message) => {
        events.push(String(message))
        if (events.some(event => event.includes('"type":"build:cached"'))) {
          socket.close()
          resolve(events)
        }
      })
      socket.once('error', reject)
    })

    const savedDaml = await requestJson<{path: string; saved: boolean}>(context.port, '/api/files/daml/Model.daml', {
      body: JSON.stringify({content: 'module Model where\n'}),
      method: 'PUT',
    })
    const buildResult = await requestJson<{darPath: null}>(context.port, '/api/build', {method: 'POST'})
    const websocketEvents = await websocketEventsPromise

    expect(savedDaml).toEqual({path: 'daml/Model.daml', saved: true})
    expect(buildResult).toEqual({
      cached: false,
      darPath: null,
      durationMs: 1,
      success: true,
    })
    expect(websocketEvents).toEqual(expect.arrayContaining([
      JSON.stringify({type: 'connected'}),
      JSON.stringify({type: 'build:start'}),
      JSON.stringify({
        dar: path.join(projectDir, '.daml', 'dist', 'serve-test.dar'),
        durationMs: 1,
        type: 'build:cached',
      }),
    ]))
    expect(uploadDar).toHaveBeenCalledTimes(1)
  })

  it('starts cleanly when the initial build produces no dar file', async () => {
    const projectDir = await createProjectDir()
    const port = await getFreePort()
    const builder = {
      build: vi.fn(async () => ({
        cached: false,
        darPath: null,
        durationMs: 1,
        success: true,
      })),
      buildWithCodegen: vi.fn(async () => ({cached: true, darPath: null, durationMs: 1, success: true})),
      watch: vi.fn(),
    }

    const context = await startServer({
      deps: {builder},
      start: {port, projectDir},
    })
    activeServer = context.server
    activeProjectDir = context.projectDir

    const health = await requestJson<{healthy: boolean}>(context.port, '/api/health')
    expect(health.healthy).toBe(true)
  })
})
