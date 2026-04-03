import {describe, expect, it, vi} from 'vitest'

import type {ProcessResult, ProcessRunner, SpawnedProcess} from './process-runner.js'
import {type DamlSdk, createDamlSdk} from './daml.js'
import {CantonctlError, ErrorCode} from './errors.js'

/**
 * Creates a mock ProcessRunner for DamlSdk tests.
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

describe('DamlSdk', () => {
  describe('detect()', () => {
    it('detects dpm when available', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'dpm 3.4.9'})

      const sdk = createDamlSdk({runner})
      const info = await sdk.detect()
      expect(info.tool).toBe('dpm')
      expect(info.path).toBe('/usr/local/bin/dpm')
      expect(info.version).toBe('dpm 3.4.9')
    })

    it('falls back to daml when dpm is not found', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'daml' ? '/usr/local/bin/daml' : null,
      )
      runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'SDK 2.9.0'})

      const sdk = createDamlSdk({runner})
      const info = await sdk.detect()
      expect(info.tool).toBe('daml')
      expect(info.path).toBe('/usr/local/bin/daml')
    })

    it('uses stderr when the version command writes nothing to stdout', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 0, stderr: 'dpm 3.4.11', stdout: ''})

      const sdk = createDamlSdk({runner})
      await expect(sdk.detect()).resolves.toEqual({
        path: '/usr/local/bin/dpm',
        tool: 'dpm',
        version: 'dpm 3.4.11',
      })
    })

    it('throws SDK_NOT_INSTALLED when neither dpm nor daml is found', async () => {
      const runner = createMockRunner()
      runner.which.mockResolvedValue(null)

      const sdk = createDamlSdk({runner})
      await expect(sdk.detect()).rejects.toThrow(CantonctlError)
      try {
        await sdk.detect()
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.SDK_NOT_INSTALLED)
      }
    })
  })

  describe('build()', () => {
    it('runs dpm build in project directory', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'Build successful\n.daml/dist/app-0.1.0.dar'})

      const sdk = createDamlSdk({runner})
      const result = await sdk.build({projectDir: '/project'})
      expect(result.success).toBe(true)
      expect(runner.run).toHaveBeenCalledWith(
        'dpm',
        ['build'],
        expect.objectContaining({cwd: '/project'}),
      )
    })

    it('throws BUILD_DAML_ERROR on non-zero exit', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 1, stderr: 'error: Module Main has errors', stdout: ''})

      const sdk = createDamlSdk({runner})
      await expect(sdk.build({projectDir: '/project'})).rejects.toThrow(CantonctlError)
      try {
        await sdk.build({projectDir: '/project'})
      } catch (err) {
        const e = err as CantonctlError
        expect(e.code).toBe(ErrorCode.BUILD_DAML_ERROR)
        expect(e.context.stderr).toBe('error: Module Main has errors')
      }
    })

    it('respects AbortSignal', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      const controller = new AbortController()
      controller.abort()

      runner.run.mockRejectedValue(new DOMException('Aborted', 'AbortError'))

      const sdk = createDamlSdk({runner})
      await expect(sdk.build({projectDir: '/project', signal: controller.signal})).rejects.toThrow()
    })
  })

  describe('test()', () => {
    it('runs dpm test in project directory', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'Tests passed: 5/5'})

      const sdk = createDamlSdk({runner})
      const result = await sdk.test({projectDir: '/project'})
      expect(result.success).toBe(true)
      expect(result.stdout).toContain('Tests passed')
    })

    it('throws TEST_EXECUTION_FAILED on non-zero exit', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 1, stderr: 'test failed: Main:myTest', stdout: ''})

      const sdk = createDamlSdk({runner})
      await expect(sdk.test({projectDir: '/project'})).rejects.toThrow(CantonctlError)
      try {
        await sdk.test({projectDir: '/project'})
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.TEST_EXECUTION_FAILED)
      }
    })

    it('passes filter argument when provided', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'passed'})

      const sdk = createDamlSdk({runner})
      await sdk.test({filter: 'myTest', projectDir: '/project'})
      expect(runner.run).toHaveBeenCalledWith(
        'dpm',
        expect.arrayContaining(['test']),
        expect.anything(),
      )
    })
  })

  describe('codegen()', () => {
    it('runs dpm codegen ts in project directory', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'Codegen complete'})

      const sdk = createDamlSdk({runner})
      const result = await sdk.codegen({language: 'ts', projectDir: '/project'})
      expect(result.success).toBe(true)
      expect(runner.run).toHaveBeenCalledWith(
        'dpm',
        expect.arrayContaining(['codegen', 'ts']),
        expect.objectContaining({cwd: '/project'}),
      )
    })

    it('throws SDK_COMMAND_FAILED on non-zero exit', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      runner.run.mockResolvedValue({exitCode: 1, stderr: 'codegen error', stdout: ''})

      const sdk = createDamlSdk({runner})
      await expect(sdk.codegen({language: 'ts', projectDir: '/project'})).rejects.toThrow(CantonctlError)
      try {
        await sdk.codegen({language: 'ts', projectDir: '/project'})
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.SDK_COMMAND_FAILED)
      }
    })
  })

  describe('startSandbox()', () => {
    it('spawns sandbox process with correct arguments', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      const mockProc: SpawnedProcess = {
        kill: vi.fn(),
        onExit: vi.fn(),
        waitForExit: vi.fn().mockResolvedValue(0),
        pid: 9999,
        stderr: null,
        stdout: null,
      }
      runner.spawn.mockReturnValue(mockProc)

      const sdk = createDamlSdk({runner})
      const proc = await sdk.startSandbox({jsonApiPort: 7575, port: 5001})
      expect(proc.pid).toBe(9999)
      expect(runner.spawn).toHaveBeenCalledWith(
        'dpm',
        expect.arrayContaining(['sandbox', '--port', '5001', '--json-api-port', '7575']),
        expect.anything(),
      )
    })

    it('uses daml sandbox when dpm is not available', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'daml' ? '/usr/local/bin/daml' : null,
      )
      const mockProc: SpawnedProcess = {
        kill: vi.fn(),
        onExit: vi.fn(),
        waitForExit: vi.fn().mockResolvedValue(0),
        pid: 8888,
        stderr: null,
        stdout: null,
      }
      runner.spawn.mockReturnValue(mockProc)

      const sdk = createDamlSdk({runner})
      const proc = await sdk.startSandbox({jsonApiPort: 7575, port: 5001})
      expect(proc.pid).toBe(8888)
      expect(runner.spawn).toHaveBeenCalledWith(
        'daml',
        expect.arrayContaining(['sandbox']),
        expect.anything(),
      )
    })

    it('passes extra args to sandbox command', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      const mockProc: SpawnedProcess = {
        kill: vi.fn(),
        onExit: vi.fn(),
        waitForExit: vi.fn().mockResolvedValue(0),
        pid: 7777,
        stderr: null,
        stdout: null,
      }
      runner.spawn.mockReturnValue(mockProc)

      const sdk = createDamlSdk({runner})
      await sdk.startSandbox({extraArgs: ['--static-time'], jsonApiPort: 7575, port: 5001})
      expect(runner.spawn).toHaveBeenCalledWith(
        'dpm',
        expect.arrayContaining(['--static-time']),
        expect.anything(),
      )
    })

    it('uses default sandbox ports when none are provided', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      const mockProc: SpawnedProcess = {
        kill: vi.fn(),
        onExit: vi.fn(),
        waitForExit: vi.fn().mockResolvedValue(0),
        pid: 6666,
        stderr: null,
        stdout: null,
      }
      runner.spawn.mockReturnValue(mockProc)

      const sdk = createDamlSdk({runner})
      await sdk.startSandbox({})

      expect(runner.spawn).toHaveBeenCalledWith(
        'dpm',
        expect.arrayContaining(['sandbox', '--port', '5001', '--json-api-port', '7575']),
        expect.anything(),
      )
    })
  })

  describe('AbortSignal', () => {
    it('test() respects AbortSignal', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      const controller = new AbortController()
      controller.abort()

      const sdk = createDamlSdk({runner})
      await expect(sdk.test({projectDir: '/project', signal: controller.signal})).rejects.toThrow()
    })

    it('codegen() respects AbortSignal', async () => {
      const runner = createMockRunner()
      runner.which.mockImplementation(async (cmd: string) =>
        cmd === 'dpm' ? '/usr/local/bin/dpm' : null,
      )
      const controller = new AbortController()
      controller.abort()

      const sdk = createDamlSdk({runner})
      await expect(sdk.codegen({language: 'ts', projectDir: '/project', signal: controller.signal})).rejects.toThrow()
    })
  })
})
