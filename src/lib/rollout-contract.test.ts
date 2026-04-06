import {describe, expect, it} from 'vitest'

import {
  createPreflightRolloutContract,
  createPromotionRunbookItem,
  createReadinessRolloutContract,
} from './rollout-contract.js'

describe('rollout-contract', () => {
  it('turns preflight checks and reconcile actions into a static rollout contract', () => {
    const rollout = createPreflightRolloutContract({
      checks: [
        {
          category: 'profile',
          detail: 'Resolved profile successfully.',
          name: 'Profile resolution',
          status: 'pass',
        },
        {
          category: 'scan',
          detail: 'Scan requires different auth material.',
          name: 'Scan reachability',
          status: 'warn',
        },
        {
          category: 'auth',
          detail: 'No credential available.',
          name: 'App credential material',
          status: 'fail',
        },
        {
          category: 'health',
          detail: 'Endpoint not exposed by this service.',
          name: 'Validator readyz',
          status: 'skip',
        },
      ],
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
      },
      reconcile: {
        runbook: [{
          code: 'align-upstream-line',
          detail: 'Re-pin the upstream line.',
          owner: 'official-stack',
          targets: ['compatibility'],
          title: 'Align upstream line',
        }],
        summary: {failed: 1, info: 0, manualRunbooks: 1, supportedActions: 1, warned: 1},
        supportedActions: [{
          code: 'resolve-auth',
          command: 'cantonctl auth login splice-devnet',
          detail: 'Store the missing credential.',
          owner: 'cantonctl',
          targets: ['app-auth'],
          title: 'Resolve app credentials',
        }],
      },
    })

    expect(rollout.mode).toBe('dry-run')
    expect(rollout.operation).toBe('preflight')
    expect(rollout.success).toBe(false)
    expect(rollout.summary).toEqual({
      blocked: 1,
      completed: 3,
      dryRun: 0,
      failed: 0,
      manual: 1,
      pending: 0,
      ready: 1,
      warned: 1,
    })
    expect(rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        blockers: [],
        detail: 'Resolved profile successfully.',
        status: 'completed',
        title: 'Profile resolution',
      }),
      expect.objectContaining({
        status: 'completed',
        title: 'Scan reachability',
        warnings: [{code: 'scan-scan-reachability-warning', detail: 'Scan requires different auth material.'}],
      }),
      expect.objectContaining({
        blockers: [{code: 'auth-app-credential-material-failed', detail: 'No credential available.'}],
        status: 'blocked',
        title: 'App credential material',
      }),
      expect.objectContaining({
        status: 'ready',
        title: 'Resolve app credentials',
      }),
      expect.objectContaining({
        runbook: [{
          code: 'align-upstream-line',
          detail: 'Re-pin the upstream line.',
          owner: 'official-stack',
          title: 'Align upstream line',
        }],
        status: 'manual',
        title: 'Align upstream line',
      }),
    ]))
  })

  it('extends preflight rollout steps with canary checks for readiness decisions', () => {
    const preflight = createPreflightRolloutContract({
      checks: [{
        category: 'profile',
        detail: 'Resolved profile successfully.',
        name: 'Profile resolution',
        status: 'pass',
      }],
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
      },
      reconcile: {
        runbook: [],
        summary: {failed: 0, info: 0, manualRunbooks: 0, supportedActions: 0, warned: 0},
        supportedActions: [],
      },
    })

    const readiness = createReadinessRolloutContract({
      canary: {
        checks: [
          {
            detail: 'Stable/public scan endpoint reachable.',
            endpoint: 'https://scan.example.com',
            status: 'pass',
            suite: 'scan',
            warnings: ['Latency increased.'],
          },
          {
            detail: 'Stable/public validator-user check failed.',
            endpoint: 'https://validator.example.com',
            status: 'fail',
            suite: 'validator-user',
            warnings: [],
          },
        ],
      },
      preflight: {
        profile: {
          experimental: false,
          kind: 'remote-validator',
          name: 'splice-devnet',
        },
        rollout: preflight,
      },
    })

    expect(readiness.operation).toBe('readiness')
    expect(readiness.success).toBe(false)
    expect(readiness.summary).toEqual({
      blocked: 1,
      completed: 2,
      dryRun: 0,
      failed: 0,
      manual: 0,
      pending: 0,
      ready: 0,
      warned: 1,
    })
    expect(readiness.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Canary scan',
        warnings: [{code: 'scan-warning-0', detail: 'Latency increased.'}],
      }),
      expect.objectContaining({
        blockers: [{code: 'validator-user-canary-failed', detail: 'Stable/public validator-user check failed.'}],
        status: 'blocked',
        title: 'Canary validator-user',
      }),
    ]))
  })

  it('creates promotion runbook items with an explicit owner override', () => {
    expect(createPromotionRunbookItem({
      code: 'operator-window',
      detail: 'Coordinate the operator-owned change window.',
      owner: 'operator',
      title: 'Schedule operator window',
    })).toEqual({
      code: 'operator-window',
      detail: 'Coordinate the operator-owned change window.',
      owner: 'operator',
      title: 'Schedule operator window',
    })
  })

  it('preserves plain supported-action details and appends commands inside manual runbooks', () => {
    const rollout = createPreflightRolloutContract({
      checks: [{
        category: 'profile',
        detail: 'Resolved profile successfully.',
        name: 'Profile resolution',
        status: 'pass',
      }],
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
      },
      reconcile: {
        runbook: [{
          code: 'official-cutover',
          command: 'make promote-testnet',
          detail: 'Use the official release workflow for the cutover.',
          owner: 'official-stack',
          targets: ['promotion'],
          title: 'Run the official cutover',
        }],
        summary: {failed: 0, info: 0, manualRunbooks: 1, supportedActions: 1, warned: 0},
        supportedActions: [{
          code: 'refresh-auth',
          detail: 'Refresh the local auth material before the rollout.',
          owner: 'cantonctl',
          targets: ['auth'],
          title: 'Refresh auth material',
        }],
      },
    })

    expect(rollout.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'Refresh the local auth material before the rollout.',
        status: 'ready',
        title: 'Refresh auth material',
      }),
      expect.objectContaining({
        runbook: [{
          code: 'official-cutover',
          detail: 'Use the official release workflow for the cutover. Command: make promote-testnet',
          owner: 'official-stack',
          title: 'Run the official cutover',
        }],
        status: 'manual',
        title: 'Run the official cutover',
      }),
    ]))
  })
})
