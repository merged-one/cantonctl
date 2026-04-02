import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import AnsCreate from '../../src/commands/ans/create.js'
import AnsList from '../../src/commands/ans/list.js'

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

async function runInProject<T extends typeof AnsList | typeof AnsCreate>(
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

describe('stable ANS surface E2E', () => {
  let ansServer: {close(): Promise<void>; url: string}
  let projectDir: string
  let scanProxyServer: {close(): Promise<void>; url: string}
  let workDir: string
  const ansRequests: MockRequest[] = []
  const scanProxyRequests: MockRequest[] = []

  beforeAll(async () => {
    ansServer = await startJsonServer((request) => {
      ansRequests.push(request)

      if (request.method === 'GET' && request.pathname === '/v0/entry/all') {
        return {
          body: {
            entries: [
              {
                amount: '12.0000000000',
                contractId: 'ans-entry-1',
                expiresAt: '2026-05-01T00:00:00Z',
                name: 'alice.unverified.ans',
                paymentDuration: 'P30D',
                paymentInterval: 'P30D',
                unit: 'AMU',
              },
            ],
          },
        }
      }

      if (request.method === 'POST' && request.pathname === '/v0/entry/create') {
        return {
          body: {
            entryContextCid: 'entry-context-1',
            name: 'alice.unverified.ans',
            subscriptionRequestCid: 'subscription-1',
          },
        }
      }

      return {body: {error: 'not found'}, status: 404}
    })

    scanProxyServer = await startJsonServer((request) => {
      scanProxyRequests.push(request)

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

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-ans-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-ans

project:
  name: ans-e2e
  sdk-version: "3.4.11"

profiles:
  splice-ans:
    experimental: false
    kind: remote-validator
    ans:
      url: ${ansServer.url}
  splice-proxy:
    experimental: true
    kind: remote-validator
    scanProxy:
      url: ${scanProxyServer.url}/api/validator
`,
    )
  })

  afterAll(async () => {
    await ansServer?.close()
    await scanProxyServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('ans list reads owned entries from the stable ANS service', async () => {
    ansRequests.length = 0

    const result = await runInProject(AnsList, projectDir, [
      '--json',
      '--profile',
      'splice-ans',
      '--token',
      'jwt-token',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: ansServer.url,
      source: 'ans',
      entries: [
        expect.objectContaining({
          contractId: 'ans-entry-1',
          name: 'alice.unverified.ans',
        }),
      ],
    }))
    expect(ansRequests[0]).toEqual(expect.objectContaining({
      method: 'GET',
      pathname: '/v0/entry/all',
    }))
    expect(ansRequests[0].headers.authorization).toBe('Bearer jwt-token')
  })

  it('ans create writes through the stable external ANS endpoint', async () => {
    ansRequests.length = 0

    const result = await runInProject(AnsCreate, projectDir, [
      '--json',
      '--profile',
      'splice-ans',
      '--description',
      'Alice profile',
      '--name',
      'alice.unverified.ans',
      '--token',
      'jwt-token',
      '--url',
      'https://alice.example.com',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: ansServer.url,
      response: expect.objectContaining({
        entryContextCid: 'entry-context-1',
        subscriptionRequestCid: 'subscription-1',
      }),
      source: 'ans',
    }))
    expect(ansRequests[0]).toEqual(expect.objectContaining({
      method: 'POST',
      pathname: '/v0/entry/create',
    }))
    expect(ansRequests[0].headers.authorization).toBe('Bearer jwt-token')
    expect(ansRequests[0].body).toEqual({
      description: 'Alice profile',
      name: 'alice.unverified.ans',
      url: 'https://alice.example.com',
    })
  })

  it('ans list can read public entries through scan-proxy when that stable surface is selected', async () => {
    scanProxyRequests.length = 0

    const result = await runInProject(AnsList, projectDir, [
      '--json',
      '--name-prefix',
      'alice',
      '--profile',
      'splice-proxy',
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
