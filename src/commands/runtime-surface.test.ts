import {captureOutput} from '@oclif/test'
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import * as jwtModule from '../lib/jwt.js'
import * as ledgerClientModule from '../lib/ledger-client.js'
import type {LedgerClient} from '../lib/ledger-client.js'
import * as processRunnerModule from '../lib/process-runner.js'
import type {ProfileRuntimeResolver} from '../lib/profile-runtime.js'
import * as topologyModule from '../lib/topology.js'
import type {GeneratedTopology} from '../lib/topology.js'
import Doctor from './doctor.js'
import Status from './status.js'

const CLI_ROOT = process.cwd()

afterEach(() => {
  vi.restoreAllMocks()
})

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networks: {
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
    parties: [{name: 'Alice', role: 'operator'}],
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
          auth: {issuer: 'https://login.example.com', kind: 'oidc'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          scanProxy: {url: 'https://scan-proxy.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
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

function createDoctorRunner(options: {
  composeAvailable?: boolean
  dockerPresent?: boolean
  imagePresent?: boolean
  javaPresent?: boolean
  sdk?: 'daml' | 'dpm' | 'missing'
} = {}) {
  const composeAvailable = options.composeAvailable ?? true
  const dockerPresent = options.dockerPresent ?? true
  const imagePresent = options.imagePresent ?? true
  const javaPresent = options.javaPresent ?? true
  const sdk = options.sdk ?? 'dpm'

  return {
    run: vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'java' && args[0] === '-version') {
        return {exitCode: 0, stderr: 'openjdk version "21.0.10"', stdout: ''}
      }

      if (cmd === 'dpm' && args[0] === 'version' && args[1] === '--active') {
        return {exitCode: 0, stderr: '', stdout: '1.0.0'}
      }

      if (cmd === 'daml' && args[0] === 'version') {
        return {exitCode: 0, stderr: '', stdout: '3.4.11'}
      }

      if (cmd === 'docker' && args[0] === '--version') {
        return {exitCode: 0, stderr: '', stdout: 'Docker version 24.0.7, build 311b9ff'}
      }

      if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') {
        return composeAvailable
          ? {exitCode: 0, stderr: '', stdout: 'Docker Compose version v2.40.3'}
          : {exitCode: 1, stderr: 'missing', stdout: ''}
      }

      if (cmd === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
        return imagePresent
          ? {exitCode: 0, stderr: '', stdout: '[]'}
          : {exitCode: 1, stderr: 'missing', stdout: ''}
      }

      return {exitCode: 0, stderr: '', stdout: ''}
    }),
    spawn: vi.fn(),
    which: vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'java') return javaPresent ? '/usr/bin/java' : null
      if (cmd === 'docker') return dockerPresent ? '/usr/bin/docker' : null
      if (cmd === 'dpm') return sdk === 'dpm' ? '/usr/bin/dpm' : null
      if (cmd === 'daml') return sdk === 'daml' ? '/usr/bin/daml' : null
      return null
    }),
  }
}

function setStdoutTty(value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value})
  return () => {
    if (descriptor) {
      Object.defineProperty(process.stdout, 'isTTY', descriptor)
      return
    }

    delete (process.stdout as {isTTY?: boolean}).isTTY
  }
}

