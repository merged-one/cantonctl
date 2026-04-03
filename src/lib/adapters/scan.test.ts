import {describe, expect, it, vi} from 'vitest'

import {
  createScanAdapter,
  normalizeScanUpdateHistoryItem,
  normalizeScanUpdateHistoryResponse,
} from './scan.js'

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'Content-Type': 'application/json'},
    status,
  })
}

describe('createScanAdapter', () => {
  it('resolves a scan profile endpoint and normalizes bulk update history tolerantly', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({
      transactions: [
        {
          events_by_id: {
            '0': {event_type: 'created_event'},
            '1': {event_type: 'created_event'},
          },
          external_transaction_hash: '0xabc',
          migration_id: 7,
          record_time: '2026-04-02T20:10:00Z',
          root_event_ids: ['0'],
          update_id: 'update-1',
        },
        {
          event: {migration_id: 8, target_synchronizer: 'sync-2'},
          record_time: '2026-04-02T20:11:00Z',
          update_id: 'update-2',
        },
        {
          something_else: true,
        },
      ],
    }))

    const adapter = createScanAdapter({
      fetch,
      profile: {
        experimental: false,
        kind: 'remote-sv-network',
        name: 'sv',
        services: {
          scan: {url: 'https://scan.example.com'},
        },
      },
    })

    const result = await adapter.getUpdateHistory({page_size: 50})

    expect(fetch.mock.calls[0][0]).toBe('https://scan.example.com/v2/updates')
    expect(result.updates).toEqual([
      {
        eventCount: 2,
        externalTransactionHash: '0xabc',
        kind: 'transaction',
        migrationId: 7,
        recordTime: '2026-04-02T20:10:00Z',
        rootEventCount: 1,
        updateId: 'update-1',
      },
      {
        eventCount: undefined,
        externalTransactionHash: undefined,
        kind: 'reassignment',
        migrationId: 8,
        recordTime: '2026-04-02T20:11:00Z',
        rootEventCount: undefined,
        updateId: 'update-2',
      },
      {
        kind: 'unknown',
        migrationId: undefined,
        recordTime: undefined,
        updateId: undefined,
        eventCount: undefined,
        externalTransactionHash: undefined,
        rootEventCount: undefined,
      },
    ])
  })

  it('passes validator license pagination parameters through as query params', async () => {
    const fetch = vi.fn().mockResolvedValue(createJsonResponse({validator_licenses: []}))

    const adapter = createScanAdapter({
      baseUrl: 'https://scan.example.com',
      fetch,
    })

    await adapter.listValidatorLicenses({after: 10, limit: 25})

    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.pathname).toBe('/v0/admin/validator/licenses')
    expect(url.searchParams.get('after')).toBe('10')
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('supports ANS lookups and ACS snapshot queries on stable scan endpoints', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({
        entry: {
          name: 'alice.unverified.ans',
          user: 'Alice',
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        record_time: '2026-04-02T20:15:00Z',
      }))
      .mockResolvedValueOnce(createJsonResponse({
        created_events: [
          {
            contract_id: 'cid-1',
            created_at: '2026-04-02T20:15:00Z',
            template_id: 'Pkg:Main:Entry',
          },
        ],
        migration_id: 7,
        record_time: '2026-04-02T20:15:00Z',
      }))

    const adapter = createScanAdapter({
      baseUrl: 'https://scan.example.com',
      fetch,
    })

    const entry = await adapter.lookupAnsEntryByName('alice.unverified.ans')
    const snapshot = await adapter.getAcsSnapshotTimestampBefore({
      before: '2026-04-02T20:16:00Z',
      migrationId: 7,
    })
    const acs = await adapter.getAcsSnapshot({
      migration_id: 7,
      page_size: 25,
      record_time: snapshot.record_time,
      record_time_match: 'exact',
    })

    expect(entry).toEqual({
      entry: {
        name: 'alice.unverified.ans',
        user: 'Alice',
      },
    })
    expect(fetch.mock.calls[0][0]).toBe(
      'https://scan.example.com/v0/ans-entries/by-name/alice.unverified.ans',
    )
    expect(fetch.mock.calls[1][0]).toBe(
      'https://scan.example.com/v0/state/acs/snapshot-timestamp?before=2026-04-02T20%3A16%3A00Z&migration_id=7',
    )
    expect(fetch.mock.calls[2][0]).toBe('https://scan.example.com/v0/state/acs')
    expect(JSON.parse(String(fetch.mock.calls[2][1].body))).toEqual({
      migration_id: 7,
      page_size: 25,
      record_time: '2026-04-02T20:15:00Z',
      record_time_match: 'exact',
    })
    expect(acs.created_events[0].contract_id).toBe('cid-1')
  })

  it('lists scan resources and normalizes invalid update payloads conservatively', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({entries: []}))
      .mockResolvedValueOnce(createJsonResponse({scans: [{name: 'sv'}]}))
      .mockResolvedValueOnce(createJsonResponse({rounds: []}))
      .mockResolvedValueOnce(createJsonResponse({sv_party_id: 'sv::1224'}))
      .mockResolvedValueOnce(createJsonResponse({open_mining_rounds: [], issuing_mining_rounds: []}))
      .mockResolvedValueOnce(new Response('', {status: 404}))

    const adapter = createScanAdapter({
      baseUrl: 'https://scan.example.com',
      fetch,
    })

    await adapter.listAnsEntries({pageSize: 10})
    await adapter.listDsoScans()
    await adapter.getClosedRounds()
    await adapter.getDsoInfo()
    await adapter.getOpenAndIssuingMiningRounds({
      cached_issuing_round_contract_ids: [],
      cached_open_mining_round_contract_ids: [],
    })
    await expect(adapter.lookupAnsEntryByParty('Alice/Operator')).resolves.toBeNull()

    expect(fetch.mock.calls[0][0]).toBe('https://scan.example.com/v0/ans-entries?page_size=10')
    expect(fetch.mock.calls[1][0]).toBe('https://scan.example.com/v0/scans')
    expect(fetch.mock.calls[2][0]).toBe('https://scan.example.com/v0/closed-rounds')
    expect(fetch.mock.calls[3][0]).toBe('https://scan.example.com/v0/dso')
    expect(fetch.mock.calls[4][0]).toBe('https://scan.example.com/v0/open-and-issuing-mining-rounds')
    expect(JSON.parse(String(fetch.mock.calls[4][1].body))).toEqual({
      cached_issuing_round_contract_ids: [],
      cached_open_mining_round_contract_ids: [],
    })
    expect(fetch.mock.calls[5][0]).toBe(
      'https://scan.example.com/v0/ans-entries/by-party/Alice%2FOperator',
    )

    expect(normalizeScanUpdateHistoryResponse(null)).toEqual([])
    expect(normalizeScanUpdateHistoryItem(null)).toEqual({kind: 'unknown'})
  })
})
