import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as profileRuntimeModule from './profile-runtime.js'
import * as scanAdapterModule from './adapters/scan.js'
import {
  summarizeProfileServices,
  type ProfileServiceSummary,
} from './compat.js'
import {summarizeProfileCapabilities} from './control-plane.js'
import {CantonctlError, ErrorCode} from './errors.js'
import {createCanaryRunner} from './canary/run.js'
import {renderCanaryReport} from './canary/report.js'
import {createDiagnosticsBundleWriter} from './diagnostics/bundle.js'
import {createDiagnosticsCollector} from './diagnostics/collect.js'
import {createNetworkDiscoveryFetcher} from './discovery/fetch.js'
import {mergeProfileIntoConfigYaml, synthesizeProfileFromDiscovery} from './discovery/synthesize.js'
import {renderSdkConfigEnv, renderSdkConfigJson} from './export/formatters.js'
import {createSdkConfigExporter} from './export/sdk-config.js'
import type {OutputWriter} from './output.js'
import type {ProfileRuntimeResolver} from './profile-runtime.js'
import {createLifecycleDiff} from './lifecycle/diff.js'
import {createUpgradeChecker} from './lifecycle/upgrade.js'
import {classifyNetworkTier, resolveNetworkPolicy} from './preflight/network-policy.js'
import {renderPreflightReport, summarizePreflightDetail} from './preflight/output.js'
import {createProfileStatusInventory} from './runtime-inventory.js'

const TEMP_DIRS: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const dir of TEMP_DIRS.splice(0)) {
    rmSync(dir, {force: true, recursive: true})
  }
})

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

type ResolvedRuntime = Awaited<ReturnType<ProfileRuntimeResolver['resolve']>>

function createRuntime(overrides: {
  authExperimental?: boolean
  authIssuer?: string
  authMode?: string
  compatibilityFailed?: number
  compatibilityServices?: ProfileServiceSummary[]
  compatibilityWarned?: number
  credentialSource?: 'env' | 'fallback' | 'missing' | 'stored'
  experimental?: boolean
  kind?: string
  networkName?: string
  services?: Record<string, unknown>
  token?: string
} = {}): ResolvedRuntime {
  const serviceConfigs = overrides.services ?? {
    ans: {url: 'https://ans.example.com'},
    auth: {kind: 'jwt', url: 'https://auth.example.com'},
    ledger: {url: 'https://ledger.example.com'},
    scan: {url: 'https://scan.example.com'},
    tokenStandard: {url: 'https://tokens.example.com'},
    validator: {url: 'https://validator.example.com'},
  }
  const profile = {
    experimental: overrides.experimental ?? false,
    kind: overrides.kind ?? 'remote-validator',
    name: 'splice-devnet',
    services: serviceConfigs,
  } as ResolvedRuntime['profile']
  const compatibilityServices = overrides.compatibilityServices ?? summarizeProfileServices(profile)
  const capabilities = summarizeProfileCapabilities(profile)
  const runtimeServices = summarizeProfileServices(profile)
  const authMode = (overrides.authMode ?? 'env-or-keychain-jwt') as ResolvedRuntime['auth']['mode']
  const networkName = overrides.networkName ?? 'splice-devnet'
  const credentialSource = overrides.credentialSource ?? 'stored'
  const authEnvVarName = `CANTONCTL_JWT_${networkName.toUpperCase().replace(/-/g, '_')}`
  const operatorEnvVarName = `CANTONCTL_OPERATOR_TOKEN_${networkName.toUpperCase().replace(/-/g, '_')}`

  return {
    auth: {
      app: {
        description: '',
        envVarName: authEnvVarName,
        keychainAccount: networkName,
        localFallbackAllowed: credentialSource === 'fallback',
        prerequisites: [],
        required: credentialSource !== 'fallback',
        scope: 'app',
      },
      authKind: profile.services.auth?.kind ?? 'unspecified',
      description: '',
      envVarName: authEnvVarName,
      experimental: overrides.authExperimental ?? false,
      mode: authMode,
      network: networkName,
      operator: {
        description: credentialSource === 'fallback'
          ? 'Use the generated local fallback token for companion-managed local control-plane actions.'
          : 'Use an explicitly supplied operator JWT for remote control-plane mutations.',
        envVarName: operatorEnvVarName,
        keychainAccount: `operator:${networkName}`,
        localFallbackAllowed: credentialSource === 'fallback',
        prerequisites: credentialSource === 'fallback' ? [] : ['Store an operator credential explicitly before remote mutations.'],
        required: credentialSource !== 'fallback',
        scope: 'operator',
      },
      requiresExplicitExperimental: false,
      warnings: [],
    },
    compatibility: {
      checks: [],
      failed: overrides.compatibilityFailed ?? 0,
      passed: 3,
      profile: {experimental: profile.experimental, kind: profile.kind, name: profile.name},
      services: compatibilityServices,
      warned: overrides.compatibilityWarned ?? 0,
    },
    capabilities,
    credential: {
      mode: authMode,
      network: networkName,
      scope: 'app',
      source: credentialSource,
      token: overrides.token,
    },
    inventory: createProfileStatusInventory({
      inspection: {
        capabilities,
        profile,
        resolvedFrom: 'argument',
        services: runtimeServices,
      },
    }),
    networkName,
    operatorCredential: {
      mode: authMode,
      network: networkName,
      scope: 'operator',
      source: credentialSource,
      token: overrides.token,
    },
    profile,
    profileContext: {
      experimental: profile.experimental,
      kind: profile.kind,
      name: profile.name,
      services: serviceConfigs,
    },
    services: runtimeServices,
  } as ResolvedRuntime
}

