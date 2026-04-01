import {describe, expect, it, vi} from 'vitest'

import type {ProcessRunner, ProcessResult, SpawnedProcess} from './process-runner.js'

/**
 * Helper to create a mock ProcessRunner for unit tests.
 * Tests don't need the real execa-backed runner.
 */
function createMockRunner(): ProcessRunner & {
  run: ReturnType<typeof vi.fn>
  spawn: ReturnType<typeof vi.fn>
  which: ReturnType<typeof vi.fn>
} {
  return {
    run: vi.fn<ProcessRunner['run']>(),
    spawn: vi.fn<ProcessRunner['spawn']>(),
    which: vi.fn<ProcessRunner['which']>(),
  }
}

describe('ProcessRunner (mock)', () => {
  it('run() returns stdout, stderr, and exitCode', async () => {
    const runner = createMockRunner()
    runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'build output'})

    const result: ProcessResult = await runner.run('dpm', ['build'])
    expect(result.stdout).toBe('build output')
    expect(result.exitCode).toBe(0)
    expect(runner.run).toHaveBeenCalledWith('dpm', ['build'])
  })

  it('run() can return non-zero exit code', async () => {
    const runner = createMockRunner()
    runner.run.mockResolvedValue({exitCode: 1, stderr: 'compile error', stdout: ''})

    const result = await runner.run('dpm', ['build'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('compile error')
  })

  it('run() accepts options (cwd, env, timeout)', async () => {
    const runner = createMockRunner()
    runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: ''})

    await runner.run('dpm', ['test'], {cwd: '/project', env: {DEBUG: '1'}, timeout: 5000})
    expect(runner.run).toHaveBeenCalledWith('dpm', ['test'], {
      cwd: '/project',
      env: {DEBUG: '1'},
      timeout: 5000,
    })
  })

  it('spawn() returns a SpawnedProcess handle', () => {
    const runner = createMockRunner()
    const mockProc: SpawnedProcess = {
      kill: vi.fn(),
      onExit: vi.fn(),
      waitForExit: vi.fn().mockResolvedValue(0),
      pid: 12345,
      stderr: null,
      stdout: null,
    }
    runner.spawn.mockReturnValue(mockProc)

    const proc = runner.spawn('dpm', ['sandbox'])
    expect(proc.pid).toBe(12345)
    expect(runner.spawn).toHaveBeenCalledWith('dpm', ['sandbox'])
  })

  it('spawn().kill() sends signal to process', () => {
    const runner = createMockRunner()
    const killFn = vi.fn()
    runner.spawn.mockReturnValue({
      kill: killFn,
      onExit: vi.fn(),
      waitForExit: vi.fn().mockResolvedValue(0),
      pid: 99,
      stderr: null,
      stdout: null,
    })

    const proc = runner.spawn('dpm', ['sandbox'])
    proc.kill('SIGTERM')
    expect(killFn).toHaveBeenCalledWith('SIGTERM')
  })

  it('spawn().onExit() registers callback', () => {
    const runner = createMockRunner()
    const exitCallbacks: Array<(code: number | null) => void> = []
    runner.spawn.mockReturnValue({
      kill: vi.fn(),
      onExit: (cb: (code: number | null) => void) => exitCallbacks.push(cb),
      waitForExit: vi.fn().mockResolvedValue(0),
      pid: 99,
      stderr: null,
      stdout: null,
    })

    const proc = runner.spawn('dpm', ['sandbox'])
    const callback = vi.fn()
    proc.onExit(callback)

    // Simulate exit
    exitCallbacks[0](0)
    expect(callback).toHaveBeenCalledWith(0)
  })

  it('which() returns path when command exists', async () => {
    const runner = createMockRunner()
    runner.which.mockResolvedValue('/usr/local/bin/dpm')

    const result = await runner.which('dpm')
    expect(result).toBe('/usr/local/bin/dpm')
  })

  it('which() returns null when command not found', async () => {
    const runner = createMockRunner()
    runner.which.mockResolvedValue(null)

    const result = await runner.which('nonexistent')
    expect(result).toBeNull()
  })
})