describe('runtime command surface', () => {
  it('adds profile-aware services to status json output', async () => {
    const config = createConfig()

    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          async allocateParty() {
            return {partyDetails: {}}
          },
          async getActiveContracts() {
            return {activeContracts: []}
          },
          async getLedgerEnd() {
            return {offset: 0}
          },
          async getParties() {
            return {
              partyDetails: [
                {displayName: 'Alice', identifier: 'Alice::1224'},
              ],
            }
          },
          async getVersion() {
            return {version: '3.4.11'}
          },
          async submitAndWait() {
            return {transaction: {}}
          },
          async uploadDar() {
            return {mainPackageId: 'pkg'}
          },
        }
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }

      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--profile', 'sandbox', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      drift: [],
      healthy: true,
      inventory: expect.objectContaining({
        profile: expect.objectContaining({kind: 'sandbox', name: 'sandbox'}),
        schemaVersion: 1,
        services: expect.arrayContaining([
          expect.objectContaining({
            name: 'ledger',
            runtimeProvenance: 'derived-local-default',
            status: 'healthy',
          }),
        ]),
      }),
      profile: expect.objectContaining({kind: 'sandbox', name: 'sandbox'}),
      reconcile: expect.objectContaining({
        supportedActions: [],
      }),
      services: [
        expect.objectContaining({
          endpoint: 'http://localhost:7575',
          name: 'ledger',
          status: 'healthy',
        }),
      ],
      version: '3.4.11',
    }))
  })

  it('adds profile diagnostics to doctor json output', async () => {
    const config = createConfig()

    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }
    }

    const result = await captureOutput(() => TestDoctor.run(['--profile', 'splice-devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      profile: expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}),
      checks: expect.arrayContaining([
        expect.objectContaining({name: 'Profile', status: 'pass'}),
        expect.objectContaining({name: 'Service scanProxy', status: 'warn'}),
        expect.objectContaining({name: 'Service validator', status: 'warn'}),
      ]),
    }))
  })

  it('covers status helper factories directly', async () => {
    const config = createConfig()
    const token = 'jwt-token'
    const topology: GeneratedTopology = {
      bootstrapScript: '',
      cantonConf: '',
      dockerCompose: '',
      participants: [{
        name: 'participant1',
        parties: ['Alice'],
        ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865},
      }],
      synchronizer: {admin: 10001, publicApi: 10002},
    }
    const client = {
      allocateParty: vi.fn(),
      getActiveContracts: vi.fn(),
      getLedgerEnd: vi.fn(),
      getParties: vi.fn(),
      getVersion: vi.fn(),
      submitAndWait: vi.fn(),
      uploadDar: vi.fn(),
    } as unknown as LedgerClient

    const createClientSpy = vi.spyOn(ledgerClientModule, 'createLedgerClient').mockReturnValue(client)
    const createTokenSpy = vi.spyOn(jwtModule, 'createSandboxToken').mockResolvedValue(token)
    const detectTopologySpy = vi.spyOn(topologyModule, 'detectTopology').mockResolvedValue(topology)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)

    class StatusHarness extends Status {
      public callCreateStatusLedgerClient(baseUrl?: string, authToken?: string): LedgerClient {
        return this.createStatusLedgerClient(baseUrl, authToken)
      }

      public async callCreateStatusToken(commandConfig?: CantonctlConfig): Promise<string> {
        return this.createStatusToken(commandConfig)
      }

      public async callDetectProjectTopology(cwd?: string): Promise<GeneratedTopology | null> {
        return this.detectProjectTopology(cwd)
      }

      public async callLoadProjectConfig(): Promise<CantonctlConfig> {
        return this.loadProjectConfig()
      }
    }

    const harness = new StatusHarness([], {} as never)
    expect(harness.callCreateStatusLedgerClient('https://ledger.example.com', token)).toBe(client)
    await expect(harness.callCreateStatusToken(config)).resolves.toBe(token)
    await expect(harness.callDetectProjectTopology('/repo')).resolves.toBe(topology)
    await expect(harness.callDetectProjectTopology()).resolves.toBe(topology)
    await expect(harness.callLoadProjectConfig()).resolves.toBe(config)
    await expect(harness.callCreateStatusToken()).resolves.toBe(token)

    expect(createClientSpy).toHaveBeenCalledWith({baseUrl: 'https://ledger.example.com', token})
    expect(createTokenSpy).toHaveBeenNthCalledWith(1, {
      actAs: ['Alice'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: ['Alice'],
    })
    expect(createTokenSpy).toHaveBeenNthCalledWith(2, {
      actAs: ['admin'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: [],
    })
    expect(detectTopologySpy).toHaveBeenNthCalledWith(1, '/repo')
    expect(detectTopologySpy).toHaveBeenNthCalledWith(2, process.cwd())
    expect(loadConfigSpy).toHaveBeenCalledOnce()
  })

  it('covers doctor helper factories directly', async () => {
    const config = createConfig()
    const runner = createDoctorRunner()
    const createRunnerSpy = vi.spyOn(processRunnerModule, 'createProcessRunner').mockReturnValue(runner as never)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)

    class DoctorHarness extends Doctor {
      public callCreateRunner() {
        return this.createRunner()
      }

      public callCreateReadlineInterface() {
        return this.createReadlineInterface()
      }

      public callInstallSdk(): void {
        this.installSdk()
      }

      public async callLoadProjectConfig(): Promise<CantonctlConfig> {
        return this.loadProjectConfig()
      }

      public callResolveProfileSummary(commandConfig: CantonctlConfig, profileName?: string) {
        return this.resolveProfileSummary(commandConfig, profileName)
      }
    }

    const harness = new DoctorHarness([], {} as never)
    expect(harness.callCreateRunner()).toBe(runner)
    const rl = harness.callCreateReadlineInterface()
    expect(rl.question).toEqual(expect.any(Function))
    rl.close()

    const fakeBinDir = mkdtempSync(join(tmpdir(), 'doctor-install-'))
    const fakeCurlPath = join(fakeBinDir, 'curl')
    const originalPath = process.env.PATH
    writeFileSync(fakeCurlPath, '#!/bin/sh\necho "exit 0"\n')
    chmodSync(fakeCurlPath, 0o755)
    await expect(harness.callLoadProjectConfig()).resolves.toBe(config)
    expect(harness.callResolveProfileSummary(config, 'sandbox')).toEqual({
      experimental: false,
      kind: 'sandbox',
      name: 'sandbox',
    })
    expect(harness.callResolveProfileSummary({
      ...config,
      'default-profile': 'missing',
    })).toBeUndefined()

    try {
      process.env.PATH = originalPath ? `${fakeBinDir}:${originalPath}` : fakeBinDir
      harness.callInstallSdk()
    } finally {
      process.env.PATH = originalPath
      rmSync(fakeBinDir, {force: true, recursive: true})
    }

    expect(createRunnerSpy).toHaveBeenCalledOnce()
    expect(loadConfigSpy).toHaveBeenCalledOnce()
  })

  it('reports multi-node ledger status in json mode', async () => {
    const config = createConfig()

    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [
            {
              name: 'participant1',
              parties: ['Alice'],
              ports: {
                admin: 2001,
                jsonApi: 7575,
                ledgerApi: 6865,
              },
            },
            {
              name: 'participant2',
              parties: ['Bob'],
              ports: {
                admin: 2002,
                jsonApi: 7576,
                ledgerApi: 6866,
              },
            },
          ],
          synchronizer: {admin: 10001, publicApi: 10002},
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }

      protected override createStatusLedgerClient(baseUrl?: string): LedgerClient {
        return {
          async allocateParty() {
            return {partyDetails: {}}
          },
          async getActiveContracts() {
            return {activeContracts: []}
          },
          async getLedgerEnd() {
            return {offset: 0}
          },
          async getParties() {
            return {
              partyDetails: [{
                displayName: baseUrl?.endsWith('7576') ? 'Bob' : 'Alice',
                identifier: baseUrl?.endsWith('7576') ? 'Bob::1225' : 'Alice::1224',
              }],
            }
          },
          async getVersion() {
            return {version: baseUrl?.endsWith('7576') ? '3.4.12' : '3.4.11'}
          },
          async submitAndWait() {
            return {transaction: {}}
          },
          async uploadDar() {
            return {mainPackageId: 'pkg'}
          },
        }
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      mode: 'multi-node',
      nodes: [
        expect.objectContaining({healthy: true, name: 'participant1', port: 7575, version: '3.4.11'}),
        expect.objectContaining({healthy: true, name: 'participant2', port: 7576, version: '3.4.12'}),
      ],
      services: [
        expect.objectContaining({name: 'ledger', status: 'healthy'}),
      ],
    }))
  })

  it('reports multi-node status in json mode without an inferred profile', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [{
            name: 'participant1',
            parties: ['Alice'],
            ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865},
          }],
          synchronizer: {admin: 10001, publicApi: 10002},
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          'default-profile': 'missing',
          networks: {
            local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
          },
          profiles: {},
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.data).toEqual(expect.objectContaining({
      mode: 'multi-node',
      services: [
        expect.objectContaining({
          detail: 'json-api-port 7575',
          endpoint: 'http://localhost:7575',
          name: 'ledger',
        }),
      ],
    }))
    expect(Object.prototype.hasOwnProperty.call(json.data, 'profile')).toBe(false)
  })

  it('omits auth metadata when runtime resolution fails after profile inspection', async () => {
    const config = createConfig()

    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }

      protected override createProfileRuntimeResolver(): ProfileRuntimeResolver {
        return {
          resolve: vi.fn().mockRejectedValue(new Error('runtime boom')),
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.data).toEqual(expect.objectContaining({
      mode: 'sandbox',
      network: 'local',
    }))
    expect(json.data).not.toHaveProperty('auth')
  })

  it('marks non-ledger inferred profile services as configured in multi-node json mode', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [{
            name: 'participant1',
            parties: ['Alice'],
            ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865},
          }],
          synchronizer: {admin: 10001, publicApi: 10002},
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        const config = createConfig()
        return {
          ...config,
          'default-profile': 'splice-devnet',
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.data).toEqual(expect.objectContaining({
      services: expect.arrayContaining([
        expect.objectContaining({name: 'ledger', status: 'healthy'}),
        expect.objectContaining({name: 'validator', status: 'configured'}),
      ]),
    }))
  })

  it('marks the multi-node ledger service unreachable when any participant is unhealthy', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [
            {
              name: 'participant1',
              parties: ['Alice'],
              ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865},
            },
            {
              name: 'participant2',
              parties: ['Bob'],
              ports: {admin: 2002, jsonApi: 7576, ledgerApi: 6866},
            },
          ],
          synchronizer: {admin: 10001, publicApi: 10002},
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          'default-profile': 'splice-devnet',
        }
      }

      protected override createStatusLedgerClient(baseUrl?: string): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => {
            if (baseUrl?.endsWith('7576')) {
              throw new Error('offline')
            }

            return {version: '3.4.11'}
          }),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      mode: 'multi-node',
      nodes: [
        expect.objectContaining({healthy: true, name: 'participant1'}),
        expect.objectContaining({healthy: false, name: 'participant2'}),
      ],
      services: expect.arrayContaining([
        expect.objectContaining({name: 'ledger', status: 'unreachable'}),
        expect.objectContaining({name: 'validator', status: 'configured'}),
      ]),
    }))
  })

  it('reports single-node ledger status in json mode', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createStatusLedgerClient(baseUrl?: string): LedgerClient {
        expect(baseUrl).toBe('http://localhost:7575')
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({
            partyDetails: [{displayName: 'Alice', identifier: 'Alice::1224', isLocal: true}],
          })),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      healthy: true,
      mode: 'sandbox',
      network: 'local',
      parties: [{displayName: 'Alice', identifier: 'Alice::1224'}],
      profile: expect.objectContaining({kind: 'sandbox', name: 'sandbox'}),
      version: '3.4.11',
    }))
  })

  it('uses network profile mappings when reporting single-node status by network', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          networkProfiles: {
            devnet: 'splice-devnet',
          },
          networks: {
            ...createConfig().networks,
            devnet: {
              type: 'remote',
              url: 'https://devnet-ledger.example.com',
            },
          },
        }
      }

      protected override createStatusLedgerClient(baseUrl?: string): LedgerClient {
        expect(baseUrl).toBe('https://devnet-ledger.example.com')
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--network', 'devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      healthy: true,
      mode: 'single-node',
      network: 'devnet',
      profile: expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}),
      services: expect.arrayContaining([
        expect.objectContaining({name: 'ledger', status: 'healthy'}),
        expect.objectContaining({name: 'validator', status: 'configured'}),
      ]),
      version: '3.4.11',
    }))
  })

  it('renders profile summaries without probing remote ledgers in human mode', async () => {
    const config = createConfig()

    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--profile', 'splice-devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Profile: splice-devnet')
    expect(result.stdout).toContain('Kind: remote-validator')
    expect(result.stdout).toContain('ledger')
    expect(result.stdout).toContain('validator')
  })

  it('keeps remote profile status machine-readable without probing non-local ledgers', async () => {
    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createStatusLedgerClient(): LedgerClient {
        throw new Error('remote profiles should not probe non-local ledgers')
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--profile', 'splice-devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      mode: 'profile',
      parties: [],
      profile: expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}),
    }))
    expect(Object.prototype.hasOwnProperty.call(json.data, 'healthy')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(json.data, 'version')).toBe(false)
  })

  it('serializes missing network errors in json mode', async () => {
    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--network', 'missing', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
    }))
  })

  it('serializes missing network errors with an explicit none fallback when no networks are configured', async () => {
    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          networks: undefined,
        }
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--network', 'missing', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: expect.stringContaining('Available: none'),
    }))
  })

  it('fails profile status when the local ledger is unreachable', async () => {
    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(),
          getVersion: vi.fn().mockRejectedValue(new Error('offline')),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--profile', 'sandbox', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      healthy: false,
      mode: 'profile',
    }))
  })

  it('fails single-node status when the ledger is unreachable', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(),
          getVersion: vi.fn().mockRejectedValue(new Error('offline')),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      healthy: false,
      mode: 'sandbox',
      network: 'local',
    }))
  })

  it('treats party enumeration failures as non-fatal for healthy ledgers', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn().mockRejectedValue(new Error('party lookup failed')),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      healthy: true,
      mode: 'sandbox',
      parties: [],
      version: '3.4.11',
    }))
  })

  it('renders local profile status in human mode with ledger health, parties, and experimental warnings', async () => {
    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        const config = createConfig()
        const profiles = config.profiles!
        return {
          ...config,
          profiles: {
            ...profiles,
            sandbox: {
              ...profiles.sandbox!,
              experimental: true,
            },
          },
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({
            partyDetails: [{displayName: 'Alice', identifier: 'Alice::1224'}],
          })),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--profile', 'sandbox'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Profile: sandbox')
    expect(result.stdout).toContain('Ledger healthy (v3.4.11)')
    expect(result.stdout).toContain('Alice')
    expect(result.stderr).toContain('Profile is marked experimental')
  })

  it('renders blank strings for missing profile party fields in human mode', async () => {
    class TestStatus extends Status {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({
            partyDetails: [{}],
          })),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--profile', 'sandbox'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('┌───────┬────┐')
  })

  it('renders multi-node status in human mode without an inferred profile and exits when any participant is unreachable', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [
            {
              name: 'participant1',
              parties: ['Alice'],
              ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865},
            },
            {
              name: 'participant2',
              parties: ['Bob'],
              ports: {admin: 2002, jsonApi: 7576, ledgerApi: 6866},
            },
          ],
          synchronizer: {admin: 10001, publicApi: 10002},
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          'default-profile': 'missing',
          networks: {
            local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
          },
          profiles: {},
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }

      protected override createStatusLedgerClient(baseUrl?: string): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({
            partyDetails: baseUrl?.endsWith('7575')
              ? [{displayName: 'Alice', identifier: 'Alice::1224'}]
              : [],
          })),
          getVersion: vi.fn().mockImplementation(async () => {
            if (baseUrl?.endsWith('7576')) {
              throw new Error('offline')
            }

            return {version: '3.4.11'}
          }),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run([], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.stdout).toContain('Mode: multi-node (Docker topology)')
    expect(result.stdout).toContain('participant1')
    expect(result.stdout).toContain('participant2')
    expect(result.stdout).toContain('unreachable')
    expect(result.stdout).toContain('ledger')
  })

  it('renders multi-node status with an inferred local profile in human mode', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [{
            name: 'participant1',
            parties: ['Alice'],
            ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865},
          }],
          synchronizer: {admin: 10001, publicApi: 10002},
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({
            partyDetails: [{displayName: 'Alice', identifier: 'Alice::1224'}],
          })),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Mode: multi-node (Docker topology)')
    expect(result.stdout).toContain('Profile: sandbox (sandbox)')
  })

  it('renders required operator auth for an inferred remote profile in multi-node human mode', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [{
            name: 'participant1',
            parties: ['Alice'],
            ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865},
          }],
          synchronizer: {admin: 10001, publicApi: 10002},
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          'default-profile': 'splice-devnet',
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({
            partyDetails: [{displayName: 'Alice', identifier: 'Alice::1224'}],
          })),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Profile: splice-devnet (remote-validator)')
    expect(result.stdout).toContain('Operator auth: required')
  })

  it('renders single-node remote status in human mode without an inferred profile', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          'default-profile': 'missing',
          networks: {
            devnet: {type: 'remote', url: 'https://ledger.example.com'},
          },
          profiles: {},
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }

      protected override createStatusLedgerClient(baseUrl?: string): LedgerClient {
        expect(baseUrl).toBe('https://ledger.example.com')
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--network', 'devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Network: devnet')
    expect(result.stdout).toContain('Mode: remote')
    expect(result.stdout).toContain('Ledger healthy (v3.4.11)')
    expect(result.stdout).toContain('https://ledger.example.com')
  })

  it('reports single-node remote status in json mode without an inferred profile', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          'default-profile': 'missing',
          networks: {
            devnet: {type: 'remote', url: 'https://ledger.example.com'},
          },
          profiles: {},
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--network', 'devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.data).toEqual(expect.objectContaining({
      healthy: true,
      inventory: expect.objectContaining({
        services: [
          expect.objectContaining({
            endpoint: 'https://ledger.example.com',
            name: 'ledger',
            runtimeProvenance: 'remote-discovery',
          }),
        ],
      }),
      mode: 'single-node',
      network: 'devnet',
      parties: [],
      services: [
        expect.objectContaining({
          detail: 'Ledger endpoint',
          endpoint: 'https://ledger.example.com',
          name: 'ledger',
        }),
      ],
      version: '3.4.11',
    }))
    expect(Object.prototype.hasOwnProperty.call(json.data, 'profile')).toBe(false)
  })

  it('renders single-node status with a same-name inferred profile and party table', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          'default-profile': 'missing',
          networkProfiles: {
            devnet: 'missing-profile',
          },
          networks: {
            devnet: {type: 'remote', url: 'https://ledger.example.com'},
          },
          parties: [{name: 'Alice', role: 'operator'}],
          profiles: {
            devnet: {
              experimental: false,
              kind: 'remote-validator',
              name: 'devnet',
              services: {
                ledger: {url: 'https://ledger.example.com'},
                validator: {url: 'https://validator.example.com'},
              },
            },
          },
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({
            partyDetails: [{displayName: 'Alice', identifier: 'Alice::1224', isLocal: false}],
          })),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--network', 'devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Profile: devnet (remote-validator)')
    expect(result.stdout).toContain('Party')
    expect(result.stdout).toContain('Alice::1224')
  })

  it('renders a local single-node fallback service table when no profile can be inferred', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          networks: {
            local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
          },
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: [{}]})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Network: local')
    expect(result.stdout).toContain('http://localhost:7575')
  })

  it('reports fallback single-node status against the default json api port when the local network omits it', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          networks: {
            local: {port: 5001, type: 'sandbox'},
          },
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(),
          getVersion: vi.fn().mockRejectedValue(new Error('offline')),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.data).toEqual(expect.objectContaining({
      healthy: false,
      mode: 'sandbox',
      network: 'local',
      services: [
        expect.objectContaining({
          detail: 'json-api-port 7575',
          endpoint: 'http://localhost:7575',
          status: 'unreachable',
        }),
      ],
    }))
    expect(Object.prototype.hasOwnProperty.call(json.data, 'profile')).toBe(false)
  })

  it('classifies legacy docker networks as local control-plane fallbacks when no profile can be inferred', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          networks: {
            canton: {type: 'docker'},
          },
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }

      protected override createStatusLedgerClient(baseUrl?: string): LedgerClient {
        expect(baseUrl).toBe('http://localhost:7575')
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({version: '3.4.11'})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run(['--network', 'canton', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.data).toEqual(expect.objectContaining({
      healthy: true,
      mode: 'single-node',
      network: 'canton',
      services: [
        expect.objectContaining({
          controlPlane: expect.objectContaining({
            endpointProvenance: 'legacy-network',
            lifecycleOwner: 'official-local-runtime',
            managementClass: 'apply-capable',
            mutationScope: 'managed',
          }),
          detail: 'json-api-port 7575',
          endpoint: 'http://localhost:7575',
          name: 'ledger',
        }),
      ],
      version: '3.4.11',
    }))
    expect(Object.prototype.hasOwnProperty.call(json.data, 'profile')).toBe(false)
  })

  it('covers status private helper branches directly', async () => {
    class HelperStatus extends Status {
      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(async () => ({partyDetails: []})),
          getVersion: vi.fn(async () => ({})),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }
    }

    const harness = new HelperStatus([], {} as never) as unknown as {
      getLedgerStatus(baseUrl: string, token: string): Promise<{healthy: boolean; parties: Array<Record<string, unknown>>; version?: string}>
      printServiceTable(out: {table: ReturnType<typeof vi.fn>}, services: Array<Record<string, unknown>>): void
      shouldCheckLedgerHealth(profile: NonNullable<CantonctlConfig['profiles']>[string]): boolean
    }
    const out = {table: vi.fn()}

    await expect(harness.getLedgerStatus('https://ledger.example.com', 'token')).resolves.toEqual({
      healthy: true,
      parties: [],
      version: '',
    })

    harness.printServiceTable(out, [{
      detail: 'Localnet configuration',
      endpoint: undefined,
      name: 'localnet',
      stability: 'config-only',
      status: 'configured',
    }])
    expect(out.table).toHaveBeenCalledWith(
      ['Service', 'Status', 'Endpoint', 'Stability'],
      [['localnet', 'configured', '-', 'config-only']],
    )

    expect(harness.shouldCheckLedgerHealth({
      experimental: false,
      kind: 'sandbox',
      name: 'empty',
      services: {},
    })).toBe(false)
    expect(harness.shouldCheckLedgerHealth({
      experimental: false,
      kind: 'sandbox',
      name: 'local',
      services: {ledger: {}},
    })).toBe(true)
    expect(harness.shouldCheckLedgerHealth({
      experimental: false,
      kind: 'remote-validator',
      name: 'loopback',
      services: {ledger: {url: 'http://127.0.0.1:7575'}},
    })).toBe(true)
  })

  it('renders single-node unreachable status in human mode', async () => {
    class TestStatus extends Status {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createStatusLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(),
          getVersion: vi.fn().mockRejectedValue(new Error('offline')),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override async createStatusToken(): Promise<string> {
        return 'token'
      }
    }

    const result = await captureOutput(() => TestStatus.run([], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.stderr).toContain('Ledger not reachable at http://localhost:7575')
  })

  it('runs doctor in human mode even when project config is absent', async () => {
    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND)
      }
    }

    const result = await captureOutput(() => TestDoctor.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Checking your development environment...')
    expect(result.stdout).toContain('checks passed')
  })

  it('renders doctor warning summaries when only optional checks warn', async () => {
    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner({composeAvailable: false})
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDoctor.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Checking your development environment...')
    expect(result.stderr).toContain('optional')
  })

  it('renders doctor plural failure summaries when multiple required checks fail', async () => {
    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner({javaPresent: false, sdk: 'missing'})
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDoctor.run([], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.stderr).toContain('required checks failed')
  })

  it('skips the install prompt when tty mode is active but the sdk check already passed', async () => {
    const restoreTty = setStdoutTty(true)
    const question = vi.fn()

    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner()
      }

      protected override createReadlineInterface() {
        return {
          close: vi.fn(),
          question,
        } as never
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    try {
      const result = await captureOutput(() => TestDoctor.run([], {root: CLI_ROOT}))
      expect(result.error).toBeUndefined()
      expect(question).not.toHaveBeenCalled()
    } finally {
      restoreTty()
    }
  })

  it('fails doctor when profile diagnostics are requested without project config', async () => {
    class TestDoctor extends Doctor {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
          suggestion: 'Run cantonctl init',
        })
      }
    }

    const result = await captureOutput(() => TestDoctor.run(['--profile', 'sandbox', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_NOT_FOUND,
      suggestion: 'Run cantonctl init',
    }))
  })

  it('renders doctor failure summaries and the install prompt when the SDK is missing and the user declines', async () => {
    const restoreTty = setStdoutTty(true)
    const question = vi.fn((_message: string, callback: (answer: string) => void) => {
      callback('n')
    })

    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner({imagePresent: false, sdk: 'missing'})
      }

      protected override createReadlineInterface() {
        return {
          close: vi.fn(),
          question,
        } as never
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    try {
      const result = await captureOutput(() => TestDoctor.run([], {root: CLI_ROOT}))
      expect(result.error).toBeDefined()
      expect(result.stdout).toContain('Splice-aware orchestration companion for the official Canton stack')
      expect(result.stdout).toContain('Checking your development environment...')
      expect(question).toHaveBeenCalledWith('DPM is missing. Install it now? (y/N) ', expect.any(Function))
      expect(result.stderr).toContain('required check failed')
    } finally {
      restoreTty()
    }
  })

  it('runs the doctor fix installation flow when --fix is provided', async () => {
    const installSdk = vi.fn()

    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner({sdk: 'missing'})
      }

      protected override installSdk(): void {
        installSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDoctor.run(['--fix'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(installSdk).toHaveBeenCalled()
    expect(result.stdout).toContain('Installing DPM...')
    expect(result.stdout).toContain('DPM installed. Run "cantonctl doctor" again to verify.')
  })

  it('reports doctor installation failures when the automated fix command errors', async () => {
    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner({sdk: 'missing'})
      }

      protected override installSdk(): void {
        throw new Error('install failed')
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDoctor.run(['--fix'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.stderr).toContain('SDK installation failed. Install manually')
  })

  it('serializes non-missing config errors before doctor checks start', async () => {
    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Fix cantonctl.yaml before running doctor.',
        })
      }
    }

    const result = await captureOutput(() => TestDoctor.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: 'Fix cantonctl.yaml before running doctor.',
    }))
  })

  it('rethrows unexpected config loading failures for doctor', async () => {
    class TestDoctor extends Doctor {
      protected override createRunner() {
        return createDoctorRunner()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('boom')
      }
    }

    await expect(TestDoctor.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
  })
})