function createResolver(...values: ResolvedRuntime[]): () => ProfileRuntimeResolver {
  const lastValue = values[values.length - 1]
  return () => ({
    resolve: vi.fn()
      .mockResolvedValueOnce(values[0])
      .mockResolvedValueOnce(values[1] ?? values[0])
      .mockResolvedValue(lastValue),
  })
}

function createOutputWriter(): OutputWriter {
  return {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    result: vi.fn(),
    spinner: vi.fn() as never,
    success: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
  }
}

function createResolvedAuthSummary(options: {
  credentialSource: 'env' | 'fallback' | 'missing' | 'stored'
  envVarName?: string
  mode?: 'bearer-token' | 'env-or-keychain-jwt'
  operatorCredentialSource?: 'env' | 'fallback' | 'missing' | 'stored'
  operatorPrerequisites?: string[]
  operatorRequired?: boolean
  warnings?: string[]
}) {
  const envVarName = options.envVarName ?? 'CANTONCTL_JWT_SPLICE_DEVNET'
  const network = envVarName.replace(/^CANTONCTL_JWT_/, '')
  return {
    app: {
      credentialSource: options.credentialSource,
      envVarName,
      required: options.credentialSource !== 'fallback',
    },
    credentialSource: options.credentialSource,
    envVarName,
    mode: options.mode ?? 'env-or-keychain-jwt',
    operator: {
      credentialSource: options.operatorCredentialSource ?? options.credentialSource,
      description: 'Use an explicitly supplied operator JWT for remote control-plane mutations.',
      envVarName: `CANTONCTL_OPERATOR_TOKEN_${network}`,
      prerequisites: options.operatorPrerequisites ?? ['Store an operator credential explicitly before remote mutations.'],
      required: options.operatorRequired ?? options.credentialSource !== 'fallback',
    },
    warnings: options.warnings ?? [],
  }
}

