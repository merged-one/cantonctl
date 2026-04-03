import {describe, expect, it, vi} from 'vitest'

import {
  createStableSplice,
  resolveStableSpliceProfile,
  TOKEN_HOLDING_INTERFACE_ID,
  TOKEN_TRANSFER_FACTORY_CHOICE,
  TOKEN_TRANSFER_FACTORY_INTERFACE_ID,
} from './splice-public.js'
import {ErrorCode} from './errors.js'

describe('createStableSplice', () => {
  it('requires an auth token for owned-entry ans writes', async () => {
    const splice = createStableSplice({
      createAnsAdapter: vi.fn(),
    })

    await expect(splice.createAnsEntry({
      description: 'Alice profile',
      name: 'alice.unverified.ans',
      url: 'https://alice.example.com',
    })).rejects.toMatchObject({code: ErrorCode.SERVICE_AUTH_FAILED})
  })

  it('creates validator traffic purchases with generated tracking ids and expiry windows', async () => {
    const adapter = {
      createBuyTrafficRequest: vi.fn().mockResolvedValue({request_contract_id: 'request-1'}),
      metadata: {
        baseUrl: 'https://validator.example.com',
        service: 'validator',
        upstream: [],
        upstreamSourceIds: ['splice-validator-internal-openapi'],
        warnings: ['operator-only'],
      },
    }

    const splice = createStableSplice({
      createValidatorUserAdapter: vi.fn().mockReturnValue(adapter),
      now: () => new Date('2026-04-02T20:00:00Z'),
    })

    const result = await splice.createTrafficBuy({
      domainId: 'domain::1',
      receivingValidatorPartyId: 'AliceValidator',
      token: 'jwt-token',
      trafficAmount: 4096,
    })

    expect(adapter.createBuyTrafficRequest).toHaveBeenCalledWith({
      domain_id: 'domain::1',
      expires_at: 1775160900000000,
      receiving_validator_party_id: 'AliceValidator',
      tracking_id: 'cantonctl-traffic-1775160000000',
      traffic_amount: 4096,
    }, undefined)
    expect(result).toEqual({
      endpoint: 'https://validator.example.com',
      requestContractId: 'request-1',
      source: 'validator-user',
      status: {status: 'created'},
      trackingId: 'cantonctl-traffic-1775160000000',
      warnings: ['operator-only'],
    })
  })

  it('creates owned ans entries through the ans surface', async () => {
    const adapter = {
      createEntry: vi.fn().mockResolvedValue({
        contract_id: 'ans-1',
        name: 'alice.unverified.ans',
        url: 'https://alice.example.com',
      }),
      metadata: {
        baseUrl: 'https://ans.example.com',
        service: 'ans',
        upstream: [],
        upstreamSourceIds: ['splice-ans-external-openapi'],
        warnings: ['owned-entry'],
      },
    }

    const splice = createStableSplice({
      createAnsAdapter: vi.fn().mockReturnValue(adapter),
    })

    const result = await splice.createAnsEntry({
      ansBaseUrl: 'https://ans.example.com',
      description: 'Alice profile',
      name: 'alice.unverified.ans',
      token: 'jwt-token',
      url: 'https://alice.example.com',
    })

    expect(adapter.createEntry).toHaveBeenCalledWith({
      description: 'Alice profile',
      name: 'alice.unverified.ans',
      url: 'https://alice.example.com',
    }, undefined)
    expect(result).toEqual({
      endpoint: 'https://ans.example.com',
      response: {
        contract_id: 'ans-1',
        name: 'alice.unverified.ans',
        url: 'https://alice.example.com',
      },
      source: 'ans',
      warnings: ['owned-entry'],
    })
  })

  it('rejects invalid traffic expiry timestamps', async () => {
    const splice = createStableSplice({
      createValidatorUserAdapter: vi.fn(),
    })

    await expect(splice.createTrafficBuy({
      domainId: 'domain::1',
      expiresAt: 'not-a-date',
      receivingValidatorPartyId: 'AliceValidator',
      token: 'jwt-token',
      trafficAmount: 10,
    })).rejects.toMatchObject({code: ErrorCode.CONFIG_SCHEMA_VIOLATION})
  })

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

  it('lists scan updates through the stable scan surface', async () => {
    const scanAdapter = {
      getUpdateHistory: vi.fn().mockResolvedValue({
        raw: {cursor: 'next'},
        updates: [{update_id: 'update-1'}],
      }),
      metadata: {
        baseUrl: 'https://scan.example.com',
        service: 'scan',
        upstream: [],
        upstreamSourceIds: ['splice-scan-external-openapi'],
        warnings: ['scan-warning'],
      },
    }

    const splice = createStableSplice({
      createScanAdapter: vi.fn().mockReturnValue(scanAdapter),
    })

    const result = await splice.listScanUpdates({
      after: {migrationId: 7, recordTime: '2026-04-02T20:00:00Z'},
      pageSize: 5,
      scanBaseUrl: 'https://scan.example.com',
    })

    expect(scanAdapter.getUpdateHistory).toHaveBeenCalledWith({
      after: {
        after_migration_id: 7,
        after_record_time: '2026-04-02T20:00:00Z',
      },
      page_size: 5,
    }, undefined)
    expect(result).toEqual({
      endpoint: 'https://scan.example.com',
      raw: {cursor: 'next'},
      source: 'scan',
      updates: [{update_id: 'update-1'}],
      warnings: ['scan-warning'],
    })
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

  it('drops contracts without a readable holding interface view', async () => {
    const ledgerAdapter = {
      getActiveContracts: vi.fn().mockResolvedValue({
        activeContracts: [
          {
            contractId: 'holding-1',
            interfaceViews: [{
              interfaceId: '#other-interface',
              viewStatus: {code: 0, message: 'OK'},
              viewValue: {ignored: true},
            }],
          },
          {
            contractId: 'holding-2',
            interfaceViews: [{
              interfaceId: TOKEN_HOLDING_INTERFACE_ID,
              viewStatus: {code: 0, message: 'OK'},
              viewValue: {
                amount: '8.0000000000',
                instrumentId: {admin: 'Registry', id: 'USD'},
                owner: 'Alice',
              },
            }],
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
      ledgerBaseUrl: 'https://ledger.example.com',
      party: 'Alice',
      token: 'jwt-token',
    })

    expect(result.holdings).toEqual([
      expect.objectContaining({contractId: 'holding-2'}),
    ])
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

  it('uses the provided scan record time and normalizes created events', async () => {
    const scanAdapter = {
      getAcsSnapshot: vi.fn().mockResolvedValue({
        created_events: [{
          contract_id: 'cid-1',
          created_at: '2026-04-02T20:00:00Z',
          create_arguments: {owner: 'Alice'},
          observers: ['Bob'],
          signatories: ['Alice'],
          template_id: 'Main:Iou',
        }],
        migration_id: 7,
        next_page_token: 11,
        record_time: '2026-04-02T20:10:00Z',
      }),
      getAcsSnapshotTimestampBefore: vi.fn(),
      metadata: {
        baseUrl: 'https://scan.example.com',
        generatedSpec: {sourceId: 'splice-scan-external-openapi'},
        service: 'scan',
        upstream: [],
        upstreamSourceIds: ['splice-scan-external-openapi'],
        warnings: ['scan-acs'],
      },
    }

    const splice = createStableSplice({
      createScanAdapter: vi.fn().mockReturnValue(scanAdapter),
    })

    const result = await splice.getScanAcs({
      migrationId: 7,
      pageSize: 10,
      partyIds: ['Alice'],
      recordTime: '2026-04-02T20:09:00Z',
      recordTimeMatch: 'at_or_before',
      scanBaseUrl: 'https://scan.example.com',
      templates: ['Main:Iou'],
    })

    expect(scanAdapter.getAcsSnapshotTimestampBefore).not.toHaveBeenCalled()
    expect(scanAdapter.getAcsSnapshot).toHaveBeenCalledWith({
      after: undefined,
      migration_id: 7,
      page_size: 10,
      party_ids: ['Alice'],
      record_time: '2026-04-02T20:09:00Z',
      record_time_match: 'at_or_before',
      templates: ['Main:Iou'],
    }, undefined)
    expect(result.createdEvents).toEqual([{
      contractId: 'cid-1',
      createdAt: '2026-04-02T20:00:00Z',
      observers: ['Bob'],
      payload: {owner: 'Alice'},
      signatories: ['Alice'],
      templateId: 'Main:Iou',
    }])
    expect(result.nextPageToken).toBe(11)
    expect(result.warnings).toEqual(['scan-acs'])
  })

  it('uses scan for current-state reads when the scan service is configured', async () => {
    const scanAdapter = {
      getDsoInfo: vi.fn().mockResolvedValue({dso_party_id: 'DSO::1220'}),
      getOpenAndIssuingMiningRounds: vi.fn().mockResolvedValue({
        issuing_mining_rounds: [{round: 1}],
        open_mining_rounds: [{round: 2}],
      }),
      metadata: {
        baseUrl: 'https://scan.example.com',
        service: 'scan',
        upstream: [],
        upstreamSourceIds: ['splice-scan-external-openapi'],
        warnings: ['scan-current-state'],
      },
    }

    const splice = createStableSplice({
      createScanAdapter: vi.fn().mockReturnValue(scanAdapter),
    })

    const result = await splice.getScanCurrentState({
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    })

    expect(scanAdapter.getOpenAndIssuingMiningRounds).toHaveBeenCalledWith({
      cached_issuing_round_contract_ids: [],
      cached_open_mining_round_contract_ids: [],
    }, undefined)
    expect(result.source).toBe('scan')
    expect(result.warnings).toEqual(['scan-current-state'])
  })

  it('uses scan-proxy for current-state reads when scan is unavailable', async () => {
    const scanProxyAdapter = {
      getDsoInfo: vi.fn().mockResolvedValue({dso_party_id: 'DSO::1220'}),
      getOpenAndIssuingMiningRounds: vi.fn().mockResolvedValue({
        issuing_mining_rounds: [{round: 1}],
        open_mining_rounds: [{round: 2}],
      }),
      metadata: {
        baseUrl: 'https://scan-proxy.example.com',
        service: 'scanProxy',
        upstream: [],
        upstreamSourceIds: ['splice-scan-proxy-openapi'],
        warnings: ['fallback'],
      },
    }

    const splice = createStableSplice({
      createScanProxyAdapter: vi.fn().mockReturnValue(scanProxyAdapter),
    })

    const result = await splice.getScanCurrentState({
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.example.com'},
          scanProxy: {url: 'https://scan-proxy.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    })

    expect(result).toEqual({
      dsoInfo: {dso_party_id: 'DSO::1220'},
      endpoint: 'https://scan-proxy.example.com',
      issuingMiningRounds: [{round: 1}],
      openMiningRounds: [{round: 2}],
      source: 'scanProxy',
      warnings: ['fallback'],
    })
  })

  it('looks up public ans entries by party through the scan surface', async () => {
    const scanAdapter = {
      listAnsEntries: vi.fn(),
      lookupAnsEntryByName: vi.fn(),
      lookupAnsEntryByParty: vi.fn().mockResolvedValue({
        entry: {
          contract_id: 'ans-1',
          description: 'Alice profile',
          name: 'alice.unverified.ans',
          url: 'https://alice.example.com',
          user: 'Alice',
        },
      }),
      metadata: {
        baseUrl: 'https://scan.example.com',
        service: 'scan',
        upstream: [],
        upstreamSourceIds: ['splice-scan-external-openapi'],
        warnings: [],
      },
    }

    const splice = createStableSplice({
      createScanAdapter: vi.fn().mockReturnValue(scanAdapter),
    })

    const result = await splice.listAnsEntries({
      party: 'Alice',
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    })

    expect(scanAdapter.lookupAnsEntryByParty).toHaveBeenCalledWith('Alice', undefined)
    expect(result.entries).toEqual([
      expect.objectContaining({
        contractId: 'ans-1',
        name: 'alice.unverified.ans',
        user: 'Alice',
      }),
    ])
  })

  it('lists public ans entries through the scan surface when a prefix query is used', async () => {
    const scanAdapter = {
      listAnsEntries: vi.fn().mockResolvedValue({
        entries: [{
          contract_id: 'ans-1',
          name: 'alice.unverified.ans',
          user: 'Alice',
        }],
      }),
      lookupAnsEntryByName: vi.fn(),
      lookupAnsEntryByParty: vi.fn(),
      metadata: {
        baseUrl: 'https://scan.example.com',
        service: 'scan',
        upstream: [],
        upstreamSourceIds: ['splice-scan-external-openapi'],
        warnings: [],
      },
    }

    const splice = createStableSplice({
      createScanAdapter: vi.fn().mockReturnValue(scanAdapter),
    })

    const result = await splice.listAnsEntries({
      namePrefix: 'alice',
      pageSize: 5,
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      source: 'scan',
    })

    expect(scanAdapter.listAnsEntries).toHaveBeenCalledWith({
      namePrefix: 'alice',
      pageSize: 5,
    }, undefined)
    expect(result.entries).toEqual([
      expect.objectContaining({contractId: 'ans-1', name: 'alice.unverified.ans'}),
    ])
  })

  it('uses the owned ans service when requested explicitly even for party queries', async () => {
    const ansAdapter = {
      listEntries: vi.fn().mockResolvedValue({
        entries: [{
          amount: '1.0',
          contractId: 'ans-2',
          name: 'alice.unverified.ans',
        }],
      }),
      metadata: {
        baseUrl: 'https://ans.example.com',
        service: 'ans',
        upstream: [],
        upstreamSourceIds: ['splice-ans-external-openapi'],
        warnings: [],
      },
    }

    const splice = createStableSplice({
      createAnsAdapter: vi.fn().mockReturnValue(ansAdapter),
    })

    const result = await splice.listAnsEntries({
      party: 'Alice',
      source: 'ans',
      token: 'jwt-token',
    })

    expect(ansAdapter.listEntries).toHaveBeenCalledWith(undefined)
    expect(result.source).toBe('ans')
    expect(result.entries).toEqual([
      expect.objectContaining({contractId: 'ans-2', name: 'alice.unverified.ans'}),
    ])
  })

  it('throws when a traffic request status cannot be found', async () => {
    const adapter = {
      getBuyTrafficRequestStatus: vi.fn().mockResolvedValue(null),
      metadata: {
        baseUrl: 'https://validator.example.com',
        service: 'validator',
        upstream: [],
        upstreamSourceIds: ['splice-validator-internal-openapi'],
        warnings: [],
      },
    }

    const splice = createStableSplice({
      createValidatorUserAdapter: vi.fn().mockReturnValue(adapter),
    })

    await expect(splice.getTrafficRequestStatus({
      token: 'jwt-token',
      trackingId: 'missing-1',
      validatorBaseUrl: 'https://validator.example.com',
    })).rejects.toMatchObject({code: ErrorCode.SERVICE_REQUEST_FAILED})
  })

  it('returns validator traffic request status when present', async () => {
    const adapter = {
      getBuyTrafficRequestStatus: vi.fn().mockResolvedValue({status: 'pending'}),
      metadata: {
        baseUrl: 'https://validator.example.com',
        service: 'validator',
        upstream: [],
        upstreamSourceIds: ['splice-validator-internal-openapi'],
        warnings: ['operator'],
      },
    }

    const splice = createStableSplice({
      createValidatorUserAdapter: vi.fn().mockReturnValue(adapter),
    })

    const result = await splice.getTrafficRequestStatus({
      token: 'jwt-token',
      trackingId: 'tracking-1',
      validatorBaseUrl: 'https://validator.example.com',
    })

    expect(result).toEqual({
      endpoint: 'https://validator.example.com',
      source: 'validator-user',
      status: {status: 'pending'},
      trackingId: 'tracking-1',
      warnings: ['operator'],
    })
  })
})

describe('resolveStableSpliceProfile', () => {
  it('normalizes the selected profile into adapter context', () => {
    const profile = resolveStableSpliceProfile({
      'default-profile': 'splice-devnet',
      profiles: {
        'splice-devnet': {
          experimental: false,
          kind: 'remote-validator',
          name: 'splice-devnet',
          services: {
            ledger: {url: 'https://ledger.example.com'},
            scan: {url: 'https://scan.example.com'},
            validator: {url: 'https://validator.example.com'},
          },
        },
      },
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    })

    expect(profile).toEqual({
      experimental: false,
      kind: 'remote-validator',
      name: 'splice-devnet',
      services: {
        ledger: {url: 'https://ledger.example.com'},
        scan: {url: 'https://scan.example.com'},
        validator: {url: 'https://validator.example.com'},
      },
    })
  })
})
