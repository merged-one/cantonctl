import {describe, expect, it, vi} from 'vitest'

import {createLifecycleDiff} from './diff.js'
import {createUpgradeChecker} from './upgrade.js'
import {createResetHelper} from './reset.js'
import type {ProfileRuntimeResolver} from '../profile-runtime.js'
import type {CantonctlConfig} from '../config.js'

function createConfig(): CantonctlConfig {
  return {
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createResolver(values: Array<Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>>): () => ProfileRuntimeResolver {
  return () => ({
    resolve: vi.fn()
      .mockResolvedValueOnce(values[0])
      .mockResolvedValueOnce(values[1] ?? values[0]),
  })
}

describe('lifecycle helpers', () => {
  it('diffs environments and surfaces reset-sensitive promotions', async () => {
    const diff = createLifecycleDiff({
      createProfileRuntimeResolver: createResolver([
        {
          auth: {description: '', envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET', experimental: false, mode: 'env-or-keychain-jwt', network: 'splice-devnet', requiresExplicitExperimental: false, warnings: []},
          compatibility: {checks: [], failed: 0, passed: 2, profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'}, services: [], warned: 0},
          credential: {mode: 'env-or-keychain-jwt', network: 'splice-devnet', source: 'stored', token: 'devnet-token'},
          networkName: 'splice-devnet',
          profile: {
            experimental: false,
            kind: 'remote-validator',
            name: 'splice-devnet',
            services: {
              auth: {kind: 'jwt'},
              ledger: {url: 'https://ledger.devnet.example.com'},
              scan: {url: 'https://scan.devnet.example.com'},
            },
          },
          profileContext: {
            experimental: false,
            kind: 'remote-validator',
            name: 'splice-devnet',
            services: {
              auth: {kind: 'jwt'},
              ledger: {url: 'https://ledger.devnet.example.com'},
              scan: {url: 'https://scan.devnet.example.com'},
            },
          },
        },
        {
          auth: {description: '', envVarName: 'CANTONCTL_JWT_SPLICE_TESTNET', experimental: false, mode: 'env-or-keychain-jwt', network: 'splice-testnet', requiresExplicitExperimental: false, warnings: []},
          compatibility: {checks: [], failed: 0, passed: 2, profile: {experimental: false, kind: 'remote-validator', name: 'splice-testnet'}, services: [], warned: 0},
          credential: {mode: 'env-or-keychain-jwt', network: 'splice-testnet', source: 'stored', token: 'testnet-token'},
          networkName: 'splice-testnet',
          profile: {
            experimental: false,
            kind: 'remote-validator',
            name: 'splice-testnet',
            services: {
              auth: {kind: 'jwt'},
              ledger: {url: 'https://ledger.testnet.example.com'},
              scan: {url: 'https://scan.testnet.example.com'},
            },
          },
          profileContext: {
            experimental: false,
            kind: 'remote-validator',
            name: 'splice-testnet',
            services: {
              auth: {kind: 'jwt'},
              ledger: {url: 'https://ledger.testnet.example.com'},
              scan: {url: 'https://scan.testnet.example.com'},
            },
          },
        },
      ]),
    })

    const report = await diff.compare({config: createConfig(), fromProfile: 'splice-devnet', toProfile: 'splice-testnet'})
    expect(report.success).toBe(true)
    expect(report.services).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'ledger', change: 'changed'}),
      expect.objectContaining({name: 'scan', change: 'changed'}),
    ]))
    expect(report.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'reset-sensitive', severity: 'warn'}),
      expect.objectContaining({code: 'sponsor-reminder', severity: 'warn'}),
    ]))
  })

  it('flags missing auth and scan inputs during upgrade checks', async () => {
    const upgrade = createUpgradeChecker({
      createProfileRuntimeResolver: createResolver([
        {
          auth: {description: '', envVarName: 'CANTONCTL_JWT_SPLICE_MAINNET', experimental: false, mode: 'env-or-keychain-jwt', network: 'splice-mainnet', requiresExplicitExperimental: false, warnings: []},
          compatibility: {checks: [], failed: 1, passed: 1, profile: {experimental: false, kind: 'remote-validator', name: 'splice-mainnet'}, services: [], warned: 0},
          credential: {mode: 'env-or-keychain-jwt', network: 'splice-mainnet', source: 'missing'},
          networkName: 'splice-mainnet',
          profile: {
            experimental: false,
            kind: 'remote-validator',
            name: 'splice-mainnet',
            services: {
              auth: {kind: 'jwt'},
              ledger: {url: 'https://ledger.mainnet.example.com'},
            },
          },
          profileContext: {
            experimental: false,
            kind: 'remote-validator',
            name: 'splice-mainnet',
            services: {
              auth: {kind: 'jwt'},
              ledger: {url: 'https://ledger.mainnet.example.com'},
            },
          },
        },
      ]),
      createScanAdapter: vi.fn(),
    })

    const report = await upgrade.check({config: createConfig(), profileName: 'splice-mainnet'})
    expect(report.success).toBe(false)
    expect(report.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'auth-material', severity: 'fail'}),
      expect.objectContaining({code: 'scan-missing', severity: 'fail'}),
      expect.objectContaining({code: 'version-line', severity: 'fail'}),
    ]))
  })

  it('creates reset checklists with different expectations by network', () => {
    const helper = createResetHelper()
    expect(helper.createChecklist({network: 'devnet'})).toEqual(expect.objectContaining({
      network: 'devnet',
      resetExpectation: 'resets-expected',
    }))
    expect(helper.createChecklist({network: 'testnet'})).toEqual(expect.objectContaining({
      network: 'testnet',
      resetExpectation: 'resets-expected',
    }))
    expect(helper.createChecklist({network: 'mainnet'})).toEqual(expect.objectContaining({
      network: 'mainnet',
      resetExpectation: 'no-resets-expected',
    }))
  })
})