describe('preflight output helpers', () => {
  it('renders success and failure states and summarizes runtime details', () => {
    const out = createOutputWriter()

    renderPreflightReport(out, {
      auth: createResolvedAuthSummary({
        credentialSource: 'stored',
        warnings: ['Rotate this token soon.'],
      }),
      checks: [
        {category: 'scan', detail: 'Scan reachable.', endpoint: 'https://scan.example.com', name: 'scan', status: 'pass'},
        {category: 'health', detail: 'Readyz requires auth.', endpoint: 'https://scan.example.com/readyz', name: 'scan-readyz', status: 'warn'},
      ],
      compatibility: {failed: 0, passed: 3, warned: 1},
      egressIp: '203.0.113.10',
      network: {
        checklist: ['Confirm egress'],
        name: 'splice-devnet',
        reminders: ['DevNet resets periodically.'],
        resetExpectation: 'resets-expected',
        tier: 'devnet',
      },
      profile: {experimental: true, kind: 'remote-validator', name: 'splice-devnet'},
      success: true,
    })

    expect(out.log).toHaveBeenCalledWith('Egress IP: 203.0.113.10')
    expect(out.warn).toHaveBeenCalledWith('Profile is marked experimental')
    expect(out.info).toHaveBeenCalledWith('Reminder: DevNet resets periodically.')
    expect(out.success).toHaveBeenCalledWith('Preflight passed with 1 compatibility warning and 1 advisory warning.')

    renderPreflightReport(out, {
      auth: createResolvedAuthSummary({
        credentialSource: 'missing',
        operatorCredentialSource: 'missing',
        operatorPrerequisites: [],
        operatorRequired: false,
      }),
      checks: [{category: 'scan', detail: 'Scan missing.', name: 'scan', status: 'fail'}],
      compatibility: {failed: 1, passed: 0, warned: 0},
      network: {checklist: [], name: 'splice-mainnet', reminders: [], resetExpectation: 'no-resets-expected', tier: 'mainnet'},
      profile: {experimental: false, kind: 'remote-validator', name: 'splice-mainnet'},
      success: false,
    })

    expect(out.error).toHaveBeenCalledWith('Preflight found blocking issues.')
    expect(out.log).toHaveBeenCalledWith('Operator auth: not required (missing)')
    expect(summarizePreflightDetail(createRuntime({credentialSource: 'stored'}))).toContain('resolved from keychain')
  })

  it('pluralizes preflight success output and resolves custom network policies', () => {
    const out = createOutputWriter()

    renderPreflightReport(out, {
      auth: createResolvedAuthSummary({credentialSource: 'env', envVarName: 'CANTONCTL_JWT_CUSTOM'}),
      checks: [
        {category: 'profile', detail: 'ok', name: 'Profile resolution', status: 'warn'},
        {category: 'health', detail: 'ok', name: 'Auth readyz', status: 'warn'},
      ],
      compatibility: {failed: 0, passed: 1, warned: 2},
      network: {checklist: [], name: 'partner-lab', reminders: [], resetExpectation: 'unknown', tier: 'custom'},
      profile: {experimental: false, kind: 'remote-validator', name: 'partner-lab'},
      success: true,
    })

    expect(out.success).toHaveBeenCalledWith('Preflight passed with 2 compatibility warnings and 2 advisory warnings.')
    expect(resolveNetworkPolicy({
      networkName: 'partner-lab',
      profile: {kind: 'remote-validator', name: 'partner-lab'} as never,
    })).toEqual(expect.objectContaining({displayName: 'partner-lab', resetExpectation: 'unknown', tier: 'custom'}))
    expect(classifyNetworkTier('devnet-lab', 'remote-validator' as never)).toBe('devnet')
    expect(classifyNetworkTier('localnet-demo', 'remote-validator' as never)).toBe('local')
    expect(classifyNetworkTier('partner-lab', 'remote-validator' as never)).toBe('custom')
  })
})

