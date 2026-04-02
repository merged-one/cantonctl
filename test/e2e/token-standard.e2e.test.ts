import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import TokenHoldings from '../../src/commands/token/holdings.js'
import TokenTransfer from '../../src/commands/token/transfer.js'
import ValidatorTrafficBuy from '../../src/commands/validator/traffic-buy.js'
import ValidatorTrafficStatus from '../../src/commands/validator/traffic-status.js'
import {
  TOKEN_HOLDING_INTERFACE_ID,
  TOKEN_TRANSFER_FACTORY_CHOICE,
  TOKEN_TRANSFER_FACTORY_INTERFACE_ID,
} from '../../src/lib/splice-public.js'

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

async function runInProject<T extends typeof TokenHoldings | typeof TokenTransfer | typeof ValidatorTrafficBuy | typeof ValidatorTrafficStatus>(
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

describe('stable token and validator-user surfaces E2E', () => {
  let ledgerServer: {close(): Promise<void>; url: string}
  let projectDir: string
  let tokenStandardServer: {close(): Promise<void>; url: string}
  let validatorServer: {close(): Promise<void>; url: string}
  let workDir: string
  const ledgerRequests: MockRequest[] = []
  const tokenStandardRequests: MockRequest[] = []
  const validatorRequests: MockRequest[] = []

  beforeAll(async () => {
    ledgerServer = await startJsonServer((request) => {
      ledgerRequests.push(request)

      if (request.method === 'GET' && request.pathname === '/v2/state/ledger-end') {
        return {body: {offset: 42}}
      }

      if (request.method === 'POST' && request.pathname === '/v2/state/active-contracts') {
        return {
          body: [
            {
              contractEntry: {
                JsActiveContract: {
                  createdEvent: {
                    contractId: 'holding-1',
                    interfaceViews: [
                      {
                        interfaceId: TOKEN_HOLDING_INTERFACE_ID,
                        viewStatus: {code: 0, message: 'OK'},
                        viewValue: {
                          amount: '5.0000000000',
                          instrumentId: {admin: 'Registry', id: 'USD'},
                          owner: 'Alice',
                        },
                      },
                    ],
                    templateId: 'Registry:UsdHolding',
                  },
                  synchronizerId: 'sync::1',
                },
              },
            },
            {
              contractEntry: {
                JsActiveContract: {
                  createdEvent: {
                    contractId: 'holding-2',
                    interfaceViews: [
                      {
                        interfaceId: TOKEN_HOLDING_INTERFACE_ID,
                        viewStatus: {code: 0, message: 'OK'},
                        viewValue: {
                          amount: '1.0000000000',
                          instrumentId: {admin: 'Other', id: 'EUR'},
                          owner: 'Alice',
                        },
                      },
                    ],
                    templateId: 'Other:EurHolding',
                  },
                  synchronizerId: 'sync::1',
                },
              },
            },
          ],
        }
      }

      if (request.method === 'POST' && request.pathname === '/v2/commands/submit-and-wait-for-transaction') {
        return {
          body: {
            transaction: {
              updateId: 'tx-1',
            },
          },
        }
      }

      return {body: {error: 'not found'}, status: 404}
    })

    tokenStandardServer = await startJsonServer((request) => {
      tokenStandardRequests.push(request)

      if (request.method === 'POST' && request.pathname === '/registry/transfer-instruction/v1/transfer-factory') {
        return {
          body: {
            choiceContext: {
              choiceContextData: {
                values: {
                  receiverDisclosure: {
                    AV_Party: 'Bob',
                  },
                },
              },
              disclosedContracts: [
                {
                  contractId: 'holding-1',
                  createdEventBlob: 'blob-1',
                  synchronizerId: 'sync::1',
                  templateId: TOKEN_HOLDING_INTERFACE_ID,
                },
              ],
            },
            factoryId: 'factory-1',
            transferKind: 'direct',
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

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-token-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-devnet

project:
  name: token-e2e
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    experimental: false
    kind: remote-validator
    ledger:
      url: ${ledgerServer.url}
    tokenStandard:
      url: ${tokenStandardServer.url}
    validator:
      url: ${validatorServer.url}/api/validator
`,
    )
  })

  afterAll(async () => {
    await ledgerServer?.close()
    await tokenStandardServer?.close()
    await validatorServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('token holdings reads stable holding interface views through ledger JSON API', async () => {
    ledgerRequests.length = 0

    const result = await runInProject(TokenHoldings, projectDir, [
      '--json',
      '--instrument-admin',
      'Registry',
      '--instrument-id',
      'USD',
      '--party',
      'Alice',
      '--token',
      'jwt-token',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: ledgerServer.url,
      holdings: [
        expect.objectContaining({
          amount: '5.0000000000',
          contractId: 'holding-1',
          owner: 'Alice',
        }),
      ],
      interfaceId: TOKEN_HOLDING_INTERFACE_ID,
    }))
    expect(ledgerRequests.map(request => request.pathname)).toEqual([
      '/v2/state/ledger-end',
      '/v2/state/active-contracts',
    ])
    expect(ledgerRequests[1].headers.authorization).toBe('Bearer jwt-token')
    expect(ledgerRequests[1].body).toEqual({
      activeAtOffset: 42,
      filter: {
        filtersByParty: {
          Alice: {
            cumulative: [
              {
                identifierFilter: {
                  InterfaceFilter: {
                    value: {
                      includeCreatedEventBlob: false,
                      includeInterfaceView: true,
                      interfaceId: TOKEN_HOLDING_INTERFACE_ID,
                    },
                  },
                },
              },
            ],
          },
        },
      },
      verbose: true,
    })
  })

  it('token transfer uses the stable transfer-factory flow instead of deprecated transfer offers', async () => {
    ledgerRequests.length = 0
    tokenStandardRequests.length = 0

    const result = await runInProject(TokenTransfer, projectDir, [
      '--json',
      '--amount',
      '10.5000000000',
      '--instrument-admin',
      'Registry',
      '--instrument-id',
      'USD',
      '--receiver',
      'Bob',
      '--sender',
      'Alice',
      '--token',
      'jwt-token',
    ])

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      endpoint: {
        ledger: ledgerServer.url,
        tokenStandard: tokenStandardServer.url,
      },
      factoryId: 'factory-1',
      transferKind: 'direct',
      transaction: {updateId: 'tx-1'},
    }))
    expect(tokenStandardRequests).toHaveLength(1)
    expect(tokenStandardRequests[0]).toEqual(expect.objectContaining({
      method: 'POST',
      pathname: '/registry/transfer-instruction/v1/transfer-factory',
    }))
    expect((tokenStandardRequests[0].body as {choiceArguments: Record<string, unknown>}).choiceArguments).toEqual(
      expect.objectContaining({
        expectedAdmin: 'Registry',
        transfer: expect.objectContaining({
          amount: '10.5000000000',
          receiver: 'Bob',
          sender: 'Alice',
        }),
      }),
    )
    expect(ledgerRequests[0]).toEqual(expect.objectContaining({
      method: 'POST',
      pathname: '/v2/commands/submit-and-wait-for-transaction',
    }))
    expect(ledgerRequests[0].headers.authorization).toBe('Bearer jwt-token')
    expect(ledgerRequests[0].body).toEqual({
      commands: expect.objectContaining({
        actAs: ['Alice'],
        commands: [
          {
            ExerciseCommand: expect.objectContaining({
              choice: TOKEN_TRANSFER_FACTORY_CHOICE,
              contractId: 'factory-1',
              templateId: TOKEN_TRANSFER_FACTORY_INTERFACE_ID,
            }),
          },
        ],
        disclosedContracts: [
          {
            contractId: 'holding-1',
            createdEventBlob: 'blob-1',
            synchronizerId: 'sync::1',
            templateId: TOKEN_HOLDING_INTERFACE_ID,
          },
        ],
      }),
    })
    expect(tokenStandardRequests.map(request => request.pathname)).not.toContain('/transfer-offer')
    expect(ledgerRequests.map(request => request.pathname)).not.toContain('/transfer-offer')
  })

  it('validator traffic buy and status use the stable wallet-backed validator-user endpoints', async () => {
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
