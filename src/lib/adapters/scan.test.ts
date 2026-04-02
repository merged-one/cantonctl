import {describe, expect, it, vi} from 'vitest'

import {createScanAdapter} from './scan.js'

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
})
