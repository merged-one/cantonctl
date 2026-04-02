import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../lib/config.js'
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
})
