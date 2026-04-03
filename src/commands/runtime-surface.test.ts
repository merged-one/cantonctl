import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {LedgerClient} from '../lib/ledger-client.js'
import type {GeneratedTopology} from '../lib/topology.js'
import Doctor from './doctor.js'
import Status from './status.js'

const CLI_ROOT = process.cwd()

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
      healthy: true,
      profile: expect.objectContaining({kind: 'sandbox', name: 'sandbox'}),
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
        return {
          run: vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
            if (cmd === 'java' && args[0] === '-version') {
              return {exitCode: 0, stderr: 'openjdk version "21.0.10"', stdout: ''}
            }

            if (cmd === 'dpm' && args[0] === '--version') {
              return {exitCode: 0, stderr: '', stdout: '1.0.0'}
            }

            if (cmd === 'docker' && args[0] === '--version') {
              return {exitCode: 0, stderr: '', stdout: 'Docker version 24.0.7, build 311b9ff'}
            }

            if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') {
              return {exitCode: 0, stderr: '', stdout: 'Docker Compose version v2.40.3'}
            }

            if (cmd === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
              return {exitCode: 0, stderr: '', stdout: '[]'}
            }

            return {exitCode: 0, stderr: '', stdout: ''}
          }),
          spawn: vi.fn(),
          which: vi.fn().mockImplementation(async (cmd: string) => {
            if (cmd === 'java' || cmd === 'dpm' || cmd === 'docker') return `/usr/bin/${cmd}`
            return null
          }),
        }
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

  it('runs doctor in human mode even when project config is absent', async () => {
    class TestDoctor extends Doctor {
      protected override createRunner() {
        return {
          run: vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
            if (cmd === 'java' && args[0] === '-version') {
              return {exitCode: 0, stderr: 'openjdk version "21.0.10"', stdout: ''}
            }

            if (cmd === 'dpm' && args[0] === '--version') {
              return {exitCode: 0, stderr: '', stdout: '1.0.0'}
            }

            if (cmd === 'docker' && args[0] === '--version') {
              return {exitCode: 0, stderr: '', stdout: 'Docker version 24.0.7, build 311b9ff'}
            }

            if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') {
              return {exitCode: 0, stderr: '', stdout: 'Docker Compose version v2.40.3'}
            }

            if (cmd === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
              return {exitCode: 0, stderr: '', stdout: '[]'}
            }

            return {exitCode: 0, stderr: '', stdout: ''}
          }),
          spawn: vi.fn(),
          which: vi.fn().mockImplementation(async (cmd: string) => {
            if (cmd === 'java' || cmd === 'dpm' || cmd === 'docker') return `/usr/bin/${cmd}`
            return null
          }),
        }
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
})
