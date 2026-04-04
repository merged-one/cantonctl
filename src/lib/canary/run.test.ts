import {describe, expect, it, vi} from 'vitest'

import {createCanaryRunner, STABLE_PUBLIC_CANARY_SUITES} from './run.js'
import type {ProfileRuntimeResolver} from '../profile-runtime.js'
import type {CantonctlConfig} from '../config.js'

function createConfig(): CantonctlConfig {
  return {
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createResolver(): () => ProfileRuntimeResolver {
  return () => ({
    resolve: vi.fn().mockResolvedValue({
      auth: {
        description: '',
        envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
        experimental: false,
        mode: 'env-or-keychain-jwt',
        network: 'splice-devnet',
        requiresExplicitExperimental: false,
        warnings: [],
      },
      compatibility: {
        checks: [],
        failed: 0,
        passed: 4,
        profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'},
        services: [],
        warned: 0,
      },
      credential: {
        mode: 'env-or-keychain-jwt',
        network: 'splice-devnet',
        source: 'stored',
        token: 'jwt-token',
      },
      networkName: 'splice-devnet',
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ans: {url: 'https://ans.example.com'},
          auth: {kind: 'jwt', url: 'https://auth.example.com'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      profileContext: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ans: {url: 'https://ans.example.com'},
          auth: {kind: 'jwt', url: 'https://auth.example.com'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    }),
  })
}

describe('stable-public canary runner', () => {
  it('defaults to only stable/public suites', async () => {
    const runner = createCanaryRunner({
      createAnsAdapter: vi.fn().mockReturnValue({
        listEntries: vi.fn().mockResolvedValue({entries: []}),
        metadata: {baseUrl: 'https://ans.example.com', warnings: []},
      }),
      createProfileRuntimeResolver: createResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
      createTokenStandardAdapter: vi.fn().mockReturnValue({
        families: {
          allocation: {} as never,
          allocationInstruction: {} as never,
          metadata: {requestJson: vi.fn().mockResolvedValue({tokens: []})},
          transferInstruction: {} as never,
        },
        metadata: {baseUrl: 'https://tokens.example.com', warnings: []},
      }),
      createValidatorUserAdapter: vi.fn().mockReturnValue({
        getBuyTrafficRequestStatus: vi.fn().mockResolvedValue(null),
        metadata: {baseUrl: 'https://validator.example.com', warnings: []},
      }),
    })

    const report = await runner.run({config: createConfig()})
    expect(report.success).toBe(true)
    expect(report.checks.map(check => check.suite)).toEqual([...STABLE_PUBLIC_CANARY_SUITES])
  })

  it('fails when a selected suite cannot reach its endpoint', async () => {
    const runner = createCanaryRunner({
      createProfileRuntimeResolver: createResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockRejectedValue(new Error('boom')),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
    })

    const report = await runner.run({
      config: createConfig(),
      suites: ['scan'],
    })
    expect(report.success).toBe(false)
    expect(report.checks).toEqual([
      expect.objectContaining({suite: 'scan', status: 'fail'}),
    ])
  })
})