describe('lifecycle companion helpers', () => {
  it('covers mainnet, local, and service diff branches', async () => {
    const diff = createLifecycleDiff({
      createProfileRuntimeResolver: createResolver(
        createRuntime({
          kind: 'splice-localnet',
          networkName: 'sandbox',
          services: {
            auth: {kind: 'jwt'},
            localnet: {version: '0.5.0'},
            scanProxy: {base: 'https://scan-proxy.local'},
            scan: {url: 'https://scan.local'},
          },
        }),
        createRuntime({
          credentialSource: 'missing',
          experimental: true,
          networkName: 'splice-mainnet',
          services: {
            auth: {kind: 'jwt'},
            localnet: {version: '0.6.0'},
            ledger: {url: 'https://ledger.mainnet.example.com'},
            scanProxy: {base: 'https://scan-proxy.mainnet'},
          },
        }),
      ),
    })

    const report = await diff.compare({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}, fromProfile: 'from', toProfile: 'to'})
    expect(report.success).toBe(false)
    expect(report.services).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'auth', change: 'unchanged'}),
      expect.objectContaining({name: 'ledger', change: 'added'}),
      expect.objectContaining({name: 'localnet', change: 'changed'}),
      expect.objectContaining({name: 'scan', change: 'removed'}),
      expect.objectContaining({name: 'scanProxy', change: 'changed'}),
    ]))
    expect(report.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'auth-material', severity: 'fail'}),
      expect.objectContaining({code: 'experimental-target', severity: 'warn'}),
      expect.objectContaining({code: 'migration-policy', severity: 'info'}),
      expect.objectContaining({code: 'network-tier', severity: 'warn'}),
      expect.objectContaining({code: 'scan-missing', severity: 'fail'}),
      expect.objectContaining({code: 'sponsor-reminder', severity: 'warn'}),
      expect.objectContaining({code: 'version-line', severity: 'warn'}),
    ]))
  })

  it('omits remote rollout reminders for local targets', async () => {
    const diff = createLifecycleDiff({
      createProfileRuntimeResolver: createResolver(
        createRuntime({networkName: 'splice-devnet'}),
        createRuntime({
          networkName: 'sandbox',
          services: {
            auth: {kind: 'jwt'},
            scan: {url: 'https://scan.local'},
          },
        }),
      ),
    })

    const report = await diff.compare({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}, fromProfile: 'from', toProfile: 'to'})
    expect(report.advisories.some(advisory => advisory.code === 'sponsor-reminder')).toBe(false)
  })

  it('skips tier-change advisories when promotions stay within the same network tier', async () => {
    const diff = createLifecycleDiff({
      createProfileRuntimeResolver: createResolver(
        createRuntime({networkName: 'splice-devnet'}),
        createRuntime({networkName: 'team-devnet'}),
      ),
    })

    const report = await diff.compare({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}, fromProfile: 'from', toProfile: 'to'})
    expect(report.advisories.some(advisory => advisory.code === 'network-tier')).toBe(false)
  })

  it('uses the default runtime resolver when lifecycle helpers are constructed without deps', async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce(createRuntime({networkName: 'splice-devnet'}))
      .mockResolvedValueOnce(createRuntime({networkName: 'splice-mainnet'}))
      .mockResolvedValueOnce(createRuntime({networkName: 'splice-mainnet', services: {scan: {url: 'https://scan.mainnet.example.com'}}}))
    vi.spyOn(profileRuntimeModule, 'createProfileRuntimeResolver').mockReturnValue({resolve})
    vi.spyOn(scanAdapterModule, 'createScanAdapter').mockReturnValue({
      getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 1}}),
      metadata: {baseUrl: 'https://scan.mainnet.example.com', warnings: []},
    } as never)

    await expect(createLifecycleDiff().compare({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      fromProfile: 'from',
      toProfile: 'to',
    })).resolves.toEqual(expect.objectContaining({to: expect.objectContaining({network: 'splice-mainnet'})}))

    await expect(createUpgradeChecker().check({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      profileName: 'splice-mainnet',
    })).resolves.toEqual(expect.objectContaining({profile: expect.objectContaining({network: 'splice-mainnet'})}))
  })

  it('handles upgrade migration metadata, missing metadata, and scan read failures', async () => {
    const withMigration = createUpgradeChecker({
      createProfileRuntimeResolver: createResolver(createRuntime({
        authExperimental: true,
        kind: 'splice-localnet',
        networkName: 'splice-devnet',
        services: {
          auth: {issuer: 'https://login.example.com', kind: 'jwt'},
          localnet: {},
          scan: {url: 'https://scan.devnet.example.com'},
        },
        token: 'jwt-token',
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 5, previous_migration_id: 4}}),
        metadata: {baseUrl: 'https://scan.devnet.example.com', warnings: []},
      }),
    })

    const successReport = await withMigration.check({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}})
    expect(successReport.migration).toEqual({previousMigrationId: 4, source: 'https://scan.devnet.example.com'})
    expect(successReport.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'experimental-target', severity: 'warn'}),
      expect.objectContaining({code: 'version-line', severity: 'warn'}),
    ]))
    expect(successReport.advisories.some(advisory => advisory.code === 'reset-sensitive')).toBe(false)

    const remoteDevnetUpgrade = createUpgradeChecker({
      createProfileRuntimeResolver: createResolver(createRuntime({
        networkName: 'splice-devnet',
        services: {
          auth: {issuer: 'https://login.example.com', kind: 'jwt'},
          scan: {url: 'https://scan.devnet.example.com'},
        },
        token: 'jwt-token',
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7, previous_migration_id: 6}}),
        metadata: {baseUrl: 'https://scan.devnet.example.com', warnings: []},
      }),
    })

    const remoteDevnetReport = await remoteDevnetUpgrade.check({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}})
    expect(remoteDevnetReport.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'reset-sensitive', severity: 'warn'}),
      expect.objectContaining({code: 'sponsor-reminder', severity: 'warn'}),
    ]))

    const withoutMigration = createUpgradeChecker({
      createProfileRuntimeResolver: createResolver(createRuntime({
        networkName: 'splice-mainnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.mainnet.example.com'},
          scan: {url: 'https://scan.mainnet.example.com'},
        },
        token: 'jwt-token',
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        metadata: {baseUrl: 'https://scan.mainnet.example.com', warnings: []},
      }),
    })

    const warningReport = await withoutMigration.check({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}})
    expect(warningReport.migration).toEqual({
      source: 'https://scan.mainnet.example.com',
      warning: 'Migration metadata was not present in the scan response.',
    })
    expect(warningReport.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'migration-policy', severity: 'info'}),
    ]))

    const scanFailure = createUpgradeChecker({
      createProfileRuntimeResolver: createResolver(createRuntime({
        networkName: 'splice-testnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.testnet.example.com'},
          scan: {url: 'https://scan.testnet.example.com'},
        },
        token: 'jwt-token',
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.SERVICE_REQUEST_FAILED, {suggestion: 'retry'})),
        metadata: {baseUrl: 'https://scan.testnet.example.com', warnings: []},
      }),
    })

    const failureReport = await scanFailure.check({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}})
    expect(failureReport.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'migration-policy', severity: 'warn'}),
      expect.objectContaining({code: 'reset-sensitive', severity: 'warn'}),
    ]))

    const genericFailure = createUpgradeChecker({
      createProfileRuntimeResolver: createResolver(createRuntime({
        networkName: 'splice-mainnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.mainnet.example.com'},
          scan: {url: 'https://scan.mainnet.example.com'},
        },
        token: 'jwt-token',
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockRejectedValue(new Error('scan exploded')),
        metadata: {baseUrl: 'https://scan.mainnet.example.com', warnings: []},
      }),
    })

    await expect(genericFailure.check({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}}))
      .resolves.toEqual(expect.objectContaining({
        advisories: expect.arrayContaining([
          expect.objectContaining({code: 'migration-policy', message: 'Could not read migration metadata from scan.', severity: 'warn'}),
        ]),
      }))
  })
})

