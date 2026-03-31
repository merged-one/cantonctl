import {describe, expect, it, vi} from 'vitest'

import type {DamlSdk, SdkCommandResult} from './daml.js'
import {type TestResult, type TestRunner, type TestRunnerDeps, createTestRunner} from './test-runner.js'
import {CantonctlError, ErrorCode} from './errors.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockSdk(): DamlSdk & {
  build: ReturnType<typeof vi.fn>
  codegen: ReturnType<typeof vi.fn>
  detect: ReturnType<typeof vi.fn>
  startSandbox: ReturnType<typeof vi.fn>
  test: ReturnType<typeof vi.fn>
} {
  return {
    build: vi.fn<DamlSdk['build']>(),
    codegen: vi.fn<DamlSdk['codegen']>(),
    detect: vi.fn<DamlSdk['detect']>(),
    startSandbox: vi.fn<DamlSdk['startSandbox']>(),
    test: vi.fn<DamlSdk['test']>(),
  }
}

function createDefaultDeps(
  overrides: Partial<TestRunnerDeps & {sdk: ReturnType<typeof createMockSdk>}> = {},
): TestRunnerDeps & {sdk: ReturnType<typeof createMockSdk>} {
  const sdk = createMockSdk()
  sdk.test.mockResolvedValue({
    exitCode: 0,
    stderr: '',
    stdout: 'Test Summary\n\n4/4 passed',
    success: true,
  } as SdkCommandResult)

  return {
    sdk,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TestRunner', () => {
  describe('run()', () => {
    it('runs SDK test and returns structured result', async () => {
      const deps = createDefaultDeps()
      const runner = createTestRunner(deps)
      const result = await runner.run({projectDir: '/project'})

      expect(result.success).toBe(true)
      expect(result.passed).toBe(true)
      expect(result.output).toContain('Test Summary')
      expect(deps.sdk.test).toHaveBeenCalledWith(
        expect.objectContaining({projectDir: '/project'}),
      )
    })

    it('passes filter to SDK', async () => {
      const deps = createDefaultDeps()
      const runner = createTestRunner(deps)
      await runner.run({filter: 'testMint', projectDir: '/project'})

      expect(deps.sdk.test).toHaveBeenCalledWith(
        expect.objectContaining({filter: 'testMint'}),
      )
    })

    it('returns passed=false on test failure', async () => {
      const sdk = createMockSdk()
      sdk.test.mockRejectedValue(new CantonctlError(ErrorCode.TEST_EXECUTION_FAILED, {
        context: {stderr: 'test failed: Main:testTransfer', stdout: '1/4 failed'},
      }))

      const runner = createTestRunner({sdk})
      const result = await runner.run({projectDir: '/project'})

      expect(result.success).toBe(false)
      expect(result.passed).toBe(false)
      expect(result.output).toContain('test failed')
    })

    it('includes timing in result', async () => {
      const deps = createDefaultDeps()
      const runner = createTestRunner(deps)
      const result = await runner.run({projectDir: '/project'})

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('strips ANSI codes from output', async () => {
      const sdk = createMockSdk()
      sdk.test.mockResolvedValue({
        exitCode: 0,
        stderr: '\u001b[4;1mTest Summary\u001b[m\n\u001b[0;91merror\u001b[m',
        stdout: '',
        success: true,
      })

      const runner = createTestRunner({sdk})
      const result = await runner.run({projectDir: '/project'})

      expect(result.output).not.toContain('\u001b')
      expect(result.output).toContain('Test Summary')
    })

    it('respects AbortSignal', async () => {
      const deps = createDefaultDeps()
      const controller = new AbortController()
      controller.abort()

      deps.sdk.test.mockRejectedValue(new DOMException('Aborted', 'AbortError'))

      const runner = createTestRunner(deps)
      await expect(runner.run({projectDir: '/project', signal: controller.signal}))
        .rejects.toThrow()
    })

    it('re-throws non-test errors (e.g., SDK not found)', async () => {
      const sdk = createMockSdk()
      sdk.test.mockRejectedValue(new CantonctlError(ErrorCode.SDK_NOT_INSTALLED))

      const runner = createTestRunner({sdk})
      await expect(runner.run({projectDir: '/project'})).rejects.toThrow(CantonctlError)
      try {
        await runner.run({projectDir: '/project'})
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.SDK_NOT_INSTALLED)
      }
    })

    it('combines stdout and stderr in output', async () => {
      const sdk = createMockSdk()
      sdk.test.mockResolvedValue({
        exitCode: 0,
        stderr: 'stderr content',
        stdout: 'stdout content',
        success: true,
      })

      const runner = createTestRunner({sdk})
      const result = await runner.run({projectDir: '/project'})

      expect(result.output).toContain('stdout content')
      expect(result.output).toContain('stderr content')
    })
  })
})
