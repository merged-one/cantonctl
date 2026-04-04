import {describe, expect, it, vi} from 'vitest'

import {createLedgerAdapter, normalizeLedgerActiveContractsResponse} from './ledger.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

describe('createLedgerAdapter', () => {
  it('resolves the ledger endpoint from a profile and issues version requests there', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({version: '3.4.11'}))

    const adapter = createLedgerAdapter({
      fetch,
      profile: {
        experimental: false,
        kind: 'sandbox',
        name: 'local',
        services: {
          ledger: {'json-api-port': 7575},
        },
      },
      token: 'jwt-token',
    })

    await adapter.getVersion()

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:7575/v2/version',
      expect.objectContaining({
        headers: expect.objectContaining({Authorization: 'Bearer jwt-token'}),
        method: 'GET',
      }),
    )
  })

  it('wraps submitAndWait in the generated request envelope', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({
      transaction: {transactionId: 'tx-1'},
    }))

    const adapter = createLedgerAdapter({
      baseUrl: 'https://ledger.example.com',
      fetch,
      token: 'jwt-token',
    })

    await adapter.submitAndWait({
      actAs: ['Alice'],
      commandId: 'cmd-1',
      commands: [{createCommand: {templateId: 'Main:Token'}}],
      userId: 'alice-user',
    })

    const [, init] = fetch.mock.calls[0]
    expect(fetch.mock.calls[0][0]).toBe('https://ledger.example.com/v2/commands/submit-and-wait-for-transaction')
    expect(JSON.parse(String(init.body))).toEqual({
      commands: {
        actAs: ['Alice'],
        commandId: 'cmd-1',
        commands: [{createCommand: {templateId: 'Main:Token'}}],
        readAs: undefined,
        submissionId: undefined,
        synchronizerId: undefined,
        userId: 'alice-user',
        workflowId: undefined,
      },
    })
  })

  it('normalizes active contract snapshots from the Canton response shape', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({offset: 42}))
      .mockResolvedValueOnce(createJsonResponse([
        {
          contractEntry: {
            JsActiveContract: {
              createdEvent: {
                contractId: 'cid-1',
                createArgument: {owner: 'Alice'},
                createdAt: '2026-04-02T20:00:00Z',
                offset: 42,
                templateId: 'Main:Token',
              },
            },
          },
        },
      ]))

    const adapter = createLedgerAdapter({
      baseUrl: 'https://ledger.example.com',
      fetch,
      token: 'jwt-token',
    })

    const result = await adapter.getActiveContracts({
      filter: {party: 'Alice', templateIds: ['Main:Token', 'Main:Offer']},
    })

    expect(result.activeContracts).toEqual([{
      contractId: 'cid-1',
      createdAt: '2026-04-02T20:00:00Z',
      offset: 42,
      payload: {owner: 'Alice'},
      templateId: 'Main:Token',
    }])

    const [, init] = fetch.mock.calls[1]
    expect(fetch.mock.calls[1][0]).toBe('https://ledger.example.com/v2/state/active-contracts')
    expect(JSON.parse(String(init.body))).toEqual({
      activeAtOffset: 42,
      filter: {
        filtersByParty: {
          Alice: {
            cumulative: [
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: {
                      includeCreatedEventBlob: false,
                      templateId: 'Main:Token',
                    },
                  },
                },
              },
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: {
                      includeCreatedEventBlob: false,
                      templateId: 'Main:Offer',
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

  it('supports interface filters and preserves interface views for stable Daml interface lookups', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({offset: 42}))
      .mockResolvedValueOnce(createJsonResponse([
        {
          contractEntry: {
            JsActiveContract: {
              createdEvent: {
                contractId: 'cid-1',
                createArgument: {raw: true},
                createdAt: '2026-04-02T20:00:00Z',
                interfaceViews: [
                  {
                    interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
                    viewStatus: {code: 0, message: 'OK'},
                    viewValue: {
                      amount: '10.0000000000',
                      instrumentId: {admin: 'Registry', id: 'USD'},
                      owner: 'Alice',
                    },
                  },
                ],
                templateId: 'Registry:Holding',
              },
              synchronizerId: 'sync::1',
            },
          },
        },
      ]))

    const adapter = createLedgerAdapter({
      baseUrl: 'https://ledger.example.com',
      fetch,
      token: 'jwt-token',
    })

    const result = await adapter.getActiveContracts({
      filter: {
        interfaceIds: ['#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding'],
        party: 'Alice',
      },
    })

    expect(result.activeContracts).toEqual([{
      contractId: 'cid-1',
      createdAt: '2026-04-02T20:00:00Z',
      interfaceViews: [
        {
          interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
          viewStatus: {code: 0, message: 'OK'},
          viewValue: {
            amount: '10.0000000000',
            instrumentId: {admin: 'Registry', id: 'USD'},
            owner: 'Alice',
          },
        },
      ],
      offset: undefined,
      payload: {raw: true},
      synchronizerId: 'sync::1',
      templateId: 'Registry:Holding',
    }])

    const [, init] = fetch.mock.calls[1]
    expect(JSON.parse(String(init.body))).toEqual({
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
                      interfaceId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
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

  it('forwards disclosed contracts for interface-choice submissions', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({
      transaction: {transactionId: 'tx-2'},
    }))

    const adapter = createLedgerAdapter({
      baseUrl: 'https://ledger.example.com',
      fetch,
      token: 'jwt-token',
    })

    await adapter.submitAndWait({
      actAs: ['Alice'],
      commandId: 'cmd-token-transfer',
      commands: [{
        ExerciseCommand: {
          choice: 'TransferFactory_Transfer',
          choiceArgument: {expectedAdmin: 'Registry'},
          contractId: 'factory-1',
          templateId: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
        },
      }],
      disclosedContracts: [{
        contractId: 'disclosed-1',
        createdEventBlob: 'blob-1',
        synchronizerId: 'sync::1',
        templateId: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
      }],
      userId: 'alice-user',
    })

    const [, init] = fetch.mock.calls[0]
    expect(JSON.parse(String(init.body))).toEqual({
      commands: {
        actAs: ['Alice'],
        commandId: 'cmd-token-transfer',
        commands: [{
          ExerciseCommand: {
            choice: 'TransferFactory_Transfer',
            choiceArgument: {expectedAdmin: 'Registry'},
            contractId: 'factory-1',
            templateId: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
          },
        }],
        disclosedContracts: [{
          contractId: 'disclosed-1',
          createdEventBlob: 'blob-1',
          synchronizerId: 'sync::1',
          templateId: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
        }],
        packageIdSelectionPreference: undefined,
        readAs: undefined,
        submissionId: undefined,
        synchronizerId: undefined,
        userId: 'alice-user',
        workflowId: undefined,
      },
    })
  })

  it('uses wildcard active-contract filters and tolerates sparse party and dar payloads', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({partyDetails: {identifier: 'Alice::1224'}}))
      .mockResolvedValueOnce(createJsonResponse({partyDetails: 'invalid'}))
      .mockResolvedValueOnce(createJsonResponse({partyDetails: 'invalid'}))
      .mockResolvedValueOnce(createJsonResponse({
        partyDetails: [{displayName: 'Alice'}, null, 'bad'],
      }))
      .mockResolvedValueOnce(createJsonResponse({offset: 42}))
      .mockResolvedValueOnce(createJsonResponse({transaction: 'invalid'}))
      .mockResolvedValueOnce(createJsonResponse({}))
      .mockResolvedValueOnce(createJsonResponse([
        {},
        null,
        {contractEntry: {}},
        {contractEntry: {JsActiveContract: {}}},
      ]))
      .mockResolvedValueOnce(createJsonResponse({}))

    const adapter = createLedgerAdapter({
      baseUrl: 'https://ledger.example.com',
      fetch,
      token: 'jwt-token',
    })

    await expect(adapter.allocateParty({displayName: 'Alice'})).resolves.toEqual({
      partyDetails: {identifier: 'Alice::1224'},
    })
    await expect(adapter.allocateParty({displayName: 'Alice'})).resolves.toEqual({
      partyDetails: {},
    })
    await expect(adapter.getParties()).resolves.toEqual({
      partyDetails: [],
    })
    await expect(adapter.getParties()).resolves.toEqual({
      partyDetails: [{displayName: 'Alice'}],
    })
    await expect(adapter.getLedgerEnd()).resolves.toEqual({offset: 42})
    await expect(adapter.submitAndWait({
      actAs: ['Alice'],
      commandId: 'cmd-1',
      commands: [],
      userId: 'alice-user',
    })).resolves.toEqual({
      transaction: {},
    })

    const contracts = await adapter.getActiveContracts({filter: {party: 'Alice'}})
    expect(contracts.activeContracts).toEqual([])

    const [, init] = fetch.mock.calls[7]
    expect(JSON.parse(String(init.body))).toEqual({
      activeAtOffset: 0,
      filter: {
        filtersByParty: {
          Alice: {
            cumulative: [{
              identifierFilter: {
                WildcardFilter: {
                  value: {
                    includeCreatedEventBlob: false,
                  },
                },
              },
            }],
          },
        },
      },
      verbose: true,
    })

    await expect(adapter.uploadDar(new Uint8Array([1, 2, 3]))).resolves.toEqual({
      mainPackageId: undefined,
    })

    expect(normalizeLedgerActiveContractsResponse(null)).toEqual([])
  })
})

describe('normalizeLedgerActiveContractsResponse', () => {
  it('ignores incomplete or unsupported contract entries', () => {
    expect(normalizeLedgerActiveContractsResponse([
      {contractEntry: {JsEmpty: {}}},
      {contractEntry: {JsActiveContract: {}}},
      {contractEntry: {JsActiveContract: {createdEvent: {contractId: 'cid-1'}}}},
    ])).toEqual([{
      contractId: 'cid-1',
      createdAt: undefined,
      interfaceViews: undefined,
      offset: undefined,
      payload: undefined,
      synchronizerId: undefined,
      templateId: undefined,
    }])
  })
})
