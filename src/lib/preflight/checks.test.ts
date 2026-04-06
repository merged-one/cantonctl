import {afterEach, describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../config.js'
import {CantonctlError, ErrorCode} from '../errors.js'
import type {ProfileRuntimeResolver} from '../profile-runtime.js'
import * as profileRuntimeModule from '../profile-runtime.js'
import * as scanAdapterModule from '../adapters/scan.js'
import {createPreflightChecks} from './checks.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
  const auth = createResolvedAuth({
    credentialSource: 'stored',
    network: 'devnet',
  })

  return () => ({
    resolve: vi.fn().mockResolvedValue({
      auth,
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
        scope: 'app',
        source: 'stored',
        token: 'jwt-token',
      },
      operatorCredential: {
        mode: 'env-or-keychain-jwt',
        network: 'devnet',
        scope: 'operator',
        source: 'stored',
        token: 'operator-token',
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

function createResolvedAuth(options: {
  credentialSource: 'env' | 'fallback' | 'missing' | 'stored'
  operatorCredentialSource?: 'env' | 'fallback' | 'missing' | 'stored'
  mode?: 'bearer-token' | 'env-or-keychain-jwt'
  network: string
}) {
  const mode = options.mode ?? 'env-or-keychain-jwt'
  const isLocal = options.credentialSource === 'fallback'
  return {
    app: {
      description: mode === 'bearer-token'
        ? 'Use an explicitly supplied bearer token or a local fallback token.'
        : 'Resolve a JWT from the environment first, then the OS keychain.',
      envVarName: `CANTONCTL_JWT_${options.network.toUpperCase().replace(/-/g, '_')}`,
      keychainAccount: options.network,
      localFallbackAllowed: isLocal,
      prerequisites: [],
      required: !isLocal,
      scope: 'app' as const,
    },
    authKind: isLocal ? 'shared-secret' as const : 'jwt' as const,
    description: mode === 'bearer-token'
      ? 'Use an explicitly supplied bearer token or a local fallback token.'
      : 'Resolve a JWT from the environment first, then the OS keychain.',
    envVarName: `CANTONCTL_JWT_${options.network.toUpperCase().replace(/-/g, '_')}`,
    experimental: false,
    mode,
    network: options.network,
    operator: {
      description: isLocal
        ? 'Use the generated local fallback token for companion-managed local control-plane actions.'
        : 'Use an explicitly supplied operator JWT for remote control-plane mutations.',
      envVarName: `CANTONCTL_OPERATOR_TOKEN_${options.network.toUpperCase().replace(/-/g, '_')}`,
      keychainAccount: `operator:${options.network}`,
      localFallbackAllowed: isLocal,
      prerequisites: isLocal ? [] : ['Store an operator credential explicitly before remote mutations.'],
      required: !isLocal,
      scope: 'operator' as const,
    },
    requiresExplicitExperimental: false,
    warnings: [],
  }
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
      expect.objectContaining({name: 'App credential material', status: 'pass'}),
      expect.objectContaining({name: 'Operator credential material', status: 'pass'}),
      expect.objectContaining({name: 'Egress IP visibility', status: 'pass'}),
    ]))
  })

  it('fails when auth coherence is missing for a remote profile', async () => {
    const runner = createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver({
        auth: createResolvedAuth({credentialSource: 'missing', operatorCredentialSource: 'missing', network: 'devnet'}),
        credential: {
          mode: 'env-or-keychain-jwt',
          network: 'devnet',
          scope: 'app',
          source: 'missing',
        },
        operatorCredential: {
          mode: 'env-or-keychain-jwt',
          network: 'devnet',
          scope: 'operator',
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
      expect.objectContaining({name: 'App credential material', status: 'fail'}),
      expect.objectContaining({name: 'Operator credential material', status: 'fail'}),
    ]))
  })

  it('warns when compatibility has warnings but no failures', async () => {
    const runner = createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver({
        compatibility: {
          checks: [],
          failed: 0,
          passed: 1,
          profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'},
          services: [],
          warned: 2,
        },
      }),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch: vi.fn().mockResolvedValue(new Response('', {status: 404})),
      lookupEgressIp: vi.fn().mockResolvedValue('203.0.113.10'),
    })

    const report = await runner.run({config: createConfig(), profileName: 'splice-devnet'})
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'Compatibility baseline passed with 2 warning(s).',
        name: 'Compatibility baseline',
        status: 'warn',
      }),
    ]))
  })

  it('warns when the resolved auth profile itself is experimental', async () => {
    const runner = createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver({
        auth: {
          ...createResolvedAuth({credentialSource: 'stored', operatorCredentialSource: 'stored', mode: 'bearer-token', network: 'devnet'}),
          experimental: true,
        },
      }),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch: vi.fn().mockResolvedValue(new Response('', {status: 404})),
      lookupEgressIp: vi.fn().mockResolvedValue('203.0.113.10'),
    })

    const report = await runner.run({config: createConfig(), profileName: 'splice-devnet'})
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'Use an explicitly supplied bearer token or a local fallback token. CANTONCTL_JWT_DEVNET',
        name: 'Auth mode',
        status: 'warn',
      }),
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
        auth: createResolvedAuth({credentialSource: 'stored', operatorCredentialSource: 'stored', network: 'testnet'}),
        credential: {mode: 'env-or-keychain-jwt', network: 'testnet', scope: 'app', source: 'stored', token: 'token'},
        operatorCredential: {mode: 'env-or-keychain-jwt', network: 'testnet', scope: 'operator', source: 'stored', token: 'operator-token'},
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
        auth: createResolvedAuth({credentialSource: 'stored', operatorCredentialSource: 'stored', network: 'mainnet'}),
        credential: {mode: 'env-or-keychain-jwt', network: 'mainnet', scope: 'app', source: 'stored', token: 'token'},
        operatorCredential: {mode: 'env-or-keychain-jwt', network: 'mainnet', scope: 'operator', source: 'stored', token: 'operator-token'},
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

  it('uses default runtime, scan, and egress helpers when deps are omitted', async () => {
    vi.spyOn(profileRuntimeModule, 'createProfileRuntimeResolver').mockReturnValue(createRuntimeResolver()())
    vi.spyOn(scanAdapterModule, 'createScanAdapter').mockReturnValue({
      getDsoInfo: vi.fn().mockResolvedValue({sv_party_id: 'sv::1'}),
      metadata: {baseUrl: 'https://scan.devnet.example.com'},
    } as never)

    const fetch = vi.fn().mockImplementation(async (input: string) => {
      if (input.startsWith('https://api.ipify.org')) {
        return new Response(JSON.stringify({ip: '203.0.113.10'}), {status: 200})
      }

      return new Response('', {status: 404})
    })

    const report = await createPreflightChecks({fetch}).run({config: createConfig(), profileName: 'splice-devnet'})
    expect(report.egressIp).toBe('203.0.113.10')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Scan reachability', status: 'pass'}),
    ]))
  })

  it('covers missing scan, local-only health skips, and scan auth failures', async () => {
    const missingScan = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver({
        profile: {
          ...createConfig().profiles!['splice-devnet'],
          services: {
            auth: {kind: 'jwt', url: 'https://auth.devnet.example.com'},
            ledger: {url: 'https://ledger.devnet.example.com'},
          },
        },
        profileContext: {
          experimental: false,
          kind: 'remote-validator',
          name: 'splice-devnet',
          services: {
            auth: {kind: 'jwt', url: 'https://auth.devnet.example.com'},
            ledger: {url: 'https://ledger.devnet.example.com'},
          },
        },
      }),
      fetch: vi.fn().mockResolvedValue(new Response('', {status: 404})),
      lookupEgressIp: vi.fn().mockResolvedValue(undefined),
    }).run({config: createConfig(), profileName: 'splice-devnet'})

    expect(missingScan.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Scan reachability', status: 'fail'}),
    ]))

    const localFetch = vi.fn().mockResolvedValue(new Response('', {status: 200}))
    const sandboxProfile = {
      experimental: false,
      kind: 'sandbox' as const,
      name: 'sandbox',
      services: {
        auth: {kind: 'shared-secret' as const},
        ledger: {'json-api-port': 7575, port: 5001},
      },
    }
    const localReport = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver({
        auth: createResolvedAuth({credentialSource: 'fallback', operatorCredentialSource: 'fallback', mode: 'bearer-token', network: 'local'}),
        credential: {
          mode: 'bearer-token',
          network: 'local',
          scope: 'app',
          source: 'fallback',
          token: 'sandbox-token',
        },
        operatorCredential: {
          mode: 'bearer-token',
          network: 'local',
          scope: 'operator',
          source: 'fallback',
          token: 'sandbox-token',
        },
        networkName: 'local',
        profile: sandboxProfile,
        profileContext: {
          experimental: false,
          kind: 'sandbox',
          name: 'sandbox',
          services: sandboxProfile.services,
        },
      }),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.local.example.com'},
      }),
      fetch: localFetch,
      lookupEgressIp: vi.fn().mockResolvedValue('203.0.113.11'),
    }).run({config: createConfig(), profileName: 'sandbox'})

    expect(localReport.network.tier).toBe('local')
    expect(localReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Scan reachability', status: 'skip'}),
    ]))
    expect(localReport.checks.some(check => check.category === 'health')).toBe(false)
    expect(localFetch).not.toHaveBeenCalled()

    const scanAuthFailure = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.SERVICE_AUTH_FAILED, {suggestion: 'login'})),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch: vi.fn().mockResolvedValue(new Response('', {status: 404})),
      lookupEgressIp: vi.fn().mockResolvedValue('203.0.113.10'),
    }).run({config: createConfig(), profileName: 'splice-devnet'})

    expect(scanAuthFailure.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Scan reachability', detail: 'Authentication failed for the configured service endpoint.', status: 'fail'}),
    ]))
  })

  it('covers health probe warning branches and default egress lookup fallbacks', async () => {
    const fetch = vi.fn().mockImplementation(async (input: string) => {
      if (input.startsWith('https://api.ipify.org')) {
        return new Response(JSON.stringify({ip: 12}), {status: 200})
      }

      if (input.endsWith('/readyz')) {
        return new Response('', {status: input.includes('auth.') ? 401 : 503})
      }

      if (input.endsWith('/livez')) {
        if (input.includes('validator.')) {
          throw new Error('socket hang up')
        }

        return new Response('', {status: 200})
      }

      return new Response('', {status: 404})
    })

    const report = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch,
    }).run({config: createConfig(), profileName: 'splice-devnet'})

    expect(report.egressIp).toBeUndefined()
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Auth readyz', status: 'warn'}),
      expect.objectContaining({name: 'Auth livez', status: 'pass'}),
      expect.objectContaining({name: 'Scan readyz', detail: 'HTTP 503', status: 'warn'}),
      expect.objectContaining({name: 'Validator livez', detail: 'socket hang up', status: 'warn'}),
    ]))

    const ipifyFailure = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch: vi.fn().mockImplementation(async (input: string) => {
        if (input.startsWith('https://api.ipify.org')) {
          throw new Error('ipify down')
        }

        return new Response('', {status: 404})
      }),
    }).run({config: createConfig(), profileName: 'splice-devnet'})

    expect(ipifyFailure.egressIp).toBeUndefined()

    const ipifyNonOk = await createPreflightChecks({
      createProfileRuntimeResolver: createRuntimeResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch: vi.fn().mockImplementation(async (input: string) => {
        if (input.startsWith('https://api.ipify.org')) {
          return new Response('', {status: 500})
        }

        return new Response('', {status: 404})
      }),
    }).run({config: createConfig(), profileName: 'splice-devnet'})

    expect(ipifyNonOk.egressIp).toBeUndefined()
  })

  it('covers omitted deps, experimental profile warnings, and additional scan/health error branches', async () => {
    vi.spyOn(profileRuntimeModule, 'createProfileRuntimeResolver').mockReturnValue(createRuntimeResolver({
      auth: createResolvedAuth({credentialSource: 'stored', operatorCredentialSource: 'stored', network: 'devnet'}),
      compatibility: {
        checks: [],
        failed: 1,
        passed: 1,
        profile: {experimental: true, kind: 'remote-validator', name: 'splice-devnet'},
        services: [],
        warned: 2,
      },
      profile: {
        ...createConfig().profiles!['splice-devnet'],
        experimental: true,
      },
      profileContext: {
        experimental: true,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: createConfig().profiles!['splice-devnet'].services,
      },
    })())
    vi.spyOn(scanAdapterModule, 'createScanAdapter')
      .mockReturnValueOnce({
        getDsoInfo: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.SERVICE_REQUEST_FAILED, {suggestion: 'retry'})),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      } as never)
      .mockReturnValueOnce({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      } as never)

    const globalFetch = vi.fn().mockImplementation(async (input: string) => {
      if (input.startsWith('https://api.ipify.org')) {
        return new Response(JSON.stringify({ip: '198.51.100.42'}), {status: 200})
      }

      if (input.endsWith('/readyz')) {
        return new Response('', {status: 418})
      }

      throw 'string failure'
    })
    vi.stubGlobal('fetch', globalFetch)

    const authFailureReport = await createPreflightChecks().run({config: createConfig(), profileName: 'splice-devnet'})
    expect(authFailureReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Profile resolution', status: 'warn'}),
      expect.objectContaining({name: 'Compatibility baseline', detail: '1 compatibility check(s) failed.', status: 'fail'}),
      expect.objectContaining({name: 'Auth mode', status: 'pass'}),
      expect.objectContaining({name: 'Scan reachability', detail: 'The configured service rejected the request.', status: 'fail'}),
    ]))

    const probeReport = await createPreflightChecks().run({config: createConfig(), profileName: 'splice-devnet'})
    expect(probeReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'Auth readyz', detail: 'HTTP 418', status: 'warn'}),
      expect.objectContaining({name: 'Auth livez', detail: 'Request failed', status: 'warn'}),
    ]))
  })
})
