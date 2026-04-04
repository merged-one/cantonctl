import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../config.js'
import type {ProfileRuntimeResolver} from '../profile-runtime.js'
import {createPreflightChecks} from './checks.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    networkProfiles: {devnet: 'splice-devnet', mainnet: 'splice-mainnet', testnet: 'splice-testnet'},
    networks: {
      devnet: {auth: 'jwt', type: 'remote'},
      mainnet: {auth: 'jwt', type: 'remote'},
      testnet: {auth: 'jwt', type: 'remote'},
    },
    profiles: {
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.devnet.example.com'},
          ledger: {url: 'https://ledger.devnet.example.com'},
          scan: {url: 'https://scan.devnet.example.com'},
          validator: {url: 'https://validator.devnet.example.com'},
        },
      },
      'splice-mainnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-mainnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.mainnet.example.com'},
          ledger: {url: 'https://ledger.mainnet.example.com'},
          scan: {url: 'https://scan.mainnet.example.com'},
        },
      },
      'splice-testnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-testnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.testnet.example.com'},
          ledger: {url: 'https://ledger.testnet.example.com'},
          scan: {url: 'https://scan.testnet.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createRuntimeResolver(overrides: Partial<Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>> = {}): () => ProfileRuntimeResolver {
  return () => ({
    resolve: vi.fn().mockResolvedValue({
      auth: {
        description: 'Resolve a JWT from the environment first, then the OS keychain.',
        envVarName: 'CANTONCTL_JWT_DEVNET',
        experimental: false,
        mode: 'env-or-keychain-jwt',
        network: 'devnet',
        requiresExplicitExperimental: false,
        warnings: [],
      },
      compatibility: {
        checks: [],
        failed: 0,
        passed: 2,
        profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'},
        services: [],
        warned: 0,
      },
      credential: {
        mode: 'env-or-keychain-jwt',
        network: 'devnet',
        source: 'stored',
        token: 'jwt-token',
      },
      networkName: 'devnet',
      profile: createConfig().profiles!['splice-devnet'],
      profileContext: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: createConfig().profiles!['splice-devnet'].services,
      },
      ...overrides,
    }),
  })
}

describe('preflight checks', () => {
  it('reports a passing remote-validator profile with visible egress IP', async () => {
    const createScanAdapter = vi.fn().mockReturnValue({
      getDsoInfo: vi.fn().mockResolvedValue({sv_party_id: 'sv::1'}),
      metadata: {baseUrl: 'https://scan.devnet.example.com'},
    })
    const fetch = vi.fn().mockResolvedValue(new Response('', {status: 404}))
    const runner = createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver(),
      createScanAdapter,
      fetch,
      lookupEgressIp: vi.fn().mockResolvedValue('203.0.113.10'),
    })

    const report = await runner.run({config: createConfig(), profileName: 'splice-devnet'})
    expect(report.success).toBe(true)
    expect(report.egressIp).toBe('203.0.113.10')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Profile resolution', status: 'pass'}),
      expect.objectContaining({name: 'Scan reachability', status: 'pass'}),
      expect.objectContaining({name: 'Credential material', status: 'pass'}),
      expect.objectContaining({name: 'Egress IP visibility', status: 'pass'}),
    ]))
  })

  it('fails when auth coherence is missing for a remote profile', async () => {
    const runner = createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver({
        auth: {
          description: 'Resolve a JWT from the environment first, then the OS keychain.',
          envVarName: 'CANTONCTL_JWT_DEVNET',
          experimental: false,
          mode: 'env-or-keychain-jwt',
          network: 'devnet',
          requiresExplicitExperimental: false,
          warnings: [],
        },
        credential: {
          mode: 'env-or-keychain-jwt',
          network: 'devnet',
          source: 'missing',
        },
      }),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch: vi.fn().mockResolvedValue(new Response('', {status: 404})),
      lookupEgressIp: vi.fn().mockResolvedValue(undefined),
    })

    const report = await runner.run({config: createConfig(), profileName: 'splice-devnet'})
    expect(report.success).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Credential material', status: 'fail'}),
    ]))
  })

  it('fails when the scan endpoint cannot be reached', async () => {
    const runner = createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch: vi.fn().mockResolvedValue(new Response('', {status: 404})),
      lookupEgressIp: vi.fn().mockResolvedValue('203.0.113.10'),
    })

    await expect(runner.run({config: createConfig(), profileName: 'splice-devnet'})).rejects.toThrow('connect ECONNREFUSED')
  })

  it('returns network-specific reset expectations', async () => {
    const createScanAdapter = vi.fn().mockReturnValue({
      getDsoInfo: vi.fn().mockResolvedValue({}),
      metadata: {baseUrl: 'https://scan.example.com'},
    })
    const fetch = vi.fn().mockResolvedValue(new Response('', {status: 404}))
    const lookupEgressIp = vi.fn().mockResolvedValue('203.0.113.10')

    const devnet = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver(),
      createScanAdapter,
      fetch,
      lookupEgressIp,
    }).run({config: createConfig(), profileName: 'splice-devnet'})

    const testnet = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver({
        auth: {
          description: 'Resolve a JWT from the environment first, then the OS keychain.',
          envVarName: 'CANTONCTL_JWT_TESTNET',
          experimental: false,
          mode: 'env-or-keychain-jwt',
          network: 'testnet',
          requiresExplicitExperimental: false,
          warnings: [],
        },
        credential: {mode: 'env-or-keychain-jwt', network: 'testnet', source: 'stored', token: 'token'},
        networkName: 'testnet',
        profile: createConfig().profiles!['splice-testnet'],
        profileContext: {
          experimental: false,
          kind: 'remote-validator',
          name: 'splice-testnet',
          services: createConfig().profiles!['splice-testnet'].services,
        },
      }),
      createScanAdapter,
      fetch,
      lookupEgressIp,
    }).run({config: createConfig(), profileName: 'splice-testnet'})

    const mainnet = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver({
        auth: {
          description: 'Resolve a JWT from the environment first, then the OS keychain.',
          envVarName: 'CANTONCTL_JWT_MAINNET',
          experimental: false,
          mode: 'env-or-keychain-jwt',
          network: 'mainnet',
          requiresExplicitExperimental: false,
          warnings: [],
        },
        credential: {mode: 'env-or-keychain-jwt', network: 'mainnet', source: 'stored', token: 'token'},
        networkName: 'mainnet',
        profile: createConfig().profiles!['splice-mainnet'],
        profileContext: {
          experimental: false,
          kind: 'remote-validator',
          name: 'splice-mainnet',
          services: createConfig().profiles!['splice-mainnet'].services,
        },
      }),
      createScanAdapter,
      fetch,
      lookupEgressIp,
    }).run({config: createConfig(), profileName: 'splice-mainnet'})

    expect(devnet.network.resetExpectation).toBe('resets-expected')
    expect(testnet.network.resetExpectation).toBe('resets-expected')
    expect(mainnet.network.resetExpectation).toBe('no-resets-expected')
  })
})