describe('stable-public canary helpers', () => {
  it('renders canary reports with endpoint fallbacks', () => {
    const out = createOutputWriter()
    renderCanaryReport(out, {
      checks: [{detail: 'Reachable.', endpoint: undefined, status: 'pass', suite: 'scan', warnings: []}],
      profile: {kind: 'remote-validator', name: 'splice-devnet'},
      success: true,
    })

    expect(out.log).toHaveBeenCalledWith('Profile: splice-devnet')
    expect(out.table).toHaveBeenCalledWith(
      ['Suite', 'Status', 'Endpoint', 'Detail'],
      [['scan', 'pass', '-', 'Reachable.']],
    )
  })

  it('covers ans fallbacks, missing services, and failure normalization', async () => {
    const viaScan = createCanaryRunner({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {kind: 'jwt', url: 'https://auth.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
        token: 'jwt-token',
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({}),
        listAnsEntries: vi.fn().mockResolvedValue({entries: []}),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
      createTokenStandardAdapter: vi.fn().mockReturnValue({
        families: {allocation: {} as never, allocationInstruction: {} as never, metadata: {requestJson: vi.fn().mockResolvedValue({tokens: []})}, transferInstruction: {} as never},
        metadata: {baseUrl: 'https://tokens.example.com', warnings: []},
      }),
      createValidatorUserAdapter: vi.fn().mockReturnValue({
        getBuyTrafficRequestStatus: vi.fn().mockResolvedValue(null),
        metadata: {baseUrl: 'https://validator.example.com', warnings: []},
      }),
    })

    const viaScanReport = await viaScan.run({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}, suites: ['ans']})
    expect(viaScanReport.checks).toEqual([
      expect.objectContaining({detail: 'Stable/public ANS data reachable through scan.', status: 'pass'}),
    ])

    const fallbackFailure = createCanaryRunner({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {kind: 'jwt', url: 'https://auth.example.com'},
          scan: {url: 'https://scan.example.com'},
        },
        token: 'jwt-token',
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        listAnsEntries: vi.fn().mockRejectedValue(new Error('scan ans boom')),
        metadata: {baseUrl: 'https://scan.example.com', warnings: ['fallback scan']},
      }),
    })

    const fallbackFailureReport = await fallbackFailure.run({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      suites: ['ans'],
    })
    expect(fallbackFailureReport.checks).toEqual([
      expect.objectContaining({detail: 'scan ans boom', warnings: ['fallback scan']}),
    ])

    const missingServices = createCanaryRunner({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {kind: 'jwt', url: 'https://auth.example.com'},
        },
      })),
    })

    const missingReport = await missingServices.run({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      suites: ['scan', 'ans', 'token-standard', 'validator-user'],
    })
    expect(missingReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({suite: 'scan', detail: 'Scan endpoint is not configured.', status: 'fail'}),
      expect.objectContaining({suite: 'ans', detail: 'ANS and scan endpoints are not configured.', status: 'fail'}),
      expect.objectContaining({suite: 'token-standard', detail: 'Token Standard endpoint is not configured.', status: 'fail'}),
      expect.objectContaining({suite: 'validator-user', detail: 'Validator-user endpoint is not configured.', status: 'fail'}),
    ]))

    const normalizedFailures = createCanaryRunner({
      createAnsAdapter: vi.fn().mockReturnValue({
        listEntries: vi.fn().mockRejectedValue(new Error('ans boom')),
        metadata: {baseUrl: 'https://ans.example.com', warnings: ['legacy fallback']},
      }),
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          ans: {url: 'https://ans.example.com'},
          auth: {kind: 'jwt', url: 'https://auth.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
        token: 'jwt-token',
      })),
      createTokenStandardAdapter: vi.fn().mockReturnValue({
        families: {allocation: {} as never, allocationInstruction: {} as never, metadata: {requestJson: vi.fn().mockRejectedValue('nope')}, transferInstruction: {} as never},
        metadata: {baseUrl: 'https://tokens.example.com', warnings: []},
      }),
      createValidatorUserAdapter: vi.fn().mockReturnValue({
        getBuyTrafficRequestStatus: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.SERVICE_REQUEST_FAILED, {suggestion: 'retry'})),
        metadata: {baseUrl: 'https://validator.example.com'},
      }),
    })

    const normalizedReport = await normalizedFailures.run({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      suites: ['ans', 'token-standard', 'validator-user'],
    })
    expect(normalizedReport.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({suite: 'ans', detail: 'ans boom', warnings: ['legacy fallback']}),
      expect.objectContaining({suite: 'token-standard', detail: 'Request failed'}),
      expect.objectContaining({suite: 'validator-user', detail: 'The configured service rejected the request.'}),
    ]))
  })

  it('fails validator-user canaries when auth tokens are unavailable', async () => {
    const runner = createCanaryRunner({
      createProfileRuntimeResolver: createResolver(createRuntime({
        credentialSource: 'missing',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      })),
    })

    const report = await runner.run({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      suites: ['validator-user'],
    })
    expect(report.checks).toEqual([
      expect.objectContaining({detail: 'No token available for validator-user checks. Set CANTONCTL_JWT_SPLICE_DEVNET first.', status: 'fail'}),
    ])
  })

  it('uses default dependency factories for canary and discovery helpers', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({token: 'jwt-token'}))
    vi.spyOn(profileRuntimeModule, 'createProfileRuntimeResolver').mockReturnValue({resolve})
    vi.spyOn(scanAdapterModule, 'createScanAdapter').mockReturnValue({
      getDsoInfo: vi.fn().mockResolvedValue({ok: true}),
      listDsoScans: vi.fn().mockResolvedValue({scans: []}),
      listDsoSequencers: vi.fn().mockResolvedValue({synchronizers: []}),
      metadata: {baseUrl: 'https://scan.example.com', warnings: []},
    } as never)

    await expect(createCanaryRunner().run({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      suites: ['scan'],
    })).resolves.toEqual(expect.objectContaining({success: true}))

    await expect(createNetworkDiscoveryFetcher().fetch({scanUrl: 'https://scan.example.com'}))
      .resolves.toEqual(expect.objectContaining({scanUrl: 'https://scan.example.com'}))
  })
})

