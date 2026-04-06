import {describe, expect, it, vi} from 'vitest'

import {
  createControlPlaneOperationRunner,
  type ControlPlaneOperationDefinition,
} from './control-plane-operation.js'
import {CantonctlError, ErrorCode} from './errors.js'

describe('createControlPlaneOperationRunner', () => {
  it('plans ready, manual, and blocked steps without executing them', async () => {
    const execute = vi.fn()
    const runner = createControlPlaneOperationRunner({
      createState: () => ({}),
      description: 'Profile-first rollout planning',
      operation: 'rollout',
      steps: [
        {
          id: 'inspect-profile',
          preconditions: () => [{code: 'profile-resolved', detail: 'Profile resolved.', status: 'pass'}],
          run: execute,
          title: 'Inspect profile',
          warnings: () => [{code: 'experimental-target', detail: 'Target is experimental.'}],
        },
        {
          id: 'official-runtime',
          owner: 'official-stack',
          runbook: () => [{
            code: 'official-runtime-stack',
            detail: 'Provision validator and wallet runtime with the official stack.',
            owner: 'official-stack',
            title: 'Use the official runtime stack',
          }],
          title: 'Confirm runtime ownership',
        },
        {
          blockers: () => [{code: 'auth-material', detail: 'Auth material is missing.'}],
          id: 'check-auth',
          preconditions: () => [{code: 'credential-present', detail: 'Credential is missing.', status: 'block'}],
          title: 'Check auth material',
        },
      ],
    } satisfies ControlPlaneOperationDefinition<{}, {}>)

    const result = await runner.plan({input: {}})

    expect(execute).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      description: 'Profile-first rollout planning',
      mode: 'plan',
      operation: 'rollout',
      partial: false,
      resume: {
        canResume: false,
        checkpoints: [],
        completedStepIds: [],
        nextStepId: undefined,
      },
      success: false,
      summary: {
        blocked: 1,
        completed: 0,
        dryRun: 0,
        failed: 0,
        manual: 1,
        pending: 0,
        ready: 1,
        warned: 1,
      },
    })
    expect(result.steps).toEqual([
      expect.objectContaining({
        id: 'inspect-profile',
        status: 'ready',
        warnings: [{code: 'experimental-target', detail: 'Target is experimental.'}],
      }),
      expect.objectContaining({
        id: 'official-runtime',
        owner: 'official-stack',
        runbook: [{
          code: 'official-runtime-stack',
          detail: 'Provision validator and wallet runtime with the official stack.',
          owner: 'official-stack',
          title: 'Use the official runtime stack',
        }],
        status: 'manual',
      }),
      expect.objectContaining({
        blockers: [{code: 'auth-material', detail: 'Auth material is missing.'}],
        id: 'check-auth',
        preconditions: [{code: 'credential-present', detail: 'Credential is missing.', status: 'block'}],
        status: 'blocked',
      }),
    ])
  })

  it('applies ordered steps and records checkpoints for completed work', async () => {
    const calls: string[] = []
    const runner = createControlPlaneOperationRunner({
      createState: () => ({packageId: undefined as string | undefined, token: undefined as string | undefined}),
      operation: 'deploy',
      steps: [
        {
          id: 'validate-config',
          run: () => {
            calls.push('validate-config')
            return {detail: 'Configuration validated.'}
          },
          title: 'Validate configuration',
        },
        {
          dependsOn: ['validate-config'],
          id: 'authenticate',
          run: ({state}) => {
            calls.push('authenticate')
            state.token = 'jwt-token'
            return {checkpoint: {tokenSource: 'stored'}, detail: 'Credentials resolved.'}
          },
          title: 'Authenticate',
        },
        {
          dependsOn: ['authenticate'],
          effect: 'write',
          id: 'upload-dar',
          run: ({state}) => {
            calls.push('upload-dar')
            state.packageId = 'pkg-123'
            return {
              checkpoint: {packageId: 'pkg-123'},
              data: {packageId: 'pkg-123'},
              detail: 'DAR uploaded.',
            }
          },
          title: 'Upload DAR',
        },
        {
          dependsOn: ['upload-dar'],
          id: 'verify-upload',
          postconditions: ({state}) => [{
            code: 'package-visible',
            detail: state.packageId ? 'Package visible on target ledger.' : 'Package did not appear on the target ledger.',
            status: state.packageId ? 'pass' : 'fail',
          }],
          run: ({state}) => {
            calls.push('verify-upload')
            return {detail: `Verified ${state.packageId}`}
          },
          title: 'Verify upload',
        },
      ],
    })

    const result = await runner.apply({input: {}})

    expect(calls).toEqual(['validate-config', 'authenticate', 'upload-dar', 'verify-upload'])
    expect(result.success).toBe(true)
    expect(result.partial).toBe(false)
    expect(result.summary).toEqual({
      blocked: 0,
      completed: 4,
      dryRun: 0,
      failed: 0,
      manual: 0,
      pending: 0,
      ready: 0,
      warned: 0,
    })
    expect(result.resume).toEqual({
      canResume: false,
      checkpoints: [
        {checkpoint: {tokenSource: 'stored'}, stepId: 'authenticate'},
        {checkpoint: {packageId: 'pkg-123'}, stepId: 'upload-dar'},
      ],
      completedStepIds: ['validate-config', 'authenticate', 'upload-dar', 'verify-upload'],
      nextStepId: undefined,
    })
    expect(result.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed', 'completed'])
    expect(result.steps[3]?.postconditions).toEqual([
      {code: 'package-visible', detail: 'Package visible on target ledger.', status: 'pass'},
    ])
  })

  it('skips mutating steps in dry-run mode and leaves dependent work pending', async () => {
    const calls: string[] = []
    const runner = createControlPlaneOperationRunner({
      operation: 'deploy',
      steps: [
        {
          id: 'validate-config',
          run: () => {
            calls.push('validate-config')
          },
          title: 'Validate configuration',
        },
        {
          dependsOn: ['validate-config'],
          effect: 'write',
          id: 'upload-dar',
          run: () => {
            calls.push('upload-dar')
          },
          title: 'Upload DAR',
        },
        {
          effect: 'write',
          id: 'record-runbook',
          run: () => {
            calls.push('record-runbook')
          },
          title: 'Record runbook',
        },
        {
          dependsOn: ['upload-dar'],
          id: 'verify-upload',
          run: () => {
            calls.push('verify-upload')
          },
          title: 'Verify upload',
        },
      ],
    })

    const result = await runner.dryRun({input: {}})

    expect(calls).toEqual(['validate-config'])
    expect(result).toMatchObject({
      mode: 'dry-run',
      operation: 'deploy',
      partial: true,
      success: true,
      summary: {
        blocked: 0,
        completed: 1,
        dryRun: 2,
        failed: 0,
        manual: 0,
        pending: 1,
        ready: 0,
        warned: 0,
      },
    })
    expect(result.resume).toEqual({
      canResume: false,
      checkpoints: [],
      completedStepIds: ['validate-config'],
      nextStepId: undefined,
    })
    expect(result.steps).toEqual([
      expect.objectContaining({id: 'validate-config', status: 'completed'}),
      expect.objectContaining({
        detail: 'Skipped mutating step "Upload DAR" in dry-run mode.',
        id: 'upload-dar',
        status: 'dry-run',
      }),
      expect.objectContaining({
        detail: 'Skipped mutating step "Record runbook" in dry-run mode.',
        id: 'record-runbook',
        status: 'dry-run',
      }),
      expect.objectContaining({
        detail: 'Waiting for "upload-dar" before "Verify upload".',
        id: 'verify-upload',
        status: 'pending',
      }),
    ])
  })

  it('uses execute() as the default apply path and completes passive steps', async () => {
    const runner = createControlPlaneOperationRunner({
      operation: 'promotion',
      steps: [
        {
          id: 'announce-boundary',
          run: () => ({detail: 'Boundary acknowledged.'}),
          runbook: () => [{
            code: 'official-stack-boundary',
            detail: 'Cluster provisioning stays outside cantonctl.',
            owner: 'official-stack',
            title: 'Use the official runtime stack',
          }],
          title: 'Acknowledge boundary',
        },
        {
          id: 'passive-summary',
          title: 'Capture passive summary',
        },
      ],
    })

    const result = await runner.execute({input: {}})

    expect(result.mode).toBe('apply')
    expect(result.success).toBe(true)
    expect(result.steps).toEqual([
      expect.objectContaining({
        id: 'announce-boundary',
        runbook: [{
          code: 'official-stack-boundary',
          detail: 'Cluster provisioning stays outside cantonctl.',
          owner: 'official-stack',
          title: 'Use the official runtime stack',
        }],
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'passive-summary',
        status: 'completed',
      }),
    ])
  })

  it('blocks apply execution on unmet gates and leaves later steps pending', async () => {
    const followOn = vi.fn()
    const runner = createControlPlaneOperationRunner({
      operation: 'upgrade',
      steps: [
        {
          blockers: () => [{code: 'operator-window', detail: 'Operator window is not open.'}],
          id: 'operator-gate',
          preconditions: () => [{code: 'change-window', detail: 'Change window is closed.', status: 'block'}],
          title: 'Check operator gate',
        },
        {
          id: 'perform-upgrade',
          run: followOn,
          title: 'Perform upgrade',
        },
      ],
    })

    const result = await runner.apply({input: {}})

    expect(followOn).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.resume).toEqual({
      canResume: false,
      checkpoints: [],
      completedStepIds: [],
      nextStepId: 'operator-gate',
    })
    expect(result.steps).toEqual([
      expect.objectContaining({
        blockers: [{code: 'operator-window', detail: 'Operator window is not open.'}],
        id: 'operator-gate',
        preconditions: [{code: 'change-window', detail: 'Change window is closed.', status: 'block'}],
        status: 'blocked',
      }),
      expect.objectContaining({
        detail: 'Not attempted after "operator-gate" was blocked.',
        id: 'perform-upgrade',
        status: 'pending',
      }),
    ])
  })

  it('captures failed steps and exposes resume metadata after partial apply progress', async () => {
    const upload = vi.fn()
    const runner = createControlPlaneOperationRunner({
      createState: () => ({}),
      operation: 'deploy',
      steps: [
        {
          id: 'validate-config',
          run: () => ({checkpoint: {configVersion: 1}, detail: 'Configuration validated.'}),
          title: 'Validate configuration',
        },
        {
          dependsOn: ['validate-config'],
          id: 'authenticate',
          run: () => {
            throw new CantonctlError(ErrorCode.DEPLOY_AUTH_FAILED, {
              context: {network: 'splice-devnet'},
              suggestion: 'Run "cantonctl auth login splice-devnet" and retry.',
            })
          },
          title: 'Authenticate',
        },
        {
          dependsOn: ['authenticate'],
          id: 'upload-dar',
          run: upload,
          title: 'Upload DAR',
        },
      ],
    })

    const result = await runner.apply({input: {}})

    expect(upload).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.partial).toBe(true)
    expect(result.resume).toEqual({
      canResume: true,
      checkpoints: [{checkpoint: {configVersion: 1}, stepId: 'validate-config'}],
      completedStepIds: ['validate-config'],
      nextStepId: 'authenticate',
    })
    expect(result.steps).toEqual([
      expect.objectContaining({id: 'validate-config', status: 'completed'}),
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCode.DEPLOY_AUTH_FAILED,
          context: {network: 'splice-devnet'},
          message: 'Authentication failed for the target network.',
          suggestion: 'Run "cantonctl auth login splice-devnet" and retry.',
        }),
        id: 'authenticate',
        status: 'failed',
      }),
      expect.objectContaining({
        detail: 'Not attempted after "authenticate" failed.',
        id: 'upload-dar',
        status: 'pending',
      }),
    ])
  })

  it('serializes unexpected Error failures with their message', async () => {
    const runner = createControlPlaneOperationRunner({
      operation: 'deploy',
      steps: [
        {
          id: 'upload-dar',
          run: () => {
            throw new Error('socket closed')
          },
          title: 'Upload DAR',
        },
      ],
    })

    const result = await runner.apply({input: {}})

    expect(result.success).toBe(false)
    expect(result.steps[0]).toMatchObject({
      error: {message: 'socket closed'},
      id: 'upload-dar',
      status: 'failed',
    })
  })

  it('keeps runbook-only steps explicit during apply mode', async () => {
    const finalize = vi.fn()
    const runner = createControlPlaneOperationRunner({
      operation: 'promotion',
      steps: [
        {
          id: 'preflight',
          run: () => ({detail: 'Preflight passed.'}),
          title: 'Run preflight',
        },
        {
          id: 'operator-window',
          runbook: () => [{
            code: 'operator-change-window',
            detail: 'Coordinate the operator-owned change window before applying the rollout.',
            owner: 'operator',
            title: 'Coordinate operator change window',
          }],
          title: 'Coordinate change window',
        },
        {
          id: 'finalize',
          run: () => {
            finalize()
            return {detail: 'Rollout finalized.'}
          },
          title: 'Finalize rollout',
        },
      ],
    })

    const result = await runner.apply({input: {}})

    expect(finalize).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect(result.summary.manual).toBe(1)
    expect(result.steps).toEqual([
      expect.objectContaining({id: 'preflight', status: 'completed'}),
      expect.objectContaining({id: 'operator-window', owner: 'cantonctl', status: 'manual'}),
      expect.objectContaining({id: 'finalize', status: 'completed'}),
    ])
  })

  it('fails a step when postconditions report a blocking verification result', async () => {
    const runner = createControlPlaneOperationRunner({
      createState: () => ({packageId: 'pkg-123'}),
      operation: 'deploy',
      steps: [
        {
          id: 'verify-upload',
          postconditions: () => [
            {code: 'scan-warning', detail: 'Scan endpoint still warming up.', status: 'warn'},
            {code: 'package-visible', detail: 'Package was not visible on the target ledger.', status: 'fail'},
          ],
          run: () => ({detail: 'Verification attempted.'}),
          title: 'Verify upload',
        },
      ],
    })

    const result = await runner.apply({input: {}})

    expect(result.success).toBe(false)
    expect(result.summary).toEqual({
      blocked: 0,
      completed: 0,
      dryRun: 0,
      failed: 1,
      manual: 0,
      pending: 0,
      ready: 0,
      warned: 1,
    })
    expect(result.steps[0]).toMatchObject({
      error: {message: 'Package was not visible on the target ledger.'},
      id: 'verify-upload',
      postconditions: [
        {code: 'scan-warning', detail: 'Scan endpoint still warming up.', status: 'warn'},
        {code: 'package-visible', detail: 'Package was not visible on the target ledger.', status: 'fail'},
      ],
      status: 'failed',
    })
  })

  it('surfaces evaluation failures during planning without aborting the rest of the plan', async () => {
    const runner = createControlPlaneOperationRunner({
      operation: 'upgrade',
      steps: [
        {
          id: 'inspect-metadata',
          preconditions: () => {
            throw 'bad metadata'
          },
          title: 'Inspect metadata',
        },
        {
          id: 'check-compatibility',
          preconditions: () => [{code: 'compatibility', detail: 'Compatibility baseline is pinned.', status: 'pass'}],
          title: 'Check compatibility',
        },
      ],
    })

    const result = await runner.plan({input: {}})

    expect(result.success).toBe(false)
    expect(result.summary.failed).toBe(1)
    expect(result.summary.ready).toBe(1)
    expect(result.steps).toEqual([
      expect.objectContaining({
        error: {message: 'Control-plane operation step failed.'},
        id: 'inspect-metadata',
        status: 'failed',
      }),
      expect.objectContaining({
        id: 'check-compatibility',
        status: 'ready',
      }),
    ])
  })

  it('rethrows the signal reason when a step aborts with the active AbortSignal', async () => {
    const controller = new AbortController()
    const abortReason = new Error('abort from step')
    const runner = createControlPlaneOperationRunner({
      operation: 'deploy',
      steps: [
        {
          id: 'validate-config',
          run: () => {
            controller.abort(abortReason)
            throw controller.signal.reason
          },
          title: 'Validate configuration',
        },
      ],
    })

    await expect(runner.apply({input: {}, signal: controller.signal})).rejects.toBe(abortReason)
  })

  it('rethrows AbortError exceptions raised by a step', async () => {
    const controller = new AbortController()
    const abortError = new Error('cancelled')
    abortError.name = 'AbortError'
    const runner = createControlPlaneOperationRunner({
      operation: 'deploy',
      steps: [
        {
          id: 'validate-config',
          run: () => {
            throw abortError
          },
          title: 'Validate configuration',
        },
      ],
    })

    await expect(runner.apply({input: {}, signal: controller.signal})).rejects.toBe(abortError)
  })

  it('respects AbortSignal before any step executes', async () => {
    const signal = AbortSignal.abort(new Error('stop now'))
    const runner = createControlPlaneOperationRunner({
      operation: 'deploy',
      steps: [
        {
          id: 'validate-config',
          run: vi.fn(),
          title: 'Validate configuration',
        },
      ],
    })

    await expect(runner.apply({input: {}, signal})).rejects.toThrow('stop now')
  })

  it('honors AbortSignal implementations without throwIfAborted()', async () => {
    const runner = createControlPlaneOperationRunner({
      operation: 'deploy',
      steps: [],
    })
    const signal = {
      aborted: true,
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onabort: null,
      reason: new Error('fallback stop'),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal
    Reflect.deleteProperty(signal, 'throwIfAborted')

    await expect(runner.execute({input: {}, signal})).rejects.toThrow('fallback stop')
  })

  it('falls back to a generic abort error when the signal reason is not an Error', async () => {
    const runner = createControlPlaneOperationRunner({
      operation: 'deploy',
      steps: [],
    })
    const signal = {
      aborted: true,
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onabort: null,
      reason: 'later',
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal
    Reflect.deleteProperty(signal, 'throwIfAborted')

    await expect(runner.execute({input: {}, signal})).rejects.toThrow('The operation was aborted.')
  })

  it('ignores custom AbortSignal shims that are present but not aborted', async () => {
    const runner = createControlPlaneOperationRunner({
      operation: 'deploy',
      steps: [],
    })
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onabort: null,
      reason: undefined,
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal
    Reflect.deleteProperty(signal, 'throwIfAborted')

    await expect(runner.execute({input: {}, signal})).resolves.toMatchObject({
      mode: 'apply',
      success: true,
      summary: {
        blocked: 0,
        completed: 0,
        dryRun: 0,
        failed: 0,
        manual: 0,
        pending: 0,
        ready: 0,
        warned: 0,
      },
    })
  })
})
