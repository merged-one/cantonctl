import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import * as localnetCycleModule from '../lib/lifecycle/localnet-cycle.js'
import * as lifecycleResetModule from '../lib/lifecycle/reset.js'
import * as lifecycleUpgradeModule from '../lib/lifecycle/upgrade.js'
import * as readinessModule from '../lib/readiness.js'
import ResetChecklist from './reset/checklist.js'
import UpgradeCheck from './upgrade/check.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function createConfig() {
  return {
    'default-profile': 'splice-devnet',
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createUpgradeReport(success: boolean) {
  return {
    advisories: success
      ? [{code: 'sponsor-reminder', message: 'confirm inputs', severity: 'warn'}]
      : [{code: 'auth-material', message: 'missing auth', severity: 'fail'}],
    automation: {
      available: false,
      detail: 'manual only',
      kind: 'manual-only',
      requiresWorkspace: false,
    },
    auth: {envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET', mode: 'env-or-keychain-jwt', source: 'stored'},
    compatibility: {failed: success ? 0 : 1, warned: 0},
    network: {
      checklist: ['Confirm sponsor inputs.'],
      displayName: 'DevNet',
      name: 'splice-devnet',
      reminders: ['DevNet resets happen.'],
      resetExpectation: 'resets-expected',
      tier: 'devnet',
    },
    profile: {kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
    rollout: {
      mode: success ? 'dry-run' : 'apply',
      operation: 'upgrade',
      partial: false,
      resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
      steps: [{
        blockers: success ? [] : [{code: 'auth-material', detail: 'missing auth'}],
        dependencies: [],
        detail: undefined,
        effect: 'read',
        id: 'validate-upgrade-plan',
        owner: 'cantonctl',
        postconditions: [],
        preconditions: [],
        runbook: success ? [{code: 'manual', detail: 'Follow the operator runbook.', owner: 'operator', title: 'Manual step'}] : [],
        status: success ? 'completed' : 'blocked',
        title: 'Validate upgrade workflow',
        warnings: success ? [{code: 'network-reminder-0', detail: 'DevNet resets happen.'}] : [],
      }],
      success,
      summary: {blocked: success ? 0 : 1, completed: success ? 1 : 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: success ? 1 : 0},
    },
    success,
  } as const
}

function createResetReport(success: boolean) {
  return {
    automation: {
      available: false,
      detail: 'manual only',
      kind: 'manual-only',
      requiresWorkspace: false,
    },
    checklist: [{severity: 'warn' as const, text: 'Confirm reset schedule.'}],
    network: {
      checklist: ['Confirm reset schedule.'],
      displayName: 'DevNet',
      name: 'devnet',
      reminders: ['DevNet resets happen.'],
      resetExpectation: 'resets-expected' as const,
      tier: 'devnet' as const,
    },
    resetExpectation: 'resets-expected' as const,
    rollout: {
      mode: success ? 'apply' : 'dry-run',
      operation: 'reset',
      partial: false,
      resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
      steps: [{
        blockers: success ? [] : [{code: 'workspace-required', detail: 'Provide --workspace'}],
        dependencies: [],
        detail: undefined,
        effect: 'read',
        id: 'validate-reset-workflow',
        owner: 'cantonctl',
        postconditions: [],
        preconditions: [],
        runbook: success ? [{code: 'manual', detail: 'Review reset notes.', owner: 'operator', title: 'Manual reset step'}] : [],
        status: success ? 'completed' : 'blocked',
        title: 'Validate reset workflow',
        warnings: success ? [{code: 'network-reminder-0', detail: 'DevNet resets happen.'}] : [],
      }],
      success,
      summary: {blocked: success ? 0 : 1, completed: success ? 1 : 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: success ? 1 : 0},
    },
    success,
    target: {kind: 'network' as const, name: 'devnet'},
  } as const
}

describe('lifecycle command surfaces', () => {
  it('renders upgrade workflows in dry-run and apply modes and validates mode flags', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig() as never)
    const run = vi.fn()
      .mockResolvedValueOnce(createUpgradeReport(true))
      .mockResolvedValueOnce(createUpgradeReport(true))
      .mockResolvedValueOnce(createUpgradeReport(false))
    vi.spyOn(lifecycleUpgradeModule, 'createUpgradeRunner').mockReturnValue({check: run, run})

    const dryRun = await captureOutput(() => UpgradeCheck.run(['--dry-run'], {root: CLI_ROOT}))
    expect(dryRun.error).toBeUndefined()
    expect(dryRun.stdout).toContain('Mode: dry-run')
    expect(`${dryRun.stdout}\n${dryRun.stderr}`).toContain('Reminder: DevNet resets happen.')

    const apply = await captureOutput(() => UpgradeCheck.run(['--apply', '--json'], {root: CLI_ROOT}))
    expect(apply.error).toBeUndefined()
    expect(parseJson(apply.stdout)).toEqual(expect.objectContaining({success: true}))

    const failed = await captureOutput(() => UpgradeCheck.run(['--apply'], {root: CLI_ROOT}))
    expect(failed.error).toBeDefined()
    expect(`${failed.stdout}\n${failed.stderr}`).toContain('Upgrade workflow found blocking issues.')

    const invalid = await captureOutput(() => UpgradeCheck.run(['--plan', '--apply', '--json'], {root: CLI_ROOT}))
    expect(invalid.error).toBeDefined()
    expect(parseJson(invalid.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))
  })

  it('serializes handled upgrade failures and exposes the default factories', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig() as never)
    vi.spyOn(lifecycleUpgradeModule, 'createUpgradeRunner').mockReturnValue({
      check: vi.fn(),
      run: vi.fn().mockResolvedValue(createUpgradeReport(false)),
    })

    const handled = await captureOutput(() => UpgradeCheck.run(['--apply', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({success: false}),
      success: false,
    }))

    const localnet = {down: vi.fn(), status: vi.fn(), up: vi.fn()} as never
    const readiness = {run: vi.fn()} as never
    const runner = {check: vi.fn(), run: vi.fn()} as never
    vi.spyOn(localnetCycleModule, 'createDefaultLocalnet').mockReturnValue(localnet)
    vi.spyOn(readinessModule, 'createReadinessRunner').mockReturnValue(readiness)
    vi.spyOn(lifecycleUpgradeModule, 'createUpgradeRunner').mockReturnValue(runner)

    class Harness extends UpgradeCheck {
      public callCreateLocalnet() {
        return this.createLocalnet()
      }

      public callCreateReadinessRunner() {
        return this.createReadinessRunner()
      }

      public callCreateUpgradeRunner() {
        return this.createUpgradeRunner()
      }

      public async run(): Promise<void> {}
    }

    const harness = new Harness([], {} as never)
    expect(harness.callCreateLocalnet()).toBe(localnet)
    expect(harness.callCreateReadinessRunner()).toBe(readiness)
    expect(harness.callCreateUpgradeRunner()).toBe(runner)
    const upgradeArgs = vi.mocked(lifecycleUpgradeModule.createUpgradeRunner).mock.calls.at(-1)?.[0]
    expect(upgradeArgs?.createLocalnet?.()).toBe(localnet)
    expect(upgradeArgs?.createReadinessRunner?.()).toBe(readiness)
  })

  it('renders reset workflows, validates target selection, and exposes the default factories', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(createResetReport(true))
      .mockResolvedValueOnce(createResetReport(true))
      .mockResolvedValueOnce(createResetReport(false))
    vi.spyOn(lifecycleResetModule, 'createResetRunner').mockReturnValue({createChecklist: run, run})

    const dryRun = await captureOutput(() => ResetChecklist.run(['--network', 'devnet'], {root: CLI_ROOT}))
    expect(dryRun.error).toBeUndefined()
    expect(dryRun.stdout).toContain('Automation: manual-only')
    expect(`${dryRun.stdout}\n${dryRun.stderr}`).toContain('Reminder: DevNet resets happen.')

    const apply = await captureOutput(() => ResetChecklist.run(['--network', 'devnet', '--apply', '--json'], {root: CLI_ROOT}))
    expect(apply.error).toBeUndefined()
    expect(parseJson(apply.stdout)).toEqual(expect.objectContaining({success: true}))

    const failed = await captureOutput(() => ResetChecklist.run(['--network', 'devnet', '--dry-run'], {root: CLI_ROOT}))
    expect(failed.error).toBeDefined()
    expect(`${failed.stdout}\n${failed.stderr}`).toContain('Reset workflow found blocking issues.')

    const invalidTarget = await captureOutput(() => ResetChecklist.run(['--network', 'devnet', '--profile', 'splice-localnet', '--json'], {root: CLI_ROOT}))
    expect(invalidTarget.error).toBeDefined()
    expect(parseJson(invalidTarget.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))

    const invalidMode = await captureOutput(() => ResetChecklist.run(['--network', 'devnet', '--plan', '--dry-run', '--json'], {root: CLI_ROOT}))
    expect(invalidMode.error).toBeDefined()
    expect(parseJson(invalidMode.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))

    const localnet = {down: vi.fn(), status: vi.fn(), up: vi.fn()} as never
    const readiness = {run: vi.fn()} as never
    const runner = {createChecklist: vi.fn(), run: vi.fn()} as never
    vi.spyOn(localnetCycleModule, 'createDefaultLocalnet').mockReturnValue(localnet)
    vi.spyOn(readinessModule, 'createReadinessRunner').mockReturnValue(readiness)
    vi.spyOn(lifecycleResetModule, 'createResetRunner').mockReturnValue(runner)

    class Harness extends ResetChecklist {
      public callCreateLocalnet() {
        return this.createLocalnet()
      }

      public callCreateReadinessRunner() {
        return this.createReadinessRunner()
      }

      public callCreateResetRunner() {
        return this.createResetRunner()
      }

      public async run(): Promise<void> {}
    }

    const harness = new Harness([], {} as never)
    expect(harness.callCreateLocalnet()).toBe(localnet)
    expect(harness.callCreateReadinessRunner()).toBe(readiness)
    expect(harness.callCreateResetRunner()).toBe(runner)
    const resetArgs = vi.mocked(lifecycleResetModule.createResetRunner).mock.calls.at(-1)?.[0]
    expect(resetArgs?.createLocalnet?.()).toBe(localnet)
    expect(resetArgs?.createReadinessRunner?.()).toBe(readiness)
  })

  it('loads config only for profile-based reset workflows and serializes handled errors', async () => {
    const loadConfig = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig() as never)
    vi.spyOn(lifecycleResetModule, 'createResetRunner').mockReturnValue({
      createChecklist: vi.fn(),
      run: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'set config'})),
    })

    const handled = await captureOutput(() => ResetChecklist.run(['--profile', 'splice-localnet', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))
    expect(loadConfig).toHaveBeenCalledOnce()
  })
})
