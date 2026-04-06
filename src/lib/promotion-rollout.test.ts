import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from './config.js'
import * as lifecycleDiffModule from './lifecycle/diff.js'
import * as preflightChecksModule from './preflight/checks.js'
import {createPromotionRunner} from './promotion-rollout.js'
import * as readinessModule from './readiness.js'
import {createPreflightRolloutContract, createReadinessRolloutContract} from './rollout-contract.js'
import type {RuntimeInventory} from './runtime-inventory.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    profiles: {
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.devnet.example.com'},
          scan: {url: 'https://scan.devnet.example.com'},
        },
      },
      'splice-testnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-testnet',
        services: {
          ledger: {url: 'https://ledger.testnet.example.com'},
          scan: {url: 'https://scan.testnet.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createInventory(): RuntimeInventory {
  return {
    capabilities: [],
    drift: [],
    mode: 'profile',
    profile: {
      experimental: false,
      kind: 'remote-validator',
      name: 'splice-testnet',
      resolvedFrom: 'argument',
    },
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
  }
}

function createPreflightReport(success: boolean) {
  const reconcile = {
    runbook: success
      ? [{
        code: 'align-upstream-line',
        command: 'make align-upstream-line',
        detail: 'Re-pin the runtime line before rollout.',
        owner: 'official-stack' as const,
        targets: ['compatibility'],
        title: 'Align runtime versions',
      }]
      : [],
    summary: {failed: success ? 0 : 1, info: 0, manualRunbooks: success ? 1 : 0, supportedActions: 0, warned: 0},
    supportedActions: [],
  }
  const checks: Array<{
    category: 'profile' | 'scan'
    detail: string
    name: string
    status: 'fail' | 'pass' | 'warn'
  }> = [{
    category: 'scan' as const,
    detail: success ? 'Scan reachable.' : 'Scan failed.',
    name: 'Scan reachability',
    status: success ? 'pass' as const : 'fail' as const,
  }]

  if (success) {
    checks.push({
      category: 'profile',
      detail: 'Compatibility baseline passed with advisory warnings.',
      name: 'Compatibility baseline',
      status: 'warn',
    })
  }

  return {
    auth: {
      app: {
        credentialSource: 'stored' as const,
        envVarName: 'CANTONCTL_JWT_SPLICE_TESTNET',
        required: true,
      },
      credentialSource: 'stored' as const,
      envVarName: 'CANTONCTL_JWT_SPLICE_TESTNET',
      mode: 'env-or-keychain-jwt' as const,
      operator: {
        credentialSource: 'stored' as const,
        description: 'Use an explicitly supplied operator JWT for remote control-plane mutations.',
        envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_TESTNET',
        prerequisites: [],
        required: true,
      },
      warnings: success ? ['Token is near expiry.'] : [],
    },
    checks,
    compatibility: {failed: success ? 0 : 1, passed: 2, warned: 0},
    drift: [],
    egressIp: success ? '203.0.113.10' : undefined,
    inventory: createInventory(),
    network: {
      checklist: [],
      name: 'splice-testnet',
      reminders: [],
      resetExpectation: 'resets-expected' as const,
      tier: 'testnet' as const,
    },
    profile: {
      experimental: false,
      kind: 'remote-validator' as const,
      name: 'splice-testnet',
    },
    reconcile,
    rollout: createPreflightRolloutContract({
      checks,
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-testnet',
      },
      reconcile,
    }),
    success,
  }
}

function createReadinessReport(success: boolean) {
  const preflight = createPreflightReport(success)
  const canaryChecks = [{
    detail: success ? 'Stable/public scan endpoint reachable.' : 'Stable/public scan endpoint failed.',
    endpoint: 'https://scan.testnet.example.com',
    status: success ? 'pass' as const : 'fail' as const,
    suite: 'scan' as const,
    warnings: success ? ['Latency increased.'] : [],
  }]

  return {
    auth: preflight.auth,
    canary: {
      checks: canaryChecks,
      selectedSuites: ['scan'] as const,
      skippedSuites: ['ans', 'token-standard', 'validator-user'] as const,
      success,
    },
    compatibility: preflight.compatibility,
    drift: preflight.drift,
    inventory: preflight.inventory,
    preflight,
    profile: preflight.profile,
    reconcile: preflight.reconcile,
    rollout: createReadinessRolloutContract({
      canary: {checks: canaryChecks},
      preflight: {
        profile: preflight.profile,
        rollout: preflight.rollout,
      },
    }),
    success,
    summary: {
      failed: success ? 0 : 2,
      passed: success ? 2 : 0,
      skipped: 3,
      warned: success ? 1 : 0,
    },
  }
}

