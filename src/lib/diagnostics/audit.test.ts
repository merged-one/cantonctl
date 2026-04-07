import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {afterEach, describe, expect, it, vi} from 'vitest'

import {
  createDeployAuditRecord,
  createDiagnosticsAuditStore,
  createPromotionAuditRecord,
  createResetAuditRecord,
  createUpgradeAuditRecord,
  persistDiagnosticsAuditRecord,
  redactSupportArtifact,
} from './audit.js'

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function createRollout(mode: 'apply' | 'dry-run' | 'plan' = 'apply') {
  return {
    description: 'Control-plane flow',
    mode,
    operation: 'upgrade',
    partial: false,
    resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
    steps: [{
      blockers: [{code: 'blocked', detail: 'needs input'}],
      dependencies: [],
      detail: 'step detail',
      effect: 'read' as const,
      id: 'step-1',
      owner: 'cantonctl' as const,
      postconditions: [],
      preconditions: [],
      runbook: [{code: 'manual', detail: 'manual step', owner: 'operator' as const, title: 'Manual'}],
      status: 'blocked' as const,
      title: 'Validate flow',
      warnings: [{code: 'warn', detail: 'careful'}],
    }],
    success: false,
    summary: {blocked: 1, completed: 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 1},
  }
}

describe('diagnostics audit store', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      fs.rmSync(dirs.pop()!, {force: true, recursive: true})
    }
  })

  it('writes and reads the last-operation artifact with redaction', async () => {
    const projectDir = createTempDir('cantonctl-audit-')
    dirs.push(projectDir)
    const store = createDiagnosticsAuditStore()

    const result = await store.writeLastOperation({
      projectDir,
      record: {
        command: 'upgrade check',
        context: {
          accessToken: 'abc123',
          auth: {token: 'secret-token'},
          bearerToken: 'Bearer top-secret',
          tokenStandard: {url: 'https://tokens.example.com'},
        },
        mode: 'apply',
        recordedAt: '2026-04-07T01:00:00.000Z',
        rollout: {
          operation: 'upgrade',
          partial: false,
          steps: [],
          success: true,
          summary: {blocked: 0, completed: 1, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
        },
        schemaVersion: 1,
        success: true,
      },
    })

    expect(result.file).toBe(path.join(projectDir, '.cantonctl', 'control-plane', 'last-operation.json'))
    const written = JSON.parse(fs.readFileSync(result.file, 'utf8')) as Record<string, unknown>
    expect(written.context).toEqual({
      accessToken: '[REDACTED]',
      auth: {token: '[REDACTED]'},
      bearerToken: '[REDACTED]',
      tokenStandard: {url: 'https://tokens.example.com'},
    })
    await expect(store.readLastOperation({projectDir})).resolves.toEqual(expect.objectContaining({
      command: 'upgrade check',
      success: true,
    }))
  })

  it('returns undefined when the last-operation artifact is absent and supports injected fs/path deps', async () => {
    const projectDir = createTempDir('cantonctl-audit-missing-')
    dirs.push(projectDir)
    const readFileSync = vi.fn(() => {
      throw new Error('missing')
    })
    const writeFileSync = vi.fn()
    const mkdir = vi.fn()
    const store = createDiagnosticsAuditStore({
      fs: {
        promises: {mkdir} as never,
        readFileSync,
        writeFileSync,
      },
      path,
    })

    await expect(store.readLastOperation({projectDir})).resolves.toBeUndefined()
    expect(readFileSync).toHaveBeenCalledWith(
      path.join(projectDir, '.cantonctl', 'control-plane', 'last-operation.json'),
      'utf8',
    )
    expect(writeFileSync).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('treats persistence as best-effort when the audit store write fails', async () => {
    await expect(persistDiagnosticsAuditRecord({
      createAuditStore: () => ({
        readLastOperation: vi.fn(),
        writeLastOperation: vi.fn().mockRejectedValue(new Error('disk full')),
      }),
      projectDir: '/tmp/project',
      record: {
        command: 'deploy',
        context: {},
        mode: 'apply',
        recordedAt: '2026-04-07T01:00:00.000Z',
        rollout: {
          operation: 'deploy',
          partial: false,
          steps: [],
          success: true,
          summary: {blocked: 0, completed: 1, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
        },
        schemaVersion: 1,
        success: true,
      },
    })).resolves.toBeUndefined()
  })

  it('uses the default audit store and preserves non-sensitive primitive values during redaction', async () => {
    const projectDir = createTempDir('cantonctl-audit-persist-')
    dirs.push(projectDir)

    await expect(persistDiagnosticsAuditRecord({
      projectDir,
      record: {
        command: 'upgrade check',
        context: {
          attempts: 2,
          labels: ['keep-me', 'Bearer top-secret'],
          optional: null,
          profile: {name: 'splice-devnet'},
        },
        mode: 'plan',
        recordedAt: '2026-04-07T01:05:00.000Z',
        rollout: {
          operation: 'upgrade',
          partial: false,
          steps: [],
          success: true,
          summary: {blocked: 0, completed: 1, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
        },
        schemaVersion: 1,
        success: true,
      },
    })).resolves.toBeUndefined()

    expect(fs.existsSync(path.join(projectDir, '.cantonctl', 'control-plane', 'last-operation.json'))).toBe(true)
    expect(redactSupportArtifact({
      attempts: 2,
      labels: ['keep-me', 'Bearer top-secret'],
      optional: null,
    })).toEqual({
      attempts: 2,
      labels: ['keep-me', '[REDACTED]'],
      optional: null,
    })
  })

  it('builds redacted deploy, promotion, upgrade, and reset audit records', () => {
    const deploy = createDeployAuditRecord({
      ...createRollout('plan'),
      artifact: {darPath: '/project/.daml/dist/demo.dar', sizeBytes: 3, source: 'auto-detected' as const},
      auth: {envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET', mode: 'env-or-keychain-jwt', scope: 'operator' as const, source: 'stored' as const},
      fanOut: {mode: 'single-target' as const, participantCount: 1, source: 'profile-ledger' as const},
      profile: {kind: 'remote-validator' as const, name: 'splice-devnet', network: 'splice-devnet'},
      requestedTarget: 'splice-devnet',
      targets: [{
        baseUrl: 'https://ledger.devnet.example.com',
        endpointSource: 'profile-ledger' as const,
        id: 'target-1',
        label: 'splice-devnet',
        managementClass: 'apply-capable',
        packageId: 'pkg-1',
        participant: undefined,
        postDeployChecks: [],
        status: 'completed' as const,
      }],
    }, '2026-04-07T01:00:00.000Z' )
    expect(deploy).toEqual(expect.objectContaining({
      command: 'deploy',
      mode: 'plan',
      recordedAt: '2026-04-07T01:00:00.000Z',
    }))

    const promotion = createPromotionAuditRecord({
      advisories: [{code: 'network-tier', message: 'Cross-tier', severity: 'warn'}],
      from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
      preflight: undefined,
      readiness: undefined,
      rollout: createRollout('dry-run'),
      services: [
        {change: 'unchanged', from: 'a', name: 'scan', to: 'a'},
        {change: 'changed', from: 'a', name: 'validator', to: 'b'},
      ],
      success: false,
      summary: {failed: 0, info: 0, warned: 1},
      to: {experimental: false, kind: 'remote-validator', name: 'splice-testnet', network: 'splice-testnet', tier: 'testnet'},
    }, '2026-04-07T01:01:00.000Z')
    expect(promotion.context).toEqual(expect.objectContaining({
      serviceChanges: [{change: 'changed', from: 'a', name: 'validator', to: 'b'}],
    }))

    const upgrade = createUpgradeAuditRecord({
      advisories: [{code: 'migration-policy', message: 'Review migration', severity: 'warn'}],
      auth: {envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET', mode: 'env-or-keychain-jwt', source: 'stored'},
      automation: {available: false, detail: 'manual', kind: 'manual-only', requiresWorkspace: false},
      compatibility: {failed: 0, warned: 1},
      migration: undefined,
      network: {checklist: [], displayName: 'DevNet', name: 'splice-devnet', reminders: [], resetExpectation: 'resets-expected', tier: 'devnet'},
      profile: {kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
      readiness: undefined,
      rollout: createRollout(),
      success: false,
    }, '2026-04-07T01:02:00.000Z')
    expect(upgrade.context).toEqual(expect.objectContaining({
      readiness: undefined,
    }))

    const reset = createResetAuditRecord({
      automation: {available: true, detail: 'LocalNet cycle', kind: 'localnet-cycle', requiresWorkspace: true},
      checklist: [{severity: 'warn', text: 'Confirm reset schedule.'}],
      network: {checklist: [], displayName: 'LocalNet', name: 'localnet', reminders: [], resetExpectation: 'resets-expected', tier: 'local'},
      profile: {kind: 'splice-localnet', name: 'splice-localnet', network: 'localnet', tier: 'local'},
      readiness: {
        canary: {checks: [], selectedSuites: ['scan'], skippedSuites: [], success: true},
        rollout: createRollout(),
        success: true,
      } as never,
      resetExpectation: 'resets-expected',
      rollout: createRollout(),
      success: false,
      target: {kind: 'profile', name: 'splice-localnet'},
    }, '2026-04-07T01:03:00.000Z')
    expect(reset.context).toEqual(expect.objectContaining({
      readiness: expect.objectContaining({selectedSuites: ['scan'], success: true}),
    }))
  })
})
