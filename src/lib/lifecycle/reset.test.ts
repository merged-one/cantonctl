import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../config.js'
import * as profileRuntimeModule from '../profile-runtime.js'
import type {ResolvedProfileRuntime} from '../profile-runtime.js'
import * as readinessModule from '../readiness.js'
import {createResetRunner} from './reset.js'

function createConfig(): CantonctlConfig {
  return {
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createRuntime(
  kind: ResolvedProfileRuntime['profile']['kind'] = 'splice-localnet',
): ResolvedProfileRuntime {
  return {
    auth: {
      app: {
        description: '',
        envVarName: 'CANTONCTL_JWT_LOCALNET',
        keychainAccount: 'localnet',
        localFallbackAllowed: false,
        prerequisites: [],
        required: true,
        scope: 'app',
      },
      authKind: 'jwt',
      description: '',
      envVarName: 'CANTONCTL_JWT_LOCALNET',
      experimental: false,
      mode: 'env-or-keychain-jwt',
      network: 'localnet',
      operator: {
        description: '',
        envVarName: 'CANTONCTL_OPERATOR_TOKEN_LOCALNET',
        keychainAccount: 'operator:localnet',
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
      profile: {experimental: false, kind, name: kind === 'splice-localnet' ? 'splice-localnet' : 'remote-reset'},
      services: [],
      warned: 0,
    },
    credential: {
      mode: 'env-or-keychain-jwt',
      network: 'localnet',
      scope: 'app',
      source: 'stored',
      token: 'app-token',
    },
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
    networkName: 'localnet',
    operatorCredential: {
      mode: 'env-or-keychain-jwt',
      network: 'localnet',
      scope: 'operator',
      source: 'missing',
    },
    profile: {
      experimental: false,
      kind,
      name: kind === 'splice-localnet' ? 'splice-localnet' : 'remote-reset',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: kind === 'splice-localnet' ? 'http://ledger.localhost:3001' : 'https://ledger.example.com'},
        ...(kind === 'splice-localnet' ? {localnet: {version: '0.5.0'}} : {}),
        ...(kind === 'splice-localnet' ? {scan: {url: 'http://scan.localhost:3012'}} : {scan: {url: 'https://scan.example.com'}}),
        ...(kind === 'splice-localnet' ? {validator: {url: 'http://validator.localhost:3003'}} : {validator: {url: 'https://validator.example.com'}}),
      },
    },
    profileContext: {
      experimental: false,
      kind,
      name: kind === 'splice-localnet' ? 'splice-localnet' : 'remote-reset',
      services: {
        auth: {kind: 'jwt', url: 'https://auth.example.com'},
        ledger: {url: kind === 'splice-localnet' ? 'http://ledger.localhost:3001' : 'https://ledger.example.com'},
        ...(kind === 'splice-localnet' ? {localnet: {version: '0.5.0'}} : {}),
        ...(kind === 'splice-localnet' ? {scan: {url: 'http://scan.localhost:3012'}} : {scan: {url: 'https://scan.example.com'}}),
        ...(kind === 'splice-localnet' ? {validator: {url: 'http://validator.localhost:3003'}} : {validator: {url: 'https://validator.example.com'}}),
      },
    },
    services: [],
  }
}

function createReadinessReport(success: boolean) {
  return {
    auth: {scope: 'app', source: 'stored', warnings: []},
    canary: {checks: [], selectedSuites: [], skippedSuites: [], success},
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
        steps: success ? [] : [{
          blockers: [{code: 'health', detail: 'degraded'}],
          dependencies: [],
          effect: 'read',
          id: 'ready',
          owner: 'cantonctl',
          postconditions: [],
          preconditions: [],
          runbook: [],
          status: 'blocked',
          title: 'Readiness',
          warnings: [],
        }],
        success,
        summary: {blocked: success ? 0 : 1, completed: 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
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
      steps: success ? [] : [{
        blockers: [{code: 'health', detail: 'degraded'}],
        dependencies: [],
        effect: 'read',
        id: 'ready',
        owner: 'cantonctl',
        postconditions: [],
        preconditions: [],
        runbook: [],
        status: 'blocked',
        title: 'Readiness',
        warnings: [],
      }],
      success,
      summary: {blocked: success ? 0 : 1, completed: 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
    },
    success,
    summary: {failed: success ? 0 : 1, passed: 0, skipped: 0, warned: 0},
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

describe('reset workflow', () => {
  it('returns plan-first reset checklists for named network tiers', async () => {
    const report = await createResetRunner().run({network: 'devnet'})

    expect(report.success).toBe(true)
    expect(report.network).toEqual(expect.objectContaining({
      name: 'devnet',
      resetExpectation: 'resets-expected',
      tier: 'devnet',
    }))
    expect(report.checklist.length).toBeGreaterThan(0)
    expect(report.rollout.mode).toBe('plan')
  })

  it('blocks apply mode for remote manual-only reset targets', async () => {
    const report = await createResetRunner().run({mode: 'apply', network: 'mainnet'})

    expect(report.success).toBe(false)
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'blocked',
        title: 'Validate reset workflow',
        blockers: expect.arrayContaining([
          expect.objectContaining({code: 'apply-unsupported'}),
        ]),
      }),
    ]))
  })

  it('runs dry-run validation for remote manual-only reset targets', async () => {
    const report = await createResetRunner().run({mode: 'dry-run', network: 'devnet'})

    expect(report.success).toBe(true)
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Validate reset workflow',
        status: 'completed',
        detail: 'Reset workflow stays manual-only for this target.',
      }),
    ]))
  })

  it('requires a workspace before running live LocalNet reset modes', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
    const runner = createResetRunner({
      createProfileRuntimeResolver: () => ({resolve}),
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'dry-run',
      profileName: 'splice-localnet',
    })

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

  it('cycles the LocalNet workspace and runs post-reset readiness in apply mode', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
    const {localnet, workspace} = createLocalnetHarness()
    const readiness = {run: vi.fn().mockResolvedValue(createReadinessReport(true))}
    const runner = createResetRunner({
      createLocalnet: () => localnet,
      createProfileRuntimeResolver: () => ({resolve}),
      createReadinessRunner: () => readiness,
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
      expect.objectContaining({status: 'completed', title: 'Inspect post-reset readiness'}),
    ]))
  })

  it('uses the default resolver and readiness runner for profile-based LocalNet reset apply flows', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
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
            id: 'post-reset',
            owner: 'cantonctl',
            postconditions: [],
            preconditions: [],
            runbook: [],
            status: 'failed',
            title: 'Post-reset validation',
            warnings: [],
          }],
          success: false,
          summary: {blocked: 0, completed: 0, dryRun: 0, failed: 1, manual: 0, pending: 0, ready: 0, warned: 0},
        },
      }),
    }
    const createProfileRuntimeResolver = vi.spyOn(profileRuntimeModule, 'createProfileRuntimeResolver')
      .mockReturnValue({resolve} as never)
    const createReadinessRunner = vi.spyOn(readinessModule, 'createReadinessRunner')
      .mockReturnValue(readiness as never)
    const runner = createResetRunner({
      createLocalnet: () => localnet,
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'apply',
      profileName: 'splice-localnet',
      workspace,
    })

    expect(createProfileRuntimeResolver).toHaveBeenCalledOnce()
    expect(createReadinessRunner).toHaveBeenCalledOnce()
    expect(report.success).toBe(false)
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Inspect post-reset readiness',
        status: 'blocked',
        blockers: expect.arrayContaining([
          expect.objectContaining({
            code: 'readiness-post-reset',
            detail: 'Post-reset validation blocked the reset workflow.',
          }),
        ]),
      }),
    ]))
  })

  it('supports the createChecklist alias for profile-based localnet plans', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
    const runner = createResetRunner({
      createProfileRuntimeResolver: () => ({resolve}),
    })

    const report = await runner.createChecklist({
      config: createConfig(),
      profileName: 'splice-localnet',
      workspace: '/workspace',
    })

    expect(report.rollout.mode).toBe('plan')
    expect(report.automation.kind).toBe('localnet-cycle')
    expect(report.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({status: 'manual', title: 'Review manual reset runbook'}),
      expect.objectContaining({status: 'ready', title: 'Validate reset workflow'}),
    ]))
  })

  it('keeps non-local profiles manual-only with an explicit owning runbook', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime('remote-validator'))
    const runner = createResetRunner({
      createProfileRuntimeResolver: () => ({resolve}),
    })

    const report = await runner.run({
      config: createConfig(),
      profileName: 'remote-reset',
    })

    expect(report.success).toBe(true)
    expect(report.automation.detail).toContain('manual-only')
    const manualStep = report.rollout.steps.find(step => step.id === 'review-manual-reset-runbook')
    expect(manualStep?.runbook).toEqual(expect.arrayContaining([
      expect.objectContaining({title: 'Run the owning reset procedure'}),
    ]))
  })

  it('rejects profile-based reset workflows without config and missing targets entirely', async () => {
    await expect(createResetRunner().run({profileName: 'splice-localnet'}))
      .rejects.toMatchObject({code: 'E1003'})
    await expect(createResetRunner().run({}))
      .rejects.toMatchObject({code: 'E1003'})
  })

  it('synthesizes readiness blockers and warnings during reset validation', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
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
            detail: 'reset canary warning',
            endpoint: 'https://validator.example.com',
            status: 'warn',
            suite: 'wallet gateway',
            warnings: ['operator review needed'],
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
              detail: 'Reset readiness follow-up failed.',
            }],
            dependencies: [],
            detail: 'Reset readiness follow-up failed.',
            effect: 'read',
            id: 'follow-up',
            owner: 'cantonctl',
            postconditions: [],
            preconditions: [],
            runbook: [],
            status: 'blocked',
            title: 'Reset follow-up',
            warnings: [],
          }],
          success: false,
          summary: {blocked: 0, completed: 0, dryRun: 0, failed: 1, manual: 0, pending: 0, ready: 0, warned: 1},
        },
      }),
    }
    const runner = createResetRunner({
      createLocalnet: () => localnet,
      createProfileRuntimeResolver: () => ({resolve}),
      createReadinessRunner: () => readiness as never,
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
        title: 'Inspect post-reset readiness',
        status: 'blocked',
        blockers: expect.arrayContaining([
          expect.objectContaining({code: 'readiness-policy', detail: 'Reset readiness follow-up failed.'}),
        ]),
        warnings: expect.arrayContaining([
          expect.objectContaining({code: 'canary-wallet-gateway-0-warning-0', detail: 'operator review needed'}),
        ]),
      }),
    ]))
  })

  it('persists the last reset summary for diagnostics bundles', async () => {
    const resolve = vi.fn().mockResolvedValue(createRuntime())
    const writeLastOperation = vi.fn().mockResolvedValue({file: '/project/.cantonctl/control-plane/last-operation.json'})
    const runner = createResetRunner({
      createAuditStore: () => ({
        readLastOperation: vi.fn(),
        writeLastOperation,
      }),
      createProfileRuntimeResolver: () => ({resolve}),
    })

    const report = await runner.run({
      config: createConfig(),
      mode: 'plan',
      profileName: 'splice-localnet',
      projectDir: '/project',
    })

    expect(report.success).toBe(true)
    expect(writeLastOperation).toHaveBeenCalledWith({
      projectDir: '/project',
      record: expect.objectContaining({
        command: 'reset checklist',
        context: expect.objectContaining({
          automation: expect.objectContaining({kind: 'localnet-cycle'}),
          target: {kind: 'profile', name: 'splice-localnet'},
        }),
        mode: 'plan',
      }),
    })
  })
})