describe('createPromotionRunner', () => {
  it('keeps plan mode static and avoids live gate execution', async () => {
    const compare = vi.fn().mockResolvedValue({
      advisories: [
        {code: 'network-tier', message: 'Cross-tier promotion requires a runbook.', severity: 'warn'},
        {code: 'reset-sensitive', message: 'Capture reset-sensitive assumptions.', severity: 'warn'},
      ],
      from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
      services: [{change: 'changed', from: 'https://scan.devnet.example.com', name: 'scan', to: 'https://scan.testnet.example.com'}],
      success: true,
      summary: {failed: 0, info: 0, warned: 2},
      to: {experimental: false, kind: 'remote-validator', name: 'splice-testnet', network: 'splice-testnet', tier: 'testnet'},
    })
    const preflightRun = vi.fn()
    const readinessRun = vi.fn()

    const runner = createPromotionRunner({
      createLifecycleDiff: () => ({compare}),
      createPreflightRunner: () => ({run: preflightRun}),
      createReadinessRunner: () => ({run: readinessRun}),
    })

    const result = await runner.run({
      config: createConfig(),
      fromProfile: 'splice-devnet',
      toProfile: 'splice-testnet',
    })

    expect(compare).toHaveBeenCalledTimes(1)
    expect(preflightRun).not.toHaveBeenCalled()
    expect(readinessRun).not.toHaveBeenCalled()
    expect(result.preflight).toBeUndefined()
    expect(result.readiness).toBeUndefined()
    expect(result.success).toBe(true)
    expect(result.rollout.mode).toBe('plan')
    expect(result.rollout.summary).toEqual({
      blocked: 0,
      completed: 0,
      dryRun: 0,
      failed: 0,
      manual: 1,
      pending: 0,
      ready: 4,
      warned: 2,
    })
  })

  it('runs live target gates in dry-run mode and blocks rollout validation when gates fail', async () => {
    const compare = vi.fn().mockResolvedValue({
      advisories: [
        {code: 'scan-missing', message: 'Target profile does not expose a stable/public scan endpoint.', severity: 'fail'},
      ],
      from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
      services: [],
      success: false,
      summary: {failed: 1, info: 0, warned: 0},
      to: {experimental: false, kind: 'remote-validator', name: 'splice-testnet', network: 'splice-testnet', tier: 'testnet'},
    })
    const preflight = createPreflightReport(false)
    const readiness = createReadinessReport(false)
    const preflightRun = vi.fn().mockResolvedValue(preflight)
    const readinessRun = vi.fn().mockResolvedValue(readiness)

    const runner = createPromotionRunner({
      createLifecycleDiff: () => ({compare}),
      createPreflightRunner: () => ({run: preflightRun}),
      createReadinessRunner: () => ({run: readinessRun}),
    })

    const result = await runner.run({
      config: createConfig(),
      fromProfile: 'splice-devnet',
      mode: 'dry-run',
      toProfile: 'splice-testnet',
    })

    expect(preflightRun).toHaveBeenCalledWith({
      config: createConfig(),
      profileName: 'splice-testnet',
      signal: undefined,
    })
    expect(readinessRun).toHaveBeenCalledWith({
      config: createConfig(),
      profileName: 'splice-testnet',
      signal: undefined,
    })
    expect(result.preflight).toBe(preflight)
    expect(result.readiness).toBe(readiness)
    expect(result.success).toBe(false)
    expect(result.rollout.mode).toBe('dry-run')
    expect(result.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({status: 'completed', title: 'Inspect target preflight gate'}),
      expect.objectContaining({status: 'completed', title: 'Inspect target readiness gate'}),
      expect.objectContaining({
        blockers: expect.arrayContaining([
          expect.objectContaining({code: 'scan-missing'}),
          expect.objectContaining({code: 'scan-scan-reachability-failed'}),
          expect.objectContaining({code: 'scan-canary-failed'}),
        ]),
        status: 'blocked',
        title: 'Validate rollout gate',
      }),
    ]))
  })

  it('keeps apply mode on the shared rollout contract and preserves manual runbooks', async () => {
    const compare = vi.fn().mockResolvedValue({
      advisories: [
        {code: 'migration-policy', message: 'Review migration continuity before rollout.', severity: 'warn'},
        {code: 'sponsor-reminder', message: 'Confirm sponsor-owned inputs before rollout.', severity: 'warn'},
        {code: 'version-line', message: 'LocalNet version line changes across promotion.', severity: 'warn'},
        {code: 'experimental-target', message: 'Target profile is experimental.', severity: 'warn'},
      ],
      from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
      services: [{change: 'changed', from: 'https://scan.devnet.example.com', name: 'scan', to: 'https://scan.testnet.example.com'}],
      success: true,
      summary: {failed: 0, info: 0, warned: 4},
      to: {experimental: true, kind: 'remote-validator', name: 'splice-testnet', network: 'splice-testnet', tier: 'testnet'},
    })
    const preflight = createPreflightReport(true)
    const readiness = createReadinessReport(true)

    const runner = createPromotionRunner({
      createLifecycleDiff: () => ({compare}),
      createPreflightRunner: () => ({run: vi.fn().mockResolvedValue(preflight)}),
      createReadinessRunner: () => ({run: vi.fn().mockResolvedValue(readiness)}),
    })

    const result = await runner.run({
      config: createConfig(),
      fromProfile: 'splice-devnet',
      mode: 'apply',
      toProfile: 'splice-testnet',
    })

    expect(result.success).toBe(true)
    expect(result.rollout.mode).toBe('apply')
    expect(result.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runbook: expect.arrayContaining([
          expect.objectContaining({code: 'migration-policy', title: 'Review migration continuity'}),
          expect.objectContaining({code: 'sponsor-reminder', title: 'Confirm sponsor-owned inputs'}),
          expect.objectContaining({code: 'version-line', title: 'Review LocalNet version line'}),
          expect.objectContaining({code: 'experimental-target', title: 'Review experimental target'}),
          expect.objectContaining({code: 'align-upstream-line', title: 'Align runtime versions'}),
        ]),
        status: 'manual',
        title: 'Review manual promotion runbook',
      }),
      expect.objectContaining({
        detail: 'Promotion rollout gates passed for splice-testnet.',
        status: 'completed',
        title: 'Validate rollout gate',
      }),
    ]))
  })

  it('uses the default factories when deps are omitted', async () => {
    const compare = vi.fn().mockResolvedValue({
      advisories: [{code: 'network-tier', message: 'Cross-tier promotion requires a runbook.', severity: 'warn'}],
      from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
      services: [{change: 'changed', from: 'https://scan.devnet.example.com', name: 'scan', to: 'https://scan.testnet.example.com'}],
      success: true,
      summary: {failed: 0, info: 0, warned: 1},
      to: {experimental: false, kind: 'remote-validator', name: 'splice-testnet', network: 'splice-testnet', tier: 'testnet'},
    })
    const preflight = createPreflightReport(true)
    const readiness = createReadinessReport(true)
    const createDiffSpy = vi
      .spyOn(lifecycleDiffModule, 'createLifecycleDiff')
      .mockReturnValue({compare})
    const createPreflightSpy = vi
      .spyOn(preflightChecksModule, 'createPreflightChecks')
      .mockReturnValue({run: vi.fn().mockResolvedValue(preflight)})
    const createReadinessSpy = vi
      .spyOn(readinessModule, 'createReadinessRunner')
      .mockReturnValue({run: vi.fn().mockResolvedValue(readiness)})

    const result = await createPromotionRunner().run({
      config: createConfig(),
      fromProfile: 'splice-devnet',
      mode: 'dry-run',
      toProfile: 'splice-testnet',
    })

    expect(createDiffSpy).toHaveBeenCalledTimes(1)
    expect(createPreflightSpy).toHaveBeenCalledTimes(1)
    expect(createReadinessSpy).toHaveBeenCalledTimes(1)
    expect(result.rollout.mode).toBe('dry-run')
    expect(result.preflight).toBe(preflight)
    expect(result.readiness).toBe(readiness)
  })

  it('rethrows comparison failures when the source-to-target diff cannot be computed', async () => {
    const runner = createPromotionRunner({
      createLifecycleDiff: () => ({
        compare: vi.fn().mockRejectedValue(new Error('compare boom')),
      }),
    })

    await expect(runner.run({
      config: createConfig(),
      fromProfile: 'splice-devnet',
      mode: 'plan',
      toProfile: 'splice-testnet',
    })).rejects.toThrow('compare boom')
  })

  it('falls back to blocked rollout-step details when live reports do not provide explicit blockers', async () => {
    const compare = vi.fn().mockResolvedValue({
      advisories: [],
      from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
      services: [],
      success: true,
      summary: {failed: 0, info: 0, warned: 0},
      to: {experimental: false, kind: 'remote-validator', name: 'splice-testnet', network: 'splice-testnet', tier: 'testnet'},
    })
    const preflight = createPreflightReport(true)
    const readiness = {
      ...createReadinessReport(true),
      rollout: {
        ...createReadinessReport(true).rollout,
        steps: [{
          blockers: [],
          dependencies: [],
          effect: 'read' as const,
          id: 'synthetic-readiness-blocker',
          owner: 'cantonctl' as const,
          postconditions: [],
          preconditions: [],
          runbook: [],
          status: 'blocked' as const,
          title: 'Synthetic readiness blocker',
          warnings: [],
        }],
        success: false,
        summary: {
          blocked: 1,
          completed: 0,
          dryRun: 0,
          failed: 0,
          manual: 0,
          pending: 0,
          ready: 0,
          warned: 0,
        },
      },
      success: false,
    }

    const runner = createPromotionRunner({
      createLifecycleDiff: () => ({compare}),
      createPreflightRunner: () => ({run: vi.fn().mockResolvedValue(preflight)}),
      createReadinessRunner: () => ({run: vi.fn().mockResolvedValue(readiness)}),
    })

    const result = await runner.run({
      config: createConfig(),
      fromProfile: 'splice-devnet',
      mode: 'dry-run',
      toProfile: 'splice-testnet',
    })

    expect(result.success).toBe(false)
    expect(result.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        blockers: expect.arrayContaining([
          expect.objectContaining({
            code: 'readiness-synthetic-readiness-blocker',
            detail: 'Synthetic readiness blocker blocked the rollout gate.',
          }),
        ]),
        status: 'blocked',
        title: 'Validate rollout gate',
      }),
    ]))
  })

  it('preserves plain manual runbook details when target preflight items do not include commands', async () => {
    const compare = vi.fn().mockResolvedValue({
      advisories: [],
      from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
      services: [],
      success: true,
      summary: {failed: 0, info: 0, warned: 0},
      to: {experimental: false, kind: 'remote-validator', name: 'splice-testnet', network: 'splice-testnet', tier: 'testnet'},
    })
    const preflight = createPreflightReport(true)
    preflight.reconcile.runbook = [{
      ...preflight.reconcile.runbook[0],
      command: '',
    }]
    const readiness = createReadinessReport(true)

    const runner = createPromotionRunner({
      createLifecycleDiff: () => ({compare}),
      createPreflightRunner: () => ({run: vi.fn().mockResolvedValue(preflight)}),
      createReadinessRunner: () => ({run: vi.fn().mockResolvedValue(readiness)}),
    })

    const result = await runner.run({
      config: createConfig(),
      fromProfile: 'splice-devnet',
      mode: 'apply',
      toProfile: 'splice-testnet',
    })

    expect(result.rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runbook: expect.arrayContaining([
          expect.objectContaining({
            code: 'align-upstream-line',
            detail: 'Re-pin the runtime line before rollout.',
          }),
        ]),
        title: 'Review manual promotion runbook',
      }),
    ]))
  })
})
