import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from './config.js'
import {
  createCompatibilityReport,
  listProfiles,
  summarizeProfileServices,
  resolveProfile,
} from './compat.js'
import {ErrorCode} from './errors.js'
import * as manifestModule from './upstream/manifest.js'

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

  it('uses the only configured profile when no default is set', () => {
    const resolved = resolveProfile(createConfig({
      'default-profile': undefined,
      profiles: {
        sandbox: {
          experimental: false,
          kind: 'sandbox',
          name: 'sandbox',
          services: {
            ledger: {port: 5001, 'json-api-port': 7575},
          },
        },
      },
    }))

    expect(resolved).toEqual(expect.objectContaining({
      profile: expect.objectContaining({name: 'sandbox'}),
      source: 'only-profile',
    }))
  })

  it('fails with a readable error when an explicit profile is missing', () => {
    expect(() => resolveProfile(createConfig(), 'missing-profile')).toThrowError(
      expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
    )
  })

  it('fails when the configured default profile is missing', () => {
    expect(() => resolveProfile(createConfig({
      'default-profile': 'missing-profile',
    }))).toThrowError(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: expect.stringContaining('Default profile "missing-profile" is not defined'),
    }))
  })

  it('fails when no profile can be selected implicitly', () => {
    expect(() => resolveProfile(createConfig({
      'default-profile': undefined,
      profiles: {},
    }))).toThrowError(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: 'Define at least one profile or network in cantonctl.yaml.',
    }))

    expect(() => resolveProfile(createConfig({
      'default-profile': undefined,
    }))).toThrowError(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: expect.stringContaining('Choose a profile explicitly. Available:'),
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

  it('treats unknown sdk formats as warnings instead of hard failures', () => {
    const report = createCompatibilityReport(createConfig({
      project: {name: 'demo', 'sdk-version': 'nightly-build'},
    }), 'sandbox')

    expect(report.checks.find(check => check.name === 'Project SDK')).toEqual(
      expect.objectContaining({
        actual: 'nightly-build',
        status: 'warn',
      }),
    )
  })

  it('summarizes auth and localnet services with config-specific detail', () => {
    const services = summarizeProfileServices({
      experimental: true,
      kind: 'splice-localnet',
      name: 'splice-localnet',
      services: {
        auth: {
          audience: 'aud',
          issuer: 'https://issuer.example.com',
          kind: 'oidc',
        },
        localnet: {
          'base-port': 10000,
          'canton-image': 'ghcr.io/example/canton:1.0.0',
          distribution: 'splice',
          version: '0.5.x',
        },
        validator: {url: 'https://validator.example.com'},
      },
    })

    expect(services).toEqual([
      expect.objectContaining({
        detail: 'oidc, issuer https://issuer.example.com, audience aud',
        endpoint: 'https://issuer.example.com',
        name: 'auth',
        stability: 'config-only',
      }),
      expect.objectContaining({
        detail: 'Validator endpoint',
        endpoint: 'https://validator.example.com',
        name: 'validator',
        stability: 'operator-only',
      }),
      expect.objectContaining({
        detail: 'splice, version 0.5.x, base-port 10000, ghcr.io/example/canton:1.0.0',
        endpoint: undefined,
        name: 'localnet',
        stability: 'config-only',
      }),
    ])
  })

  it('summarizes remote service endpoints and minimal detail when only urls are configured', () => {
    const services = summarizeProfileServices({
      experimental: false,
      kind: 'remote-sv-network',
      name: 'sv-network',
      services: {
        ans: {url: 'https://ans.example.com'},
        auth: {kind: 'oidc', url: 'https://auth.example.com'},
        ledger: {url: 'https://ledger.example.com'},
        scan: {url: 'https://scan.example.com'},
        scanProxy: {url: 'https://scan-proxy.example.com'},
        tokenStandard: {url: 'https://tokens.example.com'},
      },
    })

    expect(services).toEqual([
      expect.objectContaining({
        detail: 'ANS endpoint',
        endpoint: 'https://ans.example.com',
        name: 'ans',
      }),
      expect.objectContaining({
        detail: 'oidc',
        endpoint: 'https://auth.example.com',
        name: 'auth',
        stability: 'config-only',
      }),
      expect.objectContaining({
        detail: 'Ledger endpoint',
        endpoint: 'https://ledger.example.com',
        name: 'ledger',
      }),
      expect.objectContaining({
        detail: 'Scan endpoint',
        endpoint: 'https://scan.example.com',
        name: 'scan',
      }),
      expect.objectContaining({
        detail: 'Scan proxy endpoint',
        endpoint: 'https://scan-proxy.example.com',
        name: 'scanProxy',
      }),
      expect.objectContaining({
        detail: 'Token Standard endpoint',
        endpoint: 'https://tokens.example.com',
        name: 'tokenStandard',
      }),
    ])
  })

  it('treats public-sdk and stable-daml-interface upstream classes as passing compatibility checks', () => {
    const getUpstreamSource = manifestModule.getUpstreamSource
    const getUpstreamSourceSpy = vi.spyOn(manifestModule, 'getUpstreamSource').mockImplementation((id) => {
      const source = getUpstreamSource(id)
      if (id === 'splice-ans-external-openapi') {
        return {...source, stability: 'public-sdk'} as ReturnType<typeof manifestModule.getUpstreamSource>
      }

      if (id === 'splice-scan-external-openapi') {
        return {...source, stability: 'stable-daml-interface'} as ReturnType<typeof manifestModule.getUpstreamSource>
      }

      return source
    })

    try {
      const report = createCompatibilityReport(createConfig(), 'splice-devnet')

      expect(report.checks.find(check => check.name === 'Service ans')).toEqual(expect.objectContaining({
        detail: 'ans should integrate through the published SDK package pinned in the manifest.',
        status: 'pass',
      }))
      expect(report.checks.find(check => check.name === 'Service scan')).toEqual(expect.objectContaining({
        detail: 'scan is anchored to stable Daml interfaces tracked in the manifest.',
        status: 'pass',
      }))
    } finally {
      getUpstreamSourceSpy.mockRestore()
    }
  })
})
