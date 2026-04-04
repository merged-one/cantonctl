import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import AnsList from '../../src/commands/ans/list.js'
import ScanCurrentState from '../../src/commands/scan/current-state.js'

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

async function runInProject<T extends typeof AnsList | typeof ScanCurrentState>(
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

describe('experimental scan-proxy E2E', () => {
  let projectDir: string
  let scanProxyServer: {close(): Promise<void>; url: string}
  let workDir: string
  const scanProxyRequests: MockRequest[] = []

  beforeAll(async () => {
    scanProxyServer = await startJsonServer((request) => {
      scanProxyRequests.push(request)

      if (request.method === 'GET' && request.pathname === '/api/validator/v0/scan-proxy/dso') {
        return {
          body: {
            dso_party_id: 'DSO::1',
            sv_party_id: 'SV::1',
          },
        }
      }

      if (
        request.method === 'GET'
        && request.pathname === '/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds'
      ) {
        return {
          body: {
            issuing_mining_rounds: [{contract: 'issuing-1'}],
            open_mining_rounds: [{contract: 'open-1'}, {contract: 'open-2'}],
          },
        }
      }

      if (request.method === 'GET' && request.pathname === '/api/validator/v0/scan-proxy/ans-entries') {
        return {
          body: {
            entries: [
              {
                contract_id: 'public-ans-1',
                description: 'Alice profile',
                name: 'alice.unverified.ans',
                url: 'https://alice.example.com',
                user: 'Alice',
              },
            ],
          },
        }
      }

      return {body: {error: 'not found'}, status: 404}
    })

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-scan-proxy-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-proxy

project:
  name: scan-proxy-e2e
  sdk-version: "3.4.11"

profiles:
  splice-proxy:
    experimental: true
    kind: remote-validator
    scanProxy:
      url: ${scanProxyServer.url}/api/validator
`,
    )
  })

  afterAll(async () => {
    await scanProxyServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('reads current state through scan-proxy when the experimental surface is selected', async () => {
    scanProxyRequests.length = 0

    const result = await runInProject(ScanCurrentState, projectDir, [
      '--json',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: `${scanProxyServer.url}/api/validator`,
      source: 'scanProxy',
    }))
    expect(scanProxyRequests.map(request => request.pathname)).toEqual([
      '/api/validator/v0/scan-proxy/dso',
      '/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds',
    ])
  })

  it('reads ANS entries through scan-proxy only when explicitly selected', async () => {
    scanProxyRequests.length = 0

    const result = await runInProject(AnsList, projectDir, [
      '--json',
      '--name-prefix',
      'alice',
      '--source',
      'scanProxy',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: `${scanProxyServer.url}/api/validator`,
      source: 'scanProxy',
      entries: [
        expect.objectContaining({
          contractId: 'public-ans-1',
          name: 'alice.unverified.ans',
          user: 'Alice',
        }),
      ],
    }))
    expect(scanProxyRequests[0]).toEqual(expect.objectContaining({
      method: 'GET',
      pathname: '/api/validator/v0/scan-proxy/ans-entries',
    }))
    expect(scanProxyRequests[0].searchParams.get('name_prefix')).toBe('alice')
    expect(scanProxyRequests[0].searchParams.get('page_size')).toBe('20')
  })
})
