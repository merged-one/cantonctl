import {describe, expect, it, vi} from 'vitest'

import {
  createStableSplice,
  TOKEN_HOLDING_INTERFACE_ID,
  TOKEN_TRANSFER_FACTORY_CHOICE,
  TOKEN_TRANSFER_FACTORY_INTERFACE_ID,
} from './splice-public.js'

describe('createStableSplice', () => {
  it('hydrates token transfer submissions from the stable token-standard factory context', async () => {
    const tokenStandardAdapter = {
      families: {
        allocation: {family: 'allocation', requestJson: vi.fn(), requestOptionalJson: vi.fn(), sourceId: 'splice-token-allocation-openapi'},
        allocationInstruction: {family: 'allocationInstruction', requestJson: vi.fn(), requestOptionalJson: vi.fn(), sourceId: 'splice-token-allocation-instruction-openapi'},
        metadata: {family: 'metadata', requestJson: vi.fn(), requestOptionalJson: vi.fn(), sourceId: 'splice-token-metadata-openapi'},
        transferInstruction: {
          family: 'transferInstruction',
          requestJson: vi.fn().mockResolvedValue({
            choiceContext: {
              choiceContextData: {
                values: {
                  receiverDisclosure: {
                    AV_Party: 'Bob',
                  },
                },
              },
              disclosedContracts: [{
                contractId: 'holding-1',
                createdEventBlob: 'blob-1',
                synchronizerId: 'sync::1',
                templateId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
              }],
            },
            factoryId: 'factory-1',
            transferKind: 'direct',
          }),
          requestOptionalJson: vi.fn(),
          sourceId: 'splice-token-transfer-instruction-openapi',
        },
      },
      metadata: {
        baseUrl: 'https://tokens.example.com',
        families: [],
        service: 'tokenStandard',
        upstream: [],
        upstreamSourceIds: ['splice-token-transfer-instruction-openapi'],
        warnings: ['transport-only'],
      },
    }
    const ledgerAdapter = {
      metadata: {
        baseUrl: 'https://ledger.example.com',
        service: 'ledger',
        upstream: [],
        upstreamSourceIds: ['daml-json-ledger-api-openapi'],
        warnings: [],
      },
      submitAndWait: vi.fn().mockResolvedValue({transaction: {updateId: 'tx-1'}}),
    }

    const splice = createStableSplice({
      createLedgerAdapter: vi.fn().mockReturnValue(ledgerAdapter),
      createTokenStandardAdapter: vi.fn().mockReturnValue(tokenStandardAdapter),
      now: () => new Date('2026-04-02T20:00:00Z'),
    })

    const result = await splice.transferToken({
      amount: '10.5000000000',
      instrumentAdmin: 'Registry',
      instrumentId: 'USD',
      ledgerBaseUrl: 'https://ledger.example.com',
      sender: 'Alice',
      token: 'jwt-token',
      tokenStandardBaseUrl: 'https://tokens.example.com',
      receiver: 'Bob',
    })

    expect(tokenStandardAdapter.families.transferInstruction.requestJson).toHaveBeenCalledWith({
      body: {
        choiceArguments: {
          expectedAdmin: 'Registry',
          extraArgs: {
            context: {values: {}},
            meta: {values: {}},
          },
          transfer: {
            amount: '10.5000000000',
            executeBefore: '2026-04-02T20:15:00.000Z',
            inputHoldingCids: [],
            instrumentId: {
              admin: 'Registry',
              id: 'USD',
            },
            meta: {values: {}},
            receiver: 'Bob',
            requestedAt: '2026-04-02T20:00:00.000Z',
            sender: 'Alice',
          },
        },
      },
      method: 'POST',
      path: '/registry/transfer-instruction/v1/transfer-factory',
      signal: undefined,
    })
    expect(ledgerAdapter.submitAndWait).toHaveBeenCalledWith(expect.objectContaining({
      actAs: ['Alice'],
      commands: [{
        ExerciseCommand: {
          choice: TOKEN_TRANSFER_FACTORY_CHOICE,
          choiceArgument: {
            expectedAdmin: 'Registry',
            extraArgs: {
              context: {
                values: {
                  receiverDisclosure: {
                    AV_Party: 'Bob',
                  },
                },
              },
              meta: {values: {}},
            },
            transfer: expect.objectContaining({
              amount: '10.5000000000',
              receiver: 'Bob',
              sender: 'Alice',
            }),
          },
          contractId: 'factory-1',
          templateId: TOKEN_TRANSFER_FACTORY_INTERFACE_ID,
        },
      }],
      disclosedContracts: [{
        contractId: 'holding-1',
        createdEventBlob: 'blob-1',
        synchronizerId: 'sync::1',
        templateId: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
      }],
    }), undefined)
    expect(result.transferKind).toBe('direct')
    expect(result.transaction).toEqual({updateId: 'tx-1'})
    expect(result.warnings).toEqual(['transport-only'])
  })

  it('extracts stable holding interface views from ledger active contracts', async () => {
    const ledgerAdapter = {
      getActiveContracts: vi.fn().mockResolvedValue({
        activeContracts: [
          {
            contractId: 'holding-1',
            interfaceViews: [{
              interfaceId: TOKEN_HOLDING_INTERFACE_ID,
              viewStatus: {code: 0, message: 'OK'},
              viewValue: {
                amount: '5.0000000000',
                instrumentId: {admin: 'Registry', id: 'USD'},
                owner: 'Alice',
              },
            }],
            synchronizerId: 'sync::1',
            templateId: 'Registry:UsdHolding',
          },
          {
            contractId: 'holding-2',
            interfaceViews: [{
              interfaceId: TOKEN_HOLDING_INTERFACE_ID,
              viewStatus: {code: 0, message: 'OK'},
              viewValue: {
                amount: '7.0000000000',
                instrumentId: {admin: 'Other', id: 'EUR'},
                owner: 'Alice',
              },
            }],
            synchronizerId: 'sync::1',
            templateId: 'Registry:EurHolding',
          },
        ],
      }),
      metadata: {
        baseUrl: 'https://ledger.example.com',
        service: 'ledger',
        upstream: [],
        upstreamSourceIds: ['daml-json-ledger-api-openapi'],
        warnings: [],
      },
    }

    const splice = createStableSplice({
      createLedgerAdapter: vi.fn().mockReturnValue(ledgerAdapter),
    })

    const result = await splice.listTokenHoldings({
      instrumentAdmin: 'Registry',
      instrumentId: 'USD',
      ledgerBaseUrl: 'https://ledger.example.com',
      party: 'Alice',
      token: 'jwt-token',
    })

    expect(ledgerAdapter.getActiveContracts).toHaveBeenCalledWith({
      filter: {
        interfaceIds: [TOKEN_HOLDING_INTERFACE_ID],
        party: 'Alice',
      },
    }, undefined)
    expect(result.holdings).toEqual([{
      amount: '5.0000000000',
      contractId: 'holding-1',
      instrumentId: {admin: 'Registry', id: 'USD'},
      owner: 'Alice',
      synchronizerId: 'sync::1',
      templateId: 'Registry:UsdHolding',
    }])
  })

  it('falls back to scan-proxy for ANS listing when the owned-entry service is not configured', async () => {
    const scanProxyAdapter = {
      listAnsEntries: vi.fn().mockResolvedValue({
        entries: [{
          name: 'alice.unverified.ans',
          user: 'Alice',
        }],
      }),
      metadata: {
        baseUrl: 'https://validator.example.com/api/validator',
        service: 'scanProxy',
        upstream: [],
        upstreamSourceIds: ['splice-scan-proxy-openapi'],
        warnings: ['proxy-warning'],
      },
    }

    const splice = createStableSplice({
      createScanProxyAdapter: vi.fn().mockReturnValue(scanProxyAdapter),
    })

    const result = await splice.listAnsEntries({
      namePrefix: 'alice',
      profile: {
        experimental: true,
        kind: 'remote-validator',
        name: 'validator',
        services: {
          scanProxy: {url: 'https://validator.example.com/api/validator'},
        },
      },
      source: 'auto',
    })

    expect(scanProxyAdapter.listAnsEntries).toHaveBeenCalledWith({
      namePrefix: 'alice',
      pageSize: 20,
    }, undefined)
    expect(result.source).toBe('scanProxy')
    expect(result.warnings).toEqual(['proxy-warning'])
  })

  it('hydrates scan ACS queries from the latest snapshot timestamp when record time is omitted', async () => {
    const scanAdapter = {
      getAcsSnapshot: vi.fn().mockResolvedValue({
        created_events: [],
        migration_id: 7,
        record_time: '2026-04-02T20:10:00Z',
      }),
      getAcsSnapshotTimestampBefore: vi.fn().mockResolvedValue({
        record_time: '2026-04-02T20:10:00Z',
      }),
      metadata: {
        baseUrl: 'https://scan.example.com',
        generatedSpec: {sourceId: 'splice-scan-external-openapi'},
        service: 'scan',
        upstream: [],
        upstreamSourceIds: ['splice-scan-external-openapi'],
        warnings: [],
      },
    }

    const splice = createStableSplice({
      createScanAdapter: vi.fn().mockReturnValue(scanAdapter),
      now: () => new Date('2026-04-02T20:11:00Z'),
    })

    const result = await splice.getScanAcs({
      migrationId: 7,
      pageSize: 10,
      scanBaseUrl: 'https://scan.example.com',
    })

    expect(scanAdapter.getAcsSnapshotTimestampBefore).toHaveBeenCalledWith({
      before: '2026-04-02T20:11:00.000Z',
      migrationId: 7,
    }, undefined)
    expect(scanAdapter.getAcsSnapshot).toHaveBeenCalledWith({
      migration_id: 7,
      page_size: 10,
      record_time: '2026-04-02T20:10:00Z',
      record_time_match: 'exact',
    }, undefined)
    expect(result.snapshot.recordTime).toBe('2026-04-02T20:10:00Z')
  })
})
