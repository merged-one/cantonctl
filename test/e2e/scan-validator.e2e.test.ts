import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import ScanCurrentState from '../../src/commands/scan/current-state.js'
import ValidatorTrafficBuy from '../../src/commands/validator/traffic-buy.js'
import ValidatorTrafficStatus from '../../src/commands/validator/traffic-status.js'

const CLI_ROOT = process.cwd()

interface MockRequest {
  body: unknown
  headers: http.IncomingHttpHeaders
  method: string
  pathname: string
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

async function runInProject<T extends typeof ScanCurrentState | typeof ValidatorTrafficBuy | typeof ValidatorTrafficStatus>(
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

describe('splice-localnet scan and validator stable surfaces E2E', () => {
  let projectDir: string
  let scanServer: {close(): Promise<void>; url: string}
  let validatorServer: {close(): Promise<void>; url: string}
  let workDir: string
  const scanRequests: MockRequest[] = []
  const validatorRequests: MockRequest[] = []

  beforeAll(async () => {
    scanServer = await startJsonServer((request) => {
      scanRequests.push(request)

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
            open_mining_rounds: [{contract: 'open-1'}],
          },
        }
      }

      return {body: {error: 'not found'}, status: 404}
    })

    validatorServer = await startJsonServer((request) => {
      validatorRequests.push(request)

      if (
        request.method === 'POST'
        && request.pathname === '/api/validator/v0/wallet/buy-traffic-requests'
      ) {
        return {
          body: {
            request_contract_id: 'traffic-request-1',
          },
        }
      }

      if (
        request.method === 'POST'
        && request.pathname === '/api/validator/v0/wallet/buy-traffic-requests/traffic-123/status'
      ) {
        return {
          body: {
            status: 'completed',
            transaction_id: 'traffic-tx-1',
          },
        }
      }

      return {body: {error: 'not found'}, status: 404}
    })

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-scan-validator-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-localnet

project:
  name: scan-validator-e2e
  sdk-version: "3.4.11"

profiles:
  splice-localnet:
    experimental: false
    kind: splice-localnet
    localnet:
      distribution: splice-localnet
      version: "0.5.3"
    scan:
      url: ${scanServer.url}
    validator:
      url: ${validatorServer.url}/api/validator
`,
    )
  })

  afterAll(async () => {
    await scanServer?.close()
    await validatorServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('reads stable scan current-state through a splice-localnet profile', async () => {
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
      openMiningRounds: [{contract: 'open-1'}],
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

  it('uses the stable validator-user traffic endpoints from a splice-localnet profile', async () => {
    validatorRequests.length = 0

    const buyResult = await runInProject(ValidatorTrafficBuy, projectDir, [
      '--json',
      '--domain-id',
      'domain::1',
      '--receiving-validator-party-id',
      'AliceValidator',
      '--token',
      'jwt-token',
      '--tracking-id',
      'traffic-123',
      '--traffic-amount',
      '4096',
    ])

    expect(buyResult.error).toBeUndefined()

    const buyJson = parseJson(buyResult.stdout)
    expect(buyJson.success).toBe(true)
    expect(buyJson.data).toEqual(expect.objectContaining({
      endpoint: `${validatorServer.url}/api/validator`,
      requestContractId: 'traffic-request-1',
      source: 'validator-user',
      trackingId: 'traffic-123',
    }))
    expect(validatorRequests[0]).toEqual(expect.objectContaining({
      method: 'POST',
      pathname: '/api/validator/v0/wallet/buy-traffic-requests',
    }))
    expect(validatorRequests[0].headers.authorization).toBe('Bearer jwt-token')
    expect(validatorRequests[0].body).toEqual(expect.objectContaining({
      domain_id: 'domain::1',
      receiving_validator_party_id: 'AliceValidator',
      tracking_id: 'traffic-123',
      traffic_amount: 4096,
    }))

    const statusResult = await runInProject(ValidatorTrafficStatus, projectDir, [
      '--json',
      '--token',
      'jwt-token',
      '--tracking-id',
      'traffic-123',
    ])

    expect(statusResult.error).toBeUndefined()

    const statusJson = parseJson(statusResult.stdout)
    expect(statusJson.success).toBe(true)
    expect(statusJson.data).toEqual(expect.objectContaining({
      endpoint: `${validatorServer.url}/api/validator`,
      source: 'validator-user',
      status: {
        status: 'completed',
        transaction_id: 'traffic-tx-1',
      },
      trackingId: 'traffic-123',
    }))
    expect(validatorRequests[1]).toEqual(expect.objectContaining({
      method: 'POST',
      pathname: '/api/validator/v0/wallet/buy-traffic-requests/traffic-123/status',
    }))
  })
})
