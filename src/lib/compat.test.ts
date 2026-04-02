import {describe, expect, it} from 'vitest'

import type {CantonctlConfig} from './config.js'
import {
  createCompatibilityReport,
  listProfiles,
  resolveProfile,
} from './compat.js'

function createConfig(overrides: Partial<CantonctlConfig> = {}): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networks: {
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ans: {url: 'https://ans.example.com'},
          auth: {issuer: 'https://login.example.com', kind: 'oidc'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          scanProxy: {url: 'https://scan-proxy.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
    ...overrides,
  }
}

describe('compat', () => {
  it('lists profiles with default markers and configured services', () => {
    const profiles = listProfiles(createConfig())

    expect(profiles).toEqual([
      expect.objectContaining({
        isDefault: true,
        kind: 'sandbox',
        name: 'sandbox',
        services: ['ledger'],
      }),
      expect.objectContaining({
        isDefault: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: ['ans', 'auth', 'ledger', 'scan', 'scanProxy', 'tokenStandard', 'validator'],
      }),
    ])
  })

  it('resolves the default profile when no name is provided', () => {
    const resolved = resolveProfile(createConfig())

    expect(resolved).toEqual(expect.objectContaining({
      profile: expect.objectContaining({kind: 'sandbox', name: 'sandbox'}),
      source: 'default-profile',
    }))
  })

  it('creates a stable-surface compatibility report for supported services', () => {
    const report = createCompatibilityReport(createConfig(), 'sandbox')

    expect(report.profile).toEqual({
      experimental: false,
      kind: 'sandbox',
      name: 'sandbox',
    })
    expect(report.services).toEqual([
      expect.objectContaining({
        endpoint: 'http://localhost:7575',
        name: 'ledger',
        sourceIds: ['canton-json-ledger-api-openapi'],
        stability: 'stable-external',
      }),
    ])

    const sdkCheck = report.checks.find(check => check.name === 'Project SDK')
    expect(sdkCheck).toEqual(expect.objectContaining({
      actual: '3.4.11',
      expected: '3.4.11',
      status: 'pass',
    }))

    const ledgerCheck = report.checks.find(check => check.name === 'Service ledger')
    expect(ledgerCheck).toEqual(expect.objectContaining({
      sourceIds: ['canton-json-ledger-api-openapi'],
      status: 'pass',
    }))
    expect(report.failed).toBe(0)
    expect(report.warned).toBe(0)
  })

  it('warns on unstable or config-only surfaces and fails major sdk mismatches', () => {
    const report = createCompatibilityReport(
      createConfig({
        project: {name: 'demo', 'sdk-version': '3.5.0'},
      }),
      'splice-devnet',
    )

    const scanProxyCheck = report.checks.find(check => check.name === 'Service scanProxy')
    expect(scanProxyCheck).toEqual(expect.objectContaining({
      sourceIds: ['splice-scan-proxy-openapi'],
      status: 'warn',
    }))

    const validatorCheck = report.checks.find(check => check.name === 'Service validator')
    expect(validatorCheck).toEqual(expect.objectContaining({
      sourceIds: ['splice-validator-internal-openapi'],
      status: 'warn',
    }))

    const authCheck = report.checks.find(check => check.name === 'Service auth')
    expect(authCheck).toEqual(expect.objectContaining({
      status: 'warn',
    }))

    const sdkCheck = report.checks.find(check => check.name === 'Project SDK')
    expect(sdkCheck).toEqual(expect.objectContaining({
      actual: '3.5.0',
      expected: '3.4.11',
      status: 'fail',
    }))
    expect(report.failed).toBe(1)
    expect(report.warned).toBeGreaterThanOrEqual(3)
  })
})
