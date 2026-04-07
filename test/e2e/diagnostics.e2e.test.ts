import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import DiagnosticsBundle from '../../src/commands/diagnostics/bundle.js'
import Status from '../../src/commands/status.js'
import type {CantonctlConfig} from '../../src/lib/config.js'
import {createDiagnosticsCollector} from '../../src/lib/diagnostics/collect.js'
import {createInMemoryBackend} from '../../src/lib/credential-store.js'
import type {LedgerClient} from '../../src/lib/ledger-client.js'
import {createProfileRuntimeResolver} from '../../src/lib/profile-runtime.js'
import type {GeneratedTopology} from '../../src/lib/topology.js'

const CLI_ROOT = process.cwd()

interface MockServer {
  close(): Promise<void>
  url: string
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

async function startServer(): Promise<MockServer> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    let body: unknown = {error: 'not found'}
    let status = 404

    if (url.pathname === '/v0/dso') {
      body = {migration_id: 8, previous_migration_id: 7, sv_party_id: 'sv::1'}
      status = 200
    } else if (url.pathname === '/v0/admin/validator/licenses') {
      body = {validator_licenses: [{validator: 'validator::1'}]}
      status = 200
    } else if (url.pathname === '/metrics') {
      body = {status: 'ok'}
      status = 200
    }

    response.statusCode = status
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  return {
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
    url: `http://127.0.0.1:${address.port}`,
  }
}

function createConfig(scanUrl: string): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    profiles: {
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {kind: 'jwt', url: scanUrl},
          ledger: {url: 'https://ledger.devnet.example.com'},
          scan: {url: scanUrl},
          validator: {url: scanUrl},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

async function runInProject<T extends typeof DiagnosticsBundle | typeof Status>(
  projectDir: string,
  command: T,
  args: string[],
): Promise<{error?: Error; stderr: string; stdout: string}> {
  const cwd = process.cwd
  Object.defineProperty(process, 'cwd', {
    configurable: true,
    value: () => projectDir,
  })

  try {
    return await captureOutput(() => command.run(args, {root: CLI_ROOT}))
  } finally {
    Object.defineProperty(process, 'cwd', {
      configurable: true,
      value: cwd.bind(process),
    })
  }
}

describe('diagnostics E2E', () => {
  let projectDir: string
  let scanServer: MockServer
  let workDir: string

  beforeAll(async () => {
    scanServer = await startServer()
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-diagnostics-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
  })

  afterAll(async () => {
    await scanServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('adds a machine-readable summary to status json output', async () => {
    class TestStatus extends Status {
      protected override async createStatusToken(): Promise<string> {
        return 'jwt-token'
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
            return {partyDetails: [{displayName: 'Alice', identifier: 'Alice::1224'}]}
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

      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig(scanServer.url)
      }
    }

    const result = await runInProject(projectDir, TestStatus, ['--profile', 'splice-devnet', '--json'])
    expect(result.error).toBeUndefined()
    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      summary: expect.objectContaining({
        configuredServices: 4,
        healthyServices: 0,
      }),
    }))
  })

  it('writes a diagnostics bundle with inventory, drift, and redacted last-operation snapshots', async () => {
    const outputDir = path.join(projectDir, '.cantonctl', 'diagnostics', 'splice-devnet')
    const auditDir = path.join(projectDir, '.cantonctl', 'control-plane')
    fs.mkdirSync(auditDir, {recursive: true})
    fs.writeFileSync(path.join(auditDir, 'last-operation.json'), JSON.stringify({
      command: 'deploy',
      context: {
        accessToken: 'top-secret',
        profile: {name: 'splice-devnet'},
      },
      mode: 'apply',
      recordedAt: '2026-04-06T22:00:00.000Z',
      rollout: {
        operation: 'deploy',
        partial: false,
        steps: [],
        success: true,
        summary: {blocked: 0, completed: 1, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
      },
      schemaVersion: 1,
      success: true,
    }, null, 2))

    class TestDiagnosticsBundle extends DiagnosticsBundle {
      protected override createDiagnosticsCollector() {
        return createDiagnosticsCollector({
          createProfileRuntimeResolver: () => createProfileRuntimeResolver({
            createBackendWithFallback: async () => ({backend: createInMemoryBackend(), isKeychain: false}),
            env: {CANTONCTL_JWT_SPLICE_DEVNET: 'jwt-token'},
          }),
        })
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig(scanServer.url)
      }
    }

    const result = await runInProject(projectDir, TestDiagnosticsBundle, [
      '--profile',
      'splice-devnet',
      '--output',
      outputDir,
      '--json',
    ])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      bundle: expect.objectContaining({
        outputDir,
      }),
      snapshot: expect.objectContaining({
        drift: expect.objectContaining({
          summary: expect.objectContaining({manualRunbooks: expect.any(Number)}),
        }),
        inventory: expect.objectContaining({
          mode: 'profile',
          profile: expect.objectContaining({name: 'splice-devnet'}),
        }),
        lastOperation: expect.objectContaining({
          command: 'deploy',
        }),
        metrics: expect.arrayContaining([
          expect.objectContaining({service: 'scan', status: 'available'}),
        ]),
      }),
    }))

    for (const file of [
      'profile.json',
      'auth.json',
      'compatibility.json',
      'services.json',
      'inventory.json',
      'drift.json',
      'health.json',
      'metrics.json',
      'validator-liveness.json',
      'last-operation.json',
    ]) {
      expect(fs.existsSync(path.join(outputDir, file))).toBe(true)
    }

    expect(fs.readFileSync(path.join(outputDir, 'last-operation.json'), 'utf8')).toContain('"accessToken": "[REDACTED]"')
  })
})