describe('diagnostics helpers', () => {
  it('collects auth-required, unavailable, and unreachable health and metrics states', async () => {
    const collector = createDiagnosticsCollector({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {issuer: 'https://auth.example.com'},
          scan: {url: 'https://scan.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
        token: 'jwt-token',
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        listValidatorLicenses: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.SERVICE_REQUEST_FAILED, {suggestion: 'retry'})),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
      fetch: vi.fn().mockImplementation(async (input: string) => {
        if (input.endsWith('/readyz')) return new Response('', {status: input.includes('auth.') ? 401 : 503})
        if (input.endsWith('/livez')) throw new Error('network down')
        if (input.endsWith('/metrics')) return new Response('', {status: input.includes('scan.') ? 403 : 404})
        return new Response('', {status: 200})
      }),
    })

    const snapshot = await collector.collect({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}})
    expect(snapshot.health).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'auth-readyz', status: 'auth-required'}),
      expect.objectContaining({name: 'scan-readyz', status: 'unreachable'}),
      expect.objectContaining({name: 'validator-livez', status: 'unreachable'}),
    ]))
    expect(snapshot.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({service: 'auth', status: 'not-exposed'}),
      expect.objectContaining({service: 'scan', status: 'auth-required'}),
      expect.objectContaining({service: 'validator', status: 'not-exposed'}),
    ]))
    expect(snapshot.validatorLiveness).toEqual({
      approvedValidatorCount: 0,
      endpoint: 'https://scan.example.com',
      sampleSize: 0,
    })
  })

  it('handles metric probe failures and bundle snapshots without validator liveness', async () => {
    const collector = createDiagnosticsCollector({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {issuer: 'https://auth.example.com'},
        },
      })),
      fetch: vi.fn().mockRejectedValue('metrics exploded'),
    })

    const snapshot = await collector.collect({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}})
    expect(snapshot.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({detail: 'Request failed', service: 'auth', status: 'unreachable'}),
    ]))

    const outputDir = createTempDir('cantonctl-bundle-empty-')
    await expect(createDiagnosticsBundleWriter().write({outputDir, snapshot})).resolves.toEqual(expect.objectContaining({
      outputDir,
    }))
    expect(readFileSync(join(outputDir, 'validator-liveness.json'), 'utf8')).toContain('{}')
  })

  it('uses default runtime, scan, and fetch dependencies for diagnostics collection', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      services: {
        auth: {issuer: 'https://auth.example.com'},
        scan: {url: 'https://scan.example.com'},
      },
      token: 'jwt-token',
    }))
    vi.spyOn(profileRuntimeModule, 'createProfileRuntimeResolver').mockReturnValue({resolve})
    vi.spyOn(scanAdapterModule, 'createScanAdapter').mockReturnValue({
      listValidatorLicenses: vi.fn().mockResolvedValue({}),
      metadata: {baseUrl: 'https://scan.example.com', warnings: []},
    } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {status: 200})))

    await expect(createDiagnosticsCollector().collect({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
    })).resolves.toEqual(expect.objectContaining({
      metrics: expect.arrayContaining([
        expect.objectContaining({service: 'auth', status: 'available'}),
      ]),
      validatorLiveness: {approvedValidatorCount: 0, endpoint: 'https://scan.example.com', sampleSize: 0},
    }))
  })

  it('records metric HTTP failures and Error-based metric probe exceptions', async () => {
    const collector = createDiagnosticsCollector({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {issuer: 'https://auth.example.com'},
          scan: {url: 'https://scan.example.com'},
        },
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        listValidatorLicenses: vi.fn().mockResolvedValue({validator_licenses: []}),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
      fetch: vi.fn().mockImplementation(async (input: string) => {
        if (input.endsWith('/readyz') || input.endsWith('/livez')) {
          return new Response('', {status: 200})
        }

        if (input === 'https://auth.example.com/metrics') {
          throw new Error('metrics down')
        }

        return new Response('', {status: 500})
      }),
    })

    await expect(collector.collect({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}}))
      .resolves.toEqual(expect.objectContaining({
        metrics: expect.arrayContaining([
          expect.objectContaining({service: 'auth', detail: 'metrics down', status: 'unreachable'}),
          expect.objectContaining({service: 'scan', detail: 'HTTP 500', status: 'unreachable'}),
        ]),
      }))
  })

  it('omits validator liveness when scan is missing and rethrows unexpected scan errors', async () => {
    const noScanCollector = createDiagnosticsCollector({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {issuer: 'https://auth.example.com'},
        },
      })),
      fetch: vi.fn().mockResolvedValue(new Response('', {status: 200})),
    })

    await expect(noScanCollector.collect({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}}))
      .resolves.toEqual(expect.objectContaining({validatorLiveness: undefined}))

    const failingCollector = createDiagnosticsCollector({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {issuer: 'https://auth.example.com'},
          scan: {url: 'https://scan.example.com'},
        },
      })),
      createScanAdapter: vi.fn().mockReturnValue({
        listValidatorLicenses: vi.fn().mockRejectedValue(new Error('unexpected scan boom')),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
      fetch: vi.fn().mockResolvedValue(new Response('', {status: 200})),
    })

    await expect(failingCollector.collect({config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1}}))
      .rejects.toThrow('unexpected scan boom')
  })

  it('writes diagnostics snapshots into a bundle directory', async () => {
    const outputDir = createTempDir('cantonctl-bundle-')
    const writer = createDiagnosticsBundleWriter()
    const result = await writer.write({
      outputDir,
      snapshot: {
        auth: {envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET', mode: 'env-or-keychain-jwt', source: 'stored'},
        compatibility: {failed: 0, passed: 3, warned: 1},
        health: [],
        metrics: [],
        profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet'},
        services: [],
        validatorLiveness: {approvedValidatorCount: 1, endpoint: 'https://scan.example.com', sampleSize: 1},
      },
    })

    expect(result.files).toHaveLength(7)
    expect(readFileSync(join(outputDir, 'validator-liveness.json'), 'utf8')).toContain('"approvedValidatorCount": 1')
  })
})

