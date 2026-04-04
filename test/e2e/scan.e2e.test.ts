import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import ScanAcs from '../../src/commands/scan/acs.js'
import ScanCurrentState from '../../src/commands/scan/current-state.js'
import ScanUpdates from '../../src/commands/scan/updates.js'

const CLI_ROOT = process.cwd()

interface MockRequest {
  body: unknown
  headers: http.IncomingHttpHeaders
  method: string
  pathname: string
  searchParams: URLSearchParams
}

interface MockResponse {
  body: unknown
  status?: number
}

async function startJsonServer(
  handler: (request: MockRequest) => Promise<MockResponse> | MockResponse,
): Promise<{close(): Promise<void>; url: string}> {
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const text = Buffer.concat(chunks).toString('utf8')
    let body: unknown
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const result = await handler({
      body,
      headers: request.headers,
      method: request.method ?? 'GET',
      pathname: url.pathname,
      searchParams: url.searchParams,
    })

    response.statusCode = result.status ?? 200
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(result.body))
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

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function writeConfig(projectDir: string, contents: string): void {
  fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), contents)
}

async function runInProject<T extends typeof ScanUpdates | typeof ScanAcs | typeof ScanCurrentState>(
  command: T,
  projectDir: string,
  args: string[],
): Promise<{error?: Error; stderr: string; stdout: string}> {
  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir)

  try {
    return await captureOutput(() => command.run(args, {root: CLI_ROOT}))
  } finally {
    cwdSpy.mockRestore()
  }
}

describe('stable scan surface E2E', () => {
  let projectDir: string
  let workDir: string
  let scanServer: {close(): Promise<void>; url: string}
  const scanRequests: MockRequest[] = []

  beforeAll(async () => {
    scanServer = await startJsonServer((request) => {
      scanRequests.push(request)

      if (request.method === 'POST' && request.pathname === '/v2/updates') {
        return {
          body: {
            transactions: [
              {
                events_by_id: {
                  e1: {ignored: true},
                  e2: {ignored: true},
                },
                extra_template_field: {ignored: true},
                migration_id: 7,
                record_time: '2026-04-02T20:00:00Z',
                root_event_ids: ['e1'],
                update_id: 'update-1',
              },
            ],
          },
        }
      }

      if (request.method === 'GET' && request.pathname === '/v0/state/acs/snapshot-timestamp') {
        return {
          body: {
            migration_id: 7,
            record_time: '2026-04-02T20:10:00Z',
          },
        }
      }

      if (request.method === 'POST' && request.pathname === '/v0/state/acs') {
        return {
          body: {
            created_events: [
              {
                contract_id: 'contract-1',
                create_arguments: {
                  payload: {
                    owner: 'Alice',
                  },
                },
                created_at: '2026-04-02T20:10:05Z',
                signatories: ['Alice'],
                template_id: 'Splice.Scan:Snapshot',
                unknown_field: {ignored: true},
              },
            ],
            migration_id: 7,
            next_page_token: 11,
            record_time: '2026-04-02T20:10:00Z',
          },
        }
      }

      if (request.method === 'GET' && request.pathname === '/v0/dso') {
        return {
          body: {
            dso_party_id: 'DSO::1',
            sv_party_id: 'SV::1',
          },
        }
      }

      if (request.method === 'POST' && request.pathname === '/v0/open-and-issuing-mining-rounds') {
        return {
          body: {
            issuing_mining_rounds: [{contract: 'issuing-1'}],
            open_mining_rounds: [{contract: 'open-1'}, {contract: 'open-2'}],
          },
        }
      }

      return {body: {error: 'not found'}, status: 404}
    })

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-scan-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-devnet

project:
  name: scan-e2e
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    experimental: false
    kind: remote-validator
    scan:
      url: ${scanServer.url}
`,
    )
  })

  afterAll(async () => {
    await scanServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('scan updates reads stable history through the configured scan profile', async () => {
    scanRequests.length = 0

    const result = await runInProject(ScanUpdates, projectDir, [
      '--json',
      '--after-migration-id',
      '7',
      '--after-record-time',
      '2026-04-02T19:59:00Z',
      '--page-size',
      '2',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: scanServer.url,
      source: 'scan',
      updates: [
        expect.objectContaining({
          eventCount: 2,
          kind: 'transaction',
          migrationId: 7,
          recordTime: '2026-04-02T20:00:00Z',
          rootEventCount: 1,
          updateId: 'update-1',
        }),
      ],
    }))
    expect(scanRequests[0]).toEqual(expect.objectContaining({
      method: 'POST',
      pathname: '/v2/updates',
    }))
    expect(scanRequests[0].body).toEqual({
      after: {
        after_migration_id: 7,
        after_record_time: '2026-04-02T19:59:00Z',
      },
      page_size: 2,
    })
  })

  it('scan acs resolves snapshot timestamps before reading a stable ACS page', async () => {
    scanRequests.length = 0

    const result = await runInProject(ScanAcs, projectDir, [
      '--json',
      '--migration-id',
      '7',
      '--page-size',
      '5',
      '--party-id',
      'Alice',
      '--template',
      'Splice.Scan:Snapshot',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: scanServer.url,
      nextPageToken: 11,
      snapshot: {
        migrationId: 7,
        recordTime: '2026-04-02T20:10:00Z',
      },
      source: 'scan',
    }))
    expect(scanRequests[0]).toEqual(expect.objectContaining({
      method: 'GET',
      pathname: '/v0/state/acs/snapshot-timestamp',
    }))
    expect(scanRequests[0].searchParams.get('migration_id')).toBe('7')
    expect(scanRequests[1]).toEqual(expect.objectContaining({
      method: 'POST',
      pathname: '/v0/state/acs',
    }))
    expect(scanRequests[1].body).toEqual({
      after: undefined,
      migration_id: 7,
      page_size: 5,
      party_ids: ['Alice'],
      record_time: '2026-04-02T20:10:00Z',
      record_time_match: 'exact',
      templates: ['Splice.Scan:Snapshot'],
    })
  })

  it('scan current-state reads stable public state directly from scan', async () => {
    scanRequests.length = 0

    const result = await runInProject(ScanCurrentState, projectDir, [
      '--json',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      dsoInfo: {
        dso_party_id: 'DSO::1',
        sv_party_id: 'SV::1',
      },
      endpoint: scanServer.url,
      issuingMiningRounds: [{contract: 'issuing-1'}],
      openMiningRounds: [{contract: 'open-1'}, {contract: 'open-2'}],
      source: 'scan',
    }))
    expect(scanRequests.map(request => request.pathname)).toEqual([
      '/v0/dso',
      '/v0/open-and-issuing-mining-rounds',
    ])
    expect(scanRequests[1].body).toEqual({
      cached_issuing_round_contract_ids: [],
      cached_open_mining_round_contract_ids: [],
    })
  })
})
