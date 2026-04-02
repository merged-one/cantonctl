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
})

describe('normalizeLedgerActiveContractsResponse', () => {
  it('ignores incomplete or unsupported contract entries', () => {
    expect(normalizeLedgerActiveContractsResponse([
      {contractEntry: {JsEmpty: {}}},
      {contractEntry: {JsActiveContract: {}}},
      {contractEntry: {JsActiveContract: {createdEvent: {contractId: 'cid-1'}}}},
    ])).toEqual([{contractId: 'cid-1', createdAt: undefined, offset: undefined, payload: undefined, templateId: undefined}])
  })
})
