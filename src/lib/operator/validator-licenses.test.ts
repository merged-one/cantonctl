import {describe, expect, it, vi} from 'vitest'

import type {ScanAdapter} from '../adapters/index.js'
import {createOperatorValidatorLicenses} from './validator-licenses.js'
import type {ResolvedOperatorSurface} from '../operator-surface.js'

function createSurface(): ResolvedOperatorSurface {
  return {
    commandPath: 'operator validator licenses',
    definition: {
      commandPath: 'operator validator licenses',
      description: 'Read approved validator licenses from the explicit Scan admin surface.',
      lifecycleOwners: ['official-remote-runtime'],
      managementClasses: ['read-only'],
      mutationScopes: ['observed'],
      profileKinds: ['remote-validator', 'remote-sv-network'],
      service: 'scan',
      sourceIds: ['splice-scan-external-openapi'],
      stabilities: ['stable-external'],
    },
    endpoint: 'https://scan.example.com',
    runtime: {
      auth: {
        operator: {
          description: 'operator',
          envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
          keychainAccount: 'operator:splice-devnet',
          localFallbackAllowed: false,
          prerequisites: [],
          required: true,
          scope: 'operator',
        },
        warnings: ['auth-warning'],
      },
      capabilities: [],
      compatibility: {
        checks: [],
        failed: 0,
        passed: 0,
        profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'},
        services: [],
        warned: 0,
      },
      credential: {
        mode: 'env-or-keychain-jwt',
        network: 'splice-devnet',
        scope: 'app',
        source: 'stored',
        token: 'app-token',
      },
      inventory: {} as never,
      networkName: 'splice-devnet',
      operatorCredential: {
        mode: 'env-or-keychain-jwt',
        network: 'splice-devnet',
        scope: 'operator',
        source: 'stored',
        token: 'operator-token',
      },
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          scan: {url: 'https://scan.example.com'},
        },
      },
      profileContext: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          scan: {url: 'https://scan.example.com'},
        },
      },
      services: [],
    } as unknown as ResolvedOperatorSurface['runtime'],
    service: {
      controlPlane: {
        endpointProvenance: 'declared',
        lifecycleOwner: 'official-remote-runtime',
        managementClass: 'read-only',
        mutationScope: 'observed',
        operatorSurface: false,
      },
      detail: 'Scan endpoint',
      endpoint: 'https://scan.example.com',
      name: 'scan',
      sourceIds: ['splice-scan-external-openapi'],
      stability: 'stable-external',
    },
    surfaceId: 'validator-licenses',
  }
}

describe('createOperatorValidatorLicenses', () => {
  it('lists validator licenses with surface metadata and deduped warnings', async () => {
    const listValidatorLicenses = vi.fn().mockResolvedValue({
      next_page_token: 41,
      validator_licenses: [
        {
          contract_id: 'cid-1',
          created_at: '2026-04-06T20:00:00Z',
          payload: {validator: 'AliceValidator'},
          template_id: 'Splice.ValidatorLicense:ValidatorLicense',
        },
        {
          contractId: 'cid-2',
          createdAt: '2026-04-06T20:01:00Z',
          create_arguments: {validator_party_id: 'BobValidator'},
          templateId: 'Splice.ValidatorLicense:ValidatorLicense',
        },
      ],
    })
    const createScanAdapter = vi.fn().mockReturnValue({
      listValidatorLicenses,
      metadata: {
        baseUrl: 'https://scan.example.com',
        warnings: ['transport-warning', 'auth-warning'],
      },
    } as unknown as ScanAdapter)

    const result = await createOperatorValidatorLicenses({createScanAdapter}).list({
      after: 20,
      limit: 10,
      surface: createSurface(),
    })

    expect(createScanAdapter).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://scan.example.com',
      token: 'operator-token',
    }))
    expect(listValidatorLicenses).toHaveBeenCalledWith({after: 20, limit: 10}, undefined)
    expect(result.surface).toEqual(expect.objectContaining({
      commandPath: 'operator validator licenses',
      service: 'scan',
      stability: 'stable-external',
      upstreamSourceIds: ['splice-scan-external-openapi'],
    }))
    expect(result.licenses).toEqual([
      {
        contractId: 'cid-1',
        createdAt: '2026-04-06T20:00:00Z',
        payload: {validator: 'AliceValidator'},
        templateId: 'Splice.ValidatorLicense:ValidatorLicense',
      },
      {
        contractId: 'cid-2',
        createdAt: '2026-04-06T20:01:00Z',
        payload: {validator_party_id: 'BobValidator'},
        templateId: 'Splice.ValidatorLicense:ValidatorLicense',
      },
    ])
    expect(result.nextPageToken).toBe(41)
    expect(result.warnings).toEqual(['auth-warning', 'transport-warning'])
  })

  it('handles malformed scan responses conservatively', async () => {
    const createScanAdapter = vi.fn().mockReturnValue({
      listValidatorLicenses: vi.fn().mockResolvedValue({
        nextPageToken: 5,
        validator_licenses: [null],
      }),
      metadata: {
        baseUrl: 'https://scan.example.com',
        warnings: [],
      },
    } as unknown as ScanAdapter)

    const result = await createOperatorValidatorLicenses({createScanAdapter}).list({
      surface: createSurface(),
    })

    expect(result.licenses).toEqual([{}])
    expect(result.nextPageToken).toBe(5)
    expect(result.warnings).toEqual(['auth-warning'])
  })

  it('treats record responses without a validator license array as empty', async () => {
    const createScanAdapter = vi.fn().mockReturnValue({
      listValidatorLicenses: vi.fn().mockResolvedValue({
        next_page_token: 9,
        validator_licenses: 'unexpected-shape',
      }),
      metadata: {
        baseUrl: 'https://scan.example.com',
        warnings: [],
      },
    } as unknown as ScanAdapter)

    const result = await createOperatorValidatorLicenses({createScanAdapter}).list({
      surface: createSurface(),
    })

    expect(result.licenses).toEqual([])
    expect(result.nextPageToken).toBe(9)
    expect(result.warnings).toEqual(['auth-warning'])
  })

  it('covers the default scan adapter path and non-record responses', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify('not-json'), {
        headers: {'Content-Type': 'application/json'},
        status: 200,
      }),
    ) as typeof globalThis.fetch

    try {
      const result = await createOperatorValidatorLicenses().list({
        surface: createSurface(),
      })

      expect(result.endpoint).toBe('https://scan.example.com')
      expect(result.licenses).toEqual([])
      expect(result.nextPageToken).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