describe('discovery and export helpers', () => {
  it('fetches scan discovery snapshots and falls back on non-array payloads', async () => {
    const fetcher = createNetworkDiscoveryFetcher({
      createScanAdapter: vi.fn()
        .mockReturnValueOnce({
          getDsoInfo: vi.fn().mockResolvedValue({id: 'dso'}),
          listDsoScans: vi.fn().mockResolvedValue({scans: [{url: 'https://scan.example.com'}]}),
          listDsoSequencers: vi.fn().mockResolvedValue({synchronizers: [{id: 'sequencer::1'}]}),
          metadata: {baseUrl: 'https://scan.example.com', warnings: []},
        })
        .mockReturnValueOnce({
          getDsoInfo: vi.fn().mockResolvedValue({id: 'dso'}),
          listDsoScans: vi.fn().mockResolvedValue({scans: 'bad'}),
          listDsoSequencers: vi.fn().mockResolvedValue({synchronizers: null}),
          metadata: {baseUrl: 'https://scan.example.com', warnings: []},
        }),
    })

    const populated = await fetcher.fetch({scanUrl: 'https://scan.example.com'})
    expect(populated.scans).toEqual([{url: 'https://scan.example.com'}])
    expect(populated.sequencers).toEqual([{id: 'sequencer::1'}])

    const empty = await fetcher.fetch({scanUrl: 'https://scan.example.com'})
    expect(empty.scans).toEqual([])
    expect(empty.sequencers).toEqual([])
  })

  it('synthesizes default profile names, nested endpoints, and merge fallbacks', () => {
    const synthesized = synthesizeProfileFromDiscovery({
      discovery: {
        dsoInfo: {
          nested: {
            auth_url: 'https://auth.example.com',
            ledger_url: 'https://ledger.example.com',
          },
          services: [
            {ans_endpoint: 'https://ans.example.com'},
            {token_url: 'https://tokens.example.com'},
            {wallet_url: 'https://validator.example.com'},
          ],
        },
        scanUrl: 'https://scan.sync.global',
        scans: [],
        sequencers: [],
      },
      kind: 'remote-validator',
    })

    expect(synthesized.name).toBe('remote-validator-scan-sync-global')
    expect(synthesized.profile).toEqual(expect.objectContaining({
      ans: {url: 'https://ans.example.com'},
      auth: {kind: 'jwt', url: 'https://auth.example.com'},
      ledger: {url: 'https://ledger.example.com'},
      tokenStandard: {url: 'https://tokens.example.com'},
      validator: {url: 'https://validator.example.com'},
    }))

    const warningResult = synthesizeProfileFromDiscovery({
      discovery: {
        dsoInfo: {non_url: 'ignored'},
        scanUrl: 'https://scan.example.com',
        scans: [],
        sequencers: [],
      },
      kind: 'remote-validator',
      name: 'manual-name',
    })
    expect(warningResult.warnings).toEqual(expect.arrayContaining([
      'Could not infer an auth endpoint from scan discovery data.',
      'Could not infer a validator endpoint from scan discovery data. Add it manually if needed.',
    ]))

    const merged = mergeProfileIntoConfigYaml({
      existingConfigYaml: 'version: 1\nproject:\n  name: demo\n',
      synthesized,
    })
    expect(merged).toContain('profiles:')
    expect(merged).toContain('remote-validator-scan-sync-global:')

    const mergedIntoEmpty = mergeProfileIntoConfigYaml({
      existingConfigYaml: '',
      synthesized: warningResult,
    })
    expect(mergedIntoEmpty).toContain('manual-name:')
  })

  it('exports all SDK target variants and formats optional env output correctly', async () => {
    const exporter = createSdkConfigExporter({
      createProfileRuntimeResolver: createResolver(createRuntime({
        services: {
          auth: {issuer: 'https://issuer.example.com', kind: 'jwt'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      })),
    })

    const dappSdk = await exporter.exportConfig({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      target: 'dapp-sdk',
    })
    const dappApi = await exporter.exportConfig({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      target: 'dapp-api',
    })
    const walletSdk = await exporter.exportConfig({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      target: 'wallet-sdk',
    })

    expect(dappSdk.endpoints.walletGatewayUrl).toBe('https://validator.example.com')
    expect(dappApi.endpoints.dappApiUrl).toBe('https://validator.example.com')
    expect(walletSdk.endpoints.validatorUrl).toBe('https://validator.example.com')
    expect(dappApi.notes[0]).toContain('official dApp API')
    expect(walletSdk.notes[0]).toContain('official Wallet SDK')

    expect(renderSdkConfigJson(walletSdk)).toContain('"cip": "CIP-0103"')
    expect(renderSdkConfigEnv(dappSdk)).toContain('CIP_0103_WALLET_GATEWAY_URL=https://validator.example.com')
    expect(renderSdkConfigEnv(dappApi)).toContain('CIP_0103_DAPP_API_URL=https://validator.example.com')
    expect(renderSdkConfigEnv({
      ...walletSdk,
      endpoints: {
        authUrl: undefined,
        dappApiUrl: undefined,
        ledgerUrl: undefined,
        scanUrl: undefined,
        tokenStandardUrl: undefined,
        validatorUrl: undefined,
        walletGatewayUrl: undefined,
      },
    })).not.toContain('SPLICE_SCAN_URL=')
  })

  it('uses the default runtime resolver for SDK export construction', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      services: {
        auth: {issuer: 'https://issuer.example.com', kind: 'jwt'},
        validator: {url: 'https://validator.example.com'},
      },
    }))
    vi.spyOn(profileRuntimeModule, 'createProfileRuntimeResolver').mockReturnValue({resolve})

    await expect(createSdkConfigExporter().exportConfig({
      config: {project: {name: 'demo', 'sdk-version': '3.4.11'}, version: 1},
      target: 'wallet-sdk',
    })).resolves.toEqual(expect.objectContaining({
      endpoints: expect.objectContaining({validatorUrl: 'https://validator.example.com'}),
    }))
  })
})
