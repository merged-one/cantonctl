import {afterEach, describe, expect, it, vi} from 'vitest'

import * as credentialStoreModule from './credential-store.js'
import type {CantonctlConfig} from './config.js'
import {toJwtEnvVarName} from './auth-profile.js'
import * as jwtModule from './jwt.js'
import * as keytarBackendModule from './keytar-backend.js'
import {
  createProfileRuntimeResolver,
  resolveProfileAuth,
  resolveProfileNetworkName,
  summarizeCredentialSource,
  toResolvedCredential,
} from './profile-runtime.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    networkProfiles: {
      devnet: 'splice-devnet',
      local: 'sandbox',
    },
    networks: {
      devnet: {auth: 'jwt', type: 'remote', url: 'https://ledger.devnet.example.com'},
      local: {auth: 'shared-secret', type: 'sandbox'},
    },
    parties: [{name: 'Alice', role: 'operator'}],
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {'json-api-port': 7575, port: 5001},
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {audience: 'https://wallet.example.com', issuer: 'https://login.example.com', kind: 'jwt'},
          ledger: {url: 'https://ledger.devnet.example.com'},
          scan: {url: 'https://scan.devnet.example.com'},
          tokenStandard: {url: 'https://tokens.devnet.example.com'},
          validator: {url: 'https://validator.devnet.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

describe('profile runtime', () => {
  it('maps profiles back to network names when available', () => {
    expect(resolveProfileNetworkName(createConfig(), 'splice-devnet')).toBe('devnet')
    expect(resolveProfileNetworkName(createConfig(), 'sandbox')).toBe('local')
    expect(resolveProfileNetworkName({
      ...createConfig(),
      networkProfiles: undefined,
      networks: {
        ...createConfig().networks,
        'profile-backed': {auth: 'jwt', type: 'remote', url: 'https://profile-backed.example.com'},
      },
    }, 'profile-backed')).toBe('profile-backed')
    expect(resolveProfileNetworkName(createConfig(), 'orphan')).toBe('orphan')
  })

  it('synthesizes auth resolution for profile-backed runtimes', () => {
    const config = createConfig()
    const auth = resolveProfileAuth(config, config.profiles!.sandbox, 'sandbox')
    expect(auth.mode).toBe('bearer-token')
    expect(auth.network).toBe('sandbox')
  })

  it('resolves stored and env-backed credentials for remote profiles', async () => {
    const config = createConfig()
    const resolver = createProfileRuntimeResolver({
      createBackendWithFallback: vi.fn().mockResolvedValue({backend: {}}),
      createCredentialStore: vi.fn().mockReturnValue({
        resolveRecord: vi.fn().mockResolvedValue({source: 'stored', token: 'stored-token'}),
      }),
      createFallbackToken: vi.fn(),
      env: {},
    })

    const runtime = await resolver.resolve({config, profileName: 'splice-devnet'})
    expect(runtime.networkName).toBe('devnet')
    expect(runtime.auth.mode).toBe('env-or-keychain-jwt')
    expect(runtime.credential).toEqual(expect.objectContaining({
      network: 'devnet',
      source: 'stored',
      token: 'stored-token',
    }))
    expect(runtime.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        controlPlane: expect.objectContaining({
          lifecycleOwner: 'official-remote-runtime',
          managementClass: 'plan-only',
          mutationScope: 'managed',
        }),
        name: 'validator',
      }),
    ]))
    expect(runtime.capabilities).toEqual([expect.objectContaining({
      controlPlane: expect.objectContaining({
        lifecycleOwner: 'external-sdk',
        mutationScope: 'out-of-scope',
      }),
      name: 'wallet-integration',
    })])
    expect(summarizeCredentialSource(runtime.credential)).toBe('resolved from keychain')
  })

  it('prefers env credentials over stored credentials', async () => {
    const config = createConfig()
    const resolver = createProfileRuntimeResolver({
      createBackendWithFallback: vi.fn().mockResolvedValue({backend: {}}),
      createCredentialStore: vi.fn().mockReturnValue({
        resolveRecord: vi.fn().mockResolvedValue({
          source: 'env',
          token: 'env-token',
        }),
      }),
      createFallbackToken: vi.fn(),
      env: {[toJwtEnvVarName('devnet')]: 'env-token'},
    })

    const runtime = await resolver.resolve({config, profileName: 'splice-devnet'})
    expect(runtime.credential.source).toBe('env')
    expect(runtime.credential.token).toBe('env-token')
  })

  it('uses fallback tokens for local profiles', async () => {
    const config = createConfig()
    const fallbackToken = vi.fn().mockResolvedValue('sandbox-token')
    const resolver = createProfileRuntimeResolver({
      createBackendWithFallback: vi.fn(),
      createCredentialStore: vi.fn(),
      createFallbackToken: fallbackToken,
      env: {},
    })

    const runtime = await resolver.resolve({config, profileName: 'sandbox'})
    expect(runtime.credential).toEqual({
      mode: 'bearer-token',
      network: 'local',
      source: 'fallback',
      token: 'sandbox-token',
    })
    expect(runtime.capabilities).toEqual([])
    expect(runtime.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        controlPlane: expect.objectContaining({
          endpointProvenance: 'derived-local-default',
          lifecycleOwner: 'official-local-runtime',
          managementClass: 'apply-capable',
          mutationScope: 'managed',
        }),
        name: 'ledger',
      }),
    ]))
    expect(fallbackToken).toHaveBeenCalledOnce()
  })

  it('reports missing credentials when remote auth material is unavailable', async () => {
    const config = createConfig()
    const resolver = createProfileRuntimeResolver({
      createBackendWithFallback: vi.fn().mockResolvedValue({backend: {}}),
      createCredentialStore: vi.fn().mockReturnValue({
        resolveRecord: vi.fn().mockResolvedValue(null),
      }),
      createFallbackToken: vi.fn(),
      env: {},
    })

    const runtime = await resolver.resolve({config, profileName: 'splice-devnet'})
    expect(runtime.credential).toEqual({
      mode: 'env-or-keychain-jwt',
      network: 'devnet',
      source: 'missing',
    })
    expect(summarizeCredentialSource(runtime.credential)).toBe('missing token')
  })

  it('uses default backend, store, and fallback token helpers when deps are omitted', async () => {
    vi.spyOn(keytarBackendModule, 'createBackendWithFallback').mockResolvedValue({backend: {} as never, isKeychain: true})
    vi.spyOn(credentialStoreModule, 'createCredentialStore').mockReturnValue({
      list: vi.fn(),
      remove: vi.fn(),
      resolve: vi.fn(),
      resolveRecord: vi.fn().mockResolvedValue({source: 'stored', token: 'stored-default'}),
      retrieve: vi.fn(),
      retrieveRecord: vi.fn(),
      store: vi.fn(),
    } as never)

    const resolver = createProfileRuntimeResolver()
    const remoteRuntime = await resolver.resolve({config: createConfig(), profileName: 'splice-devnet'})
    expect(remoteRuntime.credential).toEqual(expect.objectContaining({
      source: 'stored',
      token: 'stored-default',
    }))

    const createSandboxTokenSpy = vi.spyOn(jwtModule, 'createSandboxToken').mockResolvedValue('generated-token')
    const sandboxRuntime = await createProfileRuntimeResolver().resolve({config: createConfig(), profileName: 'sandbox'})
    expect(sandboxRuntime.credential).toEqual(expect.objectContaining({
      source: 'fallback',
      token: 'generated-token',
    }))
    expect(createSandboxTokenSpy).toHaveBeenCalledWith(expect.objectContaining({
      actAs: ['Alice'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: ['Alice'],
    }))
  })

  it('covers additional synthesized auth modes and credential conversions', () => {
    const base = createConfig()
    const cantonMultiAuth = resolveProfileAuth({
      ...base,
      networks: {},
    }, {
      experimental: false,
      kind: 'canton-multi',
      name: 'multi',
      services: {
        auth: {kind: 'shared-secret'},
        ledger: {'json-api-port': 7576, port: 5002},
      },
    }, 'multi')

    const bearerAuth = resolveProfileAuth({
      ...base,
      networks: {},
    }, {
      experimental: false,
      kind: 'remote-validator',
      name: 'ops',
      services: {
        auth: {kind: 'none'},
        ledger: {auth: 'none', url: 'https://ledger.ops.example.com'},
      },
    }, 'ops')

    expect(cantonMultiAuth.mode).toBe('bearer-token')
    expect(bearerAuth.mode).toBe('bearer-token')
    expect(summarizeCredentialSource({mode: 'env-or-keychain-jwt', network: 'devnet', source: 'env', token: 'env-token'})).toBe('resolved from environment')
    expect(toResolvedCredential({mode: 'env-or-keychain-jwt', network: 'devnet', source: 'env', token: 'env-token'})).toEqual({
      source: 'env',
      token: 'env-token',
    })
    expect(toResolvedCredential({mode: 'bearer-token', network: 'local', source: 'fallback', token: 'sandbox-token'})).toBeNull()
  })

  it('synthesizes missing legacy network maps and fallback auth details', async () => {
    const strippedConfig: CantonctlConfig = {
      ...createConfig(),
      networkProfiles: undefined,
      networks: undefined,
      profiles: undefined,
    }

    const auth = resolveProfileAuth(strippedConfig, {
      experimental: false,
      kind: 'remote-validator',
      name: 'ops',
      services: {
        ledger: {url: 'https://ledger.ops.example.com'},
      },
    }, 'ops')

    expect(auth.mode).toBe('env-or-keychain-jwt')

    vi.spyOn(jwtModule, 'createSandboxToken').mockResolvedValue('admin-token')
    const sandboxRuntime = await createProfileRuntimeResolver().resolve({
      config: {
        ...createConfig(),
        parties: undefined,
      },
      profileName: 'sandbox',
    })
    expect(sandboxRuntime.credential.token).toBe('admin-token')
  })
})
