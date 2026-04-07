import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../config.js'
import type {ResolvedProfileRuntime} from '../profile-runtime.js'
import * as readinessModule from '../readiness.js'
import {createUpgradeRunner} from './upgrade.js'

function createConfig(): CantonctlConfig {
  return {
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createRuntime(options: {
  authExperimental?: boolean
  credentialSource?: 'env' | 'fallback' | 'missing' | 'stored'
  kind?: ResolvedProfileRuntime['profile']['kind']
  networkName?: string
  operatorCredentialSource?: 'env' | 'fallback' | 'missing' | 'stored'
  profileName?: string
  services?: ResolvedProfileRuntime['profile']['services']
} = {}): ResolvedProfileRuntime {
  const kind = options.kind ?? 'remote-validator'
  const networkName = options.networkName ?? 'splice-devnet'
  const profileName = options.profileName ?? networkName
  const services = options.services ?? {
    auth: {kind: 'jwt', url: 'https://auth.example.com'},
    ledger: {url: 'https://ledger.example.com'},
    scan: {url: 'https://scan.example.com'},
    validator: {url: 'https://validator.example.com'},
  }

  return {
    auth: {
      app: {
        description: '',
        envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
        keychainAccount: networkName,
        localFallbackAllowed: false,
        prerequisites: [],
        required: true,
        scope: 'app',
      },
      authKind: services.auth?.kind ?? 'unspecified',
      description: '',
      envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
      experimental: options.authExperimental ?? false,
      mode: 'env-or-keychain-jwt',
      network: networkName,
      operator: {
        description: '',
        envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
        keychainAccount: `operator:${networkName}`,
        localFallbackAllowed: false,
        prerequisites: [],
        required: kind === 'remote-validator' || kind === 'remote-sv-network',
        scope: 'operator',
      },
      requiresExplicitExperimental: false,
      warnings: [],
    },
    capabilities: [],
    compatibility: {
      checks: [],
      failed: 0,
      passed: 2,
      profile: {experimental: false, kind, name: profileName},
      services: [],
      warned: 0,
    },
    credential: {
      mode: 'env-or-keychain-jwt',
      network: networkName,
      scope: 'app',
      source: options.credentialSource ?? 'stored',
      token: 'app-token',
    },
    inventory: {
      capabilities: [],
      mode: 'profile',
      profile: {experimental: false, kind, name: profileName},
      schemaVersion: 1,
      services: [],
      summary: {
        configuredCapabilities: 0,
        configuredServices: 0,
        driftedCapabilities: 0,
        healthyCapabilities: 0,
        healthyServices: 0,
        unreachableCapabilities: 0,
        unreachableServices: 0,
        warnedCapabilities: 0,
      },
      drift: [],
    },
    networkName,
    operatorCredential: {
      mode: 'env-or-keychain-jwt',
      network: networkName,
      scope: 'operator',
      source: options.operatorCredentialSource ?? options.credentialSource ?? 'stored',
      token: 'operator-token',
    },
    profile: {
      experimental: false,
      kind,
      name: profileName,
      services,
    },
    profileContext: {
      experimental: false,
      kind,
      name: profileName,
      services,
    },
    services: [],
  }
}

function createReadinessReport(success: boolean) {
  return {
    auth: {scope: 'app', source: 'stored', warnings: []},
    canary: {
      checks: [{
        detail: success ? 'ok' : 'failed',
        endpoint: 'https://validator.example.com',
        status: success ? 'pass' : 'fail',
        suite: 'wallet',
        warnings: success ? [] : ['wallet degraded'],
      }],
      selectedSuites: ['wallet'],
      skippedSuites: [],
      success,
    },
    compatibility: {failed: 0, warned: 0},
    drift: [],
    inventory: {
      capabilities: [],
      mode: 'profile',
      schemaVersion: 1,
      services: [],
      summary: {
        configuredCapabilities: 0,
        configuredServices: 0,
        driftedCapabilities: 0,
        healthyCapabilities: 0,
        healthyServices: 0,
        unreachableCapabilities: 0,
        unreachableServices: 0,
        warnedCapabilities: 0,
      },
      drift: [],
    },
    preflight: {
      auth: {scope: 'app', source: 'stored', warnings: []},
      checks: [],
      compatibility: {failed: 0, warned: 0},
      drift: [],
      inventory: {
        capabilities: [],
        mode: 'profile',
        schemaVersion: 1,
        services: [],
        summary: {
          configuredCapabilities: 0,
          configuredServices: 0,
          driftedCapabilities: 0,
          healthyCapabilities: 0,
          healthyServices: 0,
          unreachableCapabilities: 0,
          unreachableServices: 0,
          warnedCapabilities: 0,
        },
        drift: [],
      },
      profile: {kind: 'splice-localnet', name: 'splice-localnet'},
      reconcile: {runbook: [], summary: {failed: 0, info: 0, manualRunbooks: 0, supportedActions: 0, warned: 0}, supportedActions: []},
      rollout: {
        mode: 'dry-run',
        operation: 'readiness',
        partial: false,
        resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
        steps: success
          ? []
          : [{
            blockers: [{code: 'canary-failed', detail: 'wallet degraded'}],
            dependencies: [],
            effect: 'read',
            id: 'canary-wallet',
            owner: 'cantonctl',
            postconditions: [],
            preconditions: [],
            runbook: [],
            status: 'blocked',
            title: 'Canary wallet',
            warnings: [],
          }],
        success,
        summary: {blocked: success ? 0 : 1, completed: 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: success ? 0 : 1},
      },
      success,
      summary: {failed: 0, passed: 0, skipped: 0, warned: 0},
    },
    profile: {kind: 'splice-localnet', name: 'splice-localnet'},
    reconcile: {runbook: [], summary: {failed: 0, info: 0, manualRunbooks: 0, supportedActions: 0, warned: 0}, supportedActions: []},
    rollout: {
      mode: 'dry-run',
      operation: 'readiness',
      partial: false,
      resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
      steps: success
        ? []
        : [{
          blockers: [{code: 'canary-failed', detail: 'wallet degraded'}],
          dependencies: [],
          effect: 'read',
          id: 'canary-wallet',
          owner: 'cantonctl',
          postconditions: [],
          preconditions: [],
          runbook: [],
          status: 'blocked',
          title: 'Canary wallet',
          warnings: [],
        }],
      success,
      summary: {blocked: success ? 0 : 1, completed: 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: success ? 0 : 1},
    },
    success,
    summary: {failed: success ? 0 : 1, passed: 1, skipped: 0, warned: success ? 0 : 1},
  } as const
}

function createLocalnetHarness() {
  const workspace = {
    composeFilePath: '/workspace/compose.yaml',
    configDir: '/workspace/docker/modules/localnet/conf',
    env: {SPLICE_VERSION: '0.5.0'},
    localnetDir: '/workspace/docker/modules/localnet',
    makeTargets: {down: 'stop', status: 'status', up: 'start'},
    profiles: {} as never,
    root: '/workspace',
  }
  const services = {
    ledger: {url: 'http://ledger.localhost:3001'},
    scan: {url: 'http://scan.localhost:3012'},
    validator: {url: 'http://validator.localhost:3003'},
    wallet: {url: 'http://wallet.localhost:3000'},
  }
  const profiles = {
    'app-provider': {
      health: {validatorReadyz: 'http://validator.localhost:3003/readyz'},
      name: 'app-provider' as const,
      urls: {
        ledger: services.ledger.url,
        scan: services.scan.url,
        validator: services.validator.url,
        wallet: services.wallet.url,
      },
    },
  }
  const status = {
    containers: [],
    health: {
      validatorReadyz: {
        body: 'ok',
        healthy: true,
        status: 200,
        url: 'http://validator.localhost:3003/readyz',
      },
    },
    profiles,
    selectedProfile: 'app-provider' as const,
    services,
    workspace,
  }

  return {
    localnet: {
      down: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue(status),
      up: vi.fn().mockResolvedValue(status),
    },
    workspace: workspace.root,
  }
}

describe('upgrade workflow', () => {
  it('plans remote upgrades with manual runbooks and network reminders', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
    const runner = createUpgradeRunner({
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7, previous_migration_id: 6}}),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
    })

    const report = await runner.run({config: createConfig(), profileName: 'splice-devnet'})

    expect(report.success).toBe(true)
    expect(report.automation.kind).toBe('manual-only')
    expect(report.network.reminders).toEqual(expect.arrayContaining(['DevNet resets happen. Treat migration IDs, balances, and onboarding state as disposable.']))
    expect(report.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'reset-sensitive', severity: 'warn'}),
      expect.objectContaining({code: 'sponsor-reminder', severity: 'warn'}),
    ]))
    expect(report.rollout.mode).toBe('plan')
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({status: 'manual', title: 'Review manual upgrade runbook'}),
      expect.objectContaining({status: 'ready', title: 'Validate upgrade workflow'}),
    ]))
  })

  it('runs dry-run validation for remote manual-only targets', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
    const runner = createUpgradeRunner({
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7, previous_migration_id: 6}}),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'dry-run',
      profileName: 'splice-devnet',
    })

    expect(report.success).toBe(true)
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Validate upgrade workflow',
        status: 'completed',
        detail: 'Upgrade workflow stays manual-only after planning because this target does not expose a supported apply step.',
      }),
    ]))
  })

  it('blocks remote apply workflows at the explicit manual boundary', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      networkName: 'splice-mainnet',
      profileName: 'splice-mainnet',
    }))
    const runner = createUpgradeRunner({
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7, previous_migration_id: 6}}),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
    })

    const report = await runner.run({config: createConfig(), mode: 'apply', profileName: 'splice-mainnet'})

    expect(report.success).toBe(false)
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'blocked',
        title: 'Validate upgrade workflow',
        blockers: expect.arrayContaining([
          expect.objectContaining({code: 'apply-unsupported'}),
        ]),
      }),
    ]))
  })

  it('requires a workspace before running live LocalNet upgrade modes', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      kind: 'splice-localnet',
      networkName: 'localnet',
      profileName: 'splice-localnet',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: 'http://ledger.localhost:3001'},
        localnet: {version: '0.5.0'},
        scan: {url: 'http://scan.localhost:3012'},
        validator: {url: 'http://validator.localhost:3003'},
      },
    }))
    const runner = createUpgradeRunner({
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7}}),
        metadata: {baseUrl: 'http://scan.localhost:3012', warnings: []},
      }),
    })

    const report = await runner.run({config: createConfig(), mode: 'dry-run', profileName: 'splice-localnet'})

    expect(report.success).toBe(false)
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'blocked',
        blockers: expect.arrayContaining([
          expect.objectContaining({code: 'workspace-required'}),
        ]),
      }),
    ]))
  })

  it('cycles the LocalNet workspace and runs post-upgrade readiness in apply mode', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      kind: 'splice-localnet',
      networkName: 'localnet',
      profileName: 'splice-localnet',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: 'http://ledger.localhost:3001'},
        localnet: {version: '0.5.0'},
        scan: {url: 'http://scan.localhost:3012'},
        validator: {url: 'http://validator.localhost:3003'},
      },
    }))
    const {localnet, workspace} = createLocalnetHarness()
    const readiness = {run: vi.fn().mockResolvedValue(createReadinessReport(true))}
    const runner = createUpgradeRunner({
      createLocalnet: () => localnet,
      createProfileRuntimeResolver: () => ({resolve}),
      createReadinessRunner: () => readiness,
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7}}),
        metadata: {baseUrl: 'http://scan.localhost:3012', warnings: []},
      }),
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'apply',
      profileName: 'splice-localnet',
      workspace,
    })

    expect(report.success).toBe(true)
    expect(localnet.down).toHaveBeenCalledWith({workspace})
    expect(localnet.up).toHaveBeenCalledWith({profile: 'app-provider', workspace})
    expect(readiness.run).toHaveBeenCalledWith(expect.objectContaining({profileName: 'splice-localnet'}))
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({status: 'completed', title: 'Cycle official LocalNet workspace'}),
      expect.objectContaining({status: 'completed', title: 'Inspect post-upgrade readiness'}),
    ]))
  })

  it('uses the default readiness runner and synthesizes fallback blockers for failed follow-up checks', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      kind: 'splice-localnet',
      networkName: 'localnet',
      profileName: 'splice-localnet',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: 'http://ledger.localhost:3001'},
        localnet: {version: '0.5.0'},
        scan: {url: 'http://scan.localhost:3012'},
        validator: {url: 'http://validator.localhost:3003'},
      },
    }))
    const {localnet, workspace} = createLocalnetHarness()
    const readiness = {
      run: vi.fn().mockResolvedValue({
        ...createReadinessReport(false),
        rollout: {
          mode: 'dry-run',
          operation: 'readiness',
          partial: false,
          resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
          steps: [{
            blockers: [],
            dependencies: [],
            effect: 'read',
            id: 'wallet-gateway',
            owner: 'cantonctl',
            postconditions: [],
            preconditions: [],
            runbook: [],
            status: 'failed',
            title: 'Wallet gateway follow-up',
            warnings: [],
          }],
          success: false,
          summary: {blocked: 0, completed: 0, dryRun: 0, failed: 1, manual: 0, pending: 0, ready: 0, warned: 0},
        },
      }),
    }
    const createReadinessRunner = vi.spyOn(readinessModule, 'createReadinessRunner').mockReturnValue(readiness as never)
    const runner = createUpgradeRunner({
      createLocalnet: () => localnet,
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7}}),
        metadata: {baseUrl: 'http://scan.localhost:3012', warnings: []},
      }),
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'apply',
      profileName: 'splice-localnet',
      workspace,
    })

    expect(createReadinessRunner).toHaveBeenCalledOnce()
    expect(report.success).toBe(false)
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Inspect post-upgrade readiness',
        status: 'blocked',
        blockers: expect.arrayContaining([
          expect.objectContaining({
            code: 'readiness-wallet-gateway',
            detail: 'Wallet gateway follow-up blocked the upgrade workflow.',
          }),
        ]),
      }),
    ]))
  })

  it('downgrades missing scan metadata to a warning for local profiles', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      kind: 'splice-localnet',
      networkName: 'localnet',
      profileName: 'splice-localnet',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: 'http://ledger.localhost:3001'},
        localnet: {version: '0.5.0'},
        validator: {url: 'http://validator.localhost:3003'},
      },
    }))
    const runner = createUpgradeRunner({
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn(),
    })

    const report = await runner.run({config: createConfig(), profileName: 'splice-localnet'})

    expect(report.success).toBe(true)
    expect(report.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'scan-missing', severity: 'warn'}),
    ]))
  })

  it('supports the check alias and emits localnet planning advisories and runbooks', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      authExperimental: true,
      kind: 'splice-localnet',
      networkName: 'localnet',
      profileName: 'splice-localnet',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: 'http://ledger.localhost:3001'},
        localnet: {},
        validator: {url: 'http://validator.localhost:3003'},
      },
    }))
    const runner = createUpgradeRunner({
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn(),
    })

    const report = await runner.check({
      config: createConfig(),
      profileName: 'splice-localnet',
      workspace: '/workspace',
    })

    expect(report.rollout.mode).toBe('plan')
    expect(report.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'version-line', severity: 'warn'}),
      expect.objectContaining({code: 'experimental-target', severity: 'warn'}),
      expect.objectContaining({code: 'scan-missing', severity: 'warn'}),
    ]))
    const manualStep = report.rollout.steps.find(step => step.id === 'review-manual-upgrade-runbook')
    expect(manualStep?.runbook).toEqual(expect.arrayContaining([
      expect.objectContaining({title: 'Prepare upstream LocalNet change'}),
      expect.objectContaining({title: 'Review pinned version line'}),
      expect.objectContaining({title: 'Review experimental target'}),
      expect.objectContaining({title: 'Accept limited migration visibility'}),
    ]))
  })

  it('uses the local runtime manual-only branch for non-remote profiles', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      kind: 'canton-multi',
      networkName: 'local',
      profileName: 'local-multi',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: 'http://localhost:7575'},
      },
    }))
    const runner = createUpgradeRunner({
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn(),
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'plan',
      profileName: 'local-multi',
    })

    expect(report.automation.detail).toContain('workflow plan-first and manual-only')
    const manualStep = report.rollout.steps.find(step => step.id === 'review-manual-upgrade-runbook')
    expect(manualStep?.runbook).toEqual(expect.arrayContaining([
      expect.objectContaining({owner: 'cantonctl', title: 'Use the owning local runtime workflow'}),
    ]))
  })

  it('turns readiness failures without explicit blockers into synthesized workflow blockers', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime({
      kind: 'splice-localnet',
      networkName: 'localnet',
      profileName: 'splice-localnet',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: 'http://ledger.localhost:3001'},
        localnet: {version: '0.5.0'},
        scan: {url: 'http://scan.localhost:3012'},
        validator: {url: 'http://validator.localhost:3003'},
      },
    }))
    const localnet = {
      down: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({
        containers: [],
        health: {validatorReadyz: {body: 'ok', healthy: true, status: 200, url: 'http://validator.localhost:3003/readyz'}},
        profiles: {
          sv: {
            health: {validatorReadyz: 'http://validator.localhost:3003/readyz'},
            name: 'sv' as const,
            urls: {
              ledger: 'http://ledger.localhost:3001',
              scan: 'http://scan.localhost:3012',
              validator: 'http://validator.localhost:3003',
              wallet: 'http://wallet.localhost:3000',
            },
          },
        },
        selectedProfile: 'sv' as const,
        services: {
          ledger: {url: 'http://ledger.localhost:3001'},
          scan: {url: 'http://scan.localhost:3012'},
          validator: {url: 'http://validator.localhost:3003'},
          wallet: {url: 'http://wallet.localhost:3000'},
        },
        workspace: {
          composeFilePath: '/workspace/compose.yaml',
          configDir: '/workspace/docker/modules/localnet/conf',
          env: {SPLICE_VERSION: '0.5.0'},
          localnetDir: '/workspace/docker/modules/localnet',
          makeTargets: {down: 'stop', status: 'status', up: 'start'},
          profiles: {} as never,
          root: '/workspace',
        },
      }),
      up: vi.fn().mockResolvedValue({
        containers: [],
        health: {validatorReadyz: {body: 'ok', healthy: true, status: 200, url: 'http://validator.localhost:3003/readyz'}},
        profiles: {} as never,
        selectedProfile: 'sv' as const,
        services: {
          ledger: {url: 'http://ledger.localhost:3001'},
          scan: {url: 'http://scan.localhost:3012'},
          validator: {url: 'http://validator.localhost:3003'},
          wallet: {url: 'http://wallet.localhost:3000'},
        },
        workspace: {
          composeFilePath: '/workspace/compose.yaml',
          configDir: '/workspace/docker/modules/localnet/conf',
          env: {SPLICE_VERSION: '0.5.0'},
          localnetDir: '/workspace/docker/modules/localnet',
          makeTargets: {down: 'stop', status: 'status', up: 'start'},
          profiles: {} as never,
          root: '/workspace',
        },
      }),
    } as never
    const readiness = {
      run: vi.fn().mockResolvedValue({
        ...createReadinessReport(false),
        canary: {
          checks: [{
            detail: 'wallet degraded',
            endpoint: 'https://validator.example.com',
            status: 'warn',
            suite: 'wallet gateway',
            warnings: ['slow responses'],
          }],
          selectedSuites: ['wallet gateway'],
          skippedSuites: [],
          success: false,
        },
        rollout: {
          mode: 'dry-run',
          operation: 'readiness',
          partial: false,
          resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
          steps: [{
            blockers: [{
              code: 'readiness-policy',
              detail: 'Follow-up verification failed.',
            }],
            dependencies: [],
            detail: 'Follow-up verification failed.',
            effect: 'read',
            id: 'follow-up',
            owner: 'cantonctl',
            postconditions: [],
            preconditions: [],
            runbook: [],
            status: 'blocked',
            title: 'Follow-up verification',
            warnings: [],
          }],
          success: false,
          summary: {blocked: 0, completed: 0, dryRun: 0, failed: 1, manual: 0, pending: 0, ready: 0, warned: 1},
        },
      }),
    }
    const runner = createUpgradeRunner({
      createLocalnet: () => localnet,
      createProfileRuntimeResolver: () => ({resolve}),
      createReadinessRunner: () => readiness as never,
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7}}),
        metadata: {baseUrl: 'http://scan.localhost:3012', warnings: []},
      }),
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'apply',
      profileName: 'splice-localnet',
      workspace: '/workspace',
    })

    expect(report.success).toBe(false)
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Inspect post-upgrade readiness',
        status: 'blocked',
        blockers: expect.arrayContaining([
          expect.objectContaining({code: 'readiness-policy', detail: 'Follow-up verification failed.'}),
        ]),
        warnings: expect.arrayContaining([
          expect.objectContaining({code: 'canary-wallet-gateway-0-warning-0', detail: 'slow responses'}),
        ]),
      }),
    ]))
  })

  it('persists the last upgrade summary for diagnostics bundles', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
    const writeLastOperation = vi.fn().mockResolvedValue({file: '/project/.cantonctl/control-plane/last-operation.json'})
    const runner = createUpgradeRunner({
      createAuditStore: () => ({
        readLastOperation: vi.fn(),
        writeLastOperation,
      }),
      createProfileRuntimeResolver: () => ({resolve}),
      createScanAdapter: vi.fn().mockReturnValue({
        getDsoInfo: vi.fn().mockResolvedValue({migration: {migration_id: 7}}),
        metadata: {baseUrl: 'https://scan.example.com', warnings: []},
      }),
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'plan',
      profileName: 'splice-devnet',
      projectDir: '/project',
    })

    expect(report.success).toBe(true)
    expect(writeLastOperation).toHaveBeenCalledWith({
      projectDir: '/project',
      record: expect.objectContaining({
        command: 'upgrade check',
        context: expect.objectContaining({
          automation: expect.objectContaining({kind: 'manual-only'}),
          profile: expect.objectContaining({name: 'splice-devnet'}),
        }),
        mode: 'plan',
      }),
    })
  })
})
