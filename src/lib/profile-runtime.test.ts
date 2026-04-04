import {describe, expect, it, vi} from 'vitest'

import {createProfileRuntimeResolver, resolveProfileAuth, resolveProfileNetworkName, summarizeCredentialSource} from './profile-runtime.js'
import type {CantonctlConfig} from './config.js'
import {toJwtEnvVarName} from './auth-profile.js'

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
    expect(resolveProfileNetworkName(createConfig(), 'orphan')).toBe('orphan')
  })

  it('synthesizes auth resolution for profile-backed runtimes', () => {
    const config = createConfig()
    const auth = resolveProfileAuth(config, config.profiles!.sandbox, 'sandbox')
    expect(auth.mode).toBe('localnet-unsafe-hmac')
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
      mode: 'localnet-unsafe-hmac',
      network: 'local',
      source: 'fallback',
      token: 'sandbox-token',
    })
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
})
