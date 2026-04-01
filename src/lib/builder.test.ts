import {describe, expect, it, vi} from 'vitest'

import type {DamlSdk, SdkCommandResult} from './daml.js'
import {type BuildOptions, type BuildResult, type Builder, type BuilderDeps, type BuildWatcher, createBuilder} from './builder.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {OutputWriter} from './output.js'
import {createPluginHookManager} from './plugin-hooks.js'

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

function createDefaultDeps(overrides: Partial<BuilderDeps> = {}): BuilderDeps {
  const sdk = createMockSdk()
  sdk.build.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'built', success: true} as SdkCommandResult)
  sdk.codegen.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'codegen done', success: true} as SdkCommandResult)

  return {
    findDarFile: vi.fn().mockResolvedValue('/project/.daml/dist/my-app-1.0.0.dar'),
    getDamlSourceMtime: vi.fn().mockResolvedValue(1000),
    getFileMtime: vi.fn().mockResolvedValue(2000), // DAR newer than source = cached
    sdk,
    ...overrides,
  }
}

const defaultOpts: BuildOptions = {
  projectDir: '/project',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Builder', () => {
  describe('build()', () => {
    it('runs SDK build and returns DAR path', async () => {
      const deps = createDefaultDeps({
        getFileMtime: vi.fn().mockResolvedValue(null), // No existing DAR = must build
      })
      const builder = createBuilder(deps)
      const result = await builder.build(defaultOpts)

      expect(result.success).toBe(true)
      expect(result.darPath).toBe('/project/.daml/dist/my-app-1.0.0.dar')
      expect(deps.sdk.build).toHaveBeenCalledWith(
        expect.objectContaining({projectDir: '/project'}),
      )
    })

    it('skips build when DAR is newer than sources (cache hit)', async () => {
      const deps = createDefaultDeps({
        getDamlSourceMtime: vi.fn().mockResolvedValue(1000),
        getFileMtime: vi.fn().mockResolvedValue(2000), // DAR newer
      })
      const builder = createBuilder(deps)
      const result = await builder.build(defaultOpts)

      expect(result.success).toBe(true)
      expect(result.cached).toBe(true)
      expect(deps.sdk.build).not.toHaveBeenCalled()
    })

    it('rebuilds when sources are newer than DAR', async () => {
      const deps = createDefaultDeps({
        getDamlSourceMtime: vi.fn().mockResolvedValue(3000), // Source newer
        getFileMtime: vi.fn().mockResolvedValue(2000),
      })
      const builder = createBuilder(deps)
      const result = await builder.build(defaultOpts)

      expect(result.cached).toBeFalsy()
      expect(deps.sdk.build).toHaveBeenCalled()
    })

    it('always builds when force is true', async () => {
      const deps = createDefaultDeps() // DAR newer = would be cached
      const builder = createBuilder(deps)
      const result = await builder.build({...defaultOpts, force: true})

      expect(deps.sdk.build).toHaveBeenCalled()
    })

    it('throws BUILD_DAML_ERROR on build failure', async () => {
      const sdk = createMockSdk()
      sdk.build.mockRejectedValue(new CantonctlError(ErrorCode.BUILD_DAML_ERROR, {
        context: {stderr: 'compilation error'},
      }))

      const deps = createDefaultDeps({
        getFileMtime: vi.fn().mockResolvedValue(null),
        sdk,
      })
      const builder = createBuilder(deps)

      await expect(builder.build(defaultOpts)).rejects.toThrow(CantonctlError)
      try {
        await builder.build(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.BUILD_DAML_ERROR)
      }
    })

    it('throws BUILD_DAR_NOT_FOUND when build succeeds but no DAR produced', async () => {
      const deps = createDefaultDeps({
        findDarFile: vi.fn().mockResolvedValue(null),
        getFileMtime: vi.fn().mockResolvedValue(null),
      })
      const builder = createBuilder(deps)

      await expect(builder.build(defaultOpts)).rejects.toThrow(CantonctlError)
      try {
        await builder.build(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.BUILD_DAR_NOT_FOUND)
      }
    })

    it('includes timing in result', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const result = await builder.build(defaultOpts)

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('respects AbortSignal', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const controller = new AbortController()
      controller.abort()

      const builder = createBuilder(deps)
      await expect(builder.build({...defaultOpts, signal: controller.signal})).rejects.toThrow()
    })
  })

  describe('plugin hooks', () => {
    it('emits beforeBuild and afterBuild hooks', async () => {
      const hooks = createPluginHookManager()
      const events: string[] = []
      hooks.register('beforeBuild', async () => { events.push('before') })
      hooks.register('afterBuild', async () => { events.push('after') })

      const deps = createDefaultDeps({
        getFileMtime: vi.fn().mockResolvedValue(null),
        hooks,
      })
      const builder = createBuilder(deps)
      await builder.build(defaultOpts)

      expect(events).toEqual(['before', 'after'])
    })

    it('emits afterBuild with context on cache hit', async () => {
      const hooks = createPluginHookManager()
      let ctx: Record<string, unknown> = {}
      hooks.register('afterBuild', async (c) => { ctx = c })

      const deps = createDefaultDeps({hooks})
      const builder = createBuilder(deps)
      await builder.build(defaultOpts)

      expect(ctx.cached).toBe(true)
      expect(ctx.darPath).toBe('/project/.daml/dist/my-app-1.0.0.dar')
    })

    it('works without hooks (optional)', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const result = await builder.build(defaultOpts)
      expect(result.success).toBe(true)
    })
  })

  describe('buildWithCodegen()', () => {
    it('runs build then codegen', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const result = await builder.buildWithCodegen({...defaultOpts, language: 'ts'})

      expect(result.success).toBe(true)
      expect(deps.sdk.build).toHaveBeenCalled()
      expect(deps.sdk.codegen).toHaveBeenCalledWith(
        expect.objectContaining({language: 'ts', projectDir: '/project'}),
      )
    })

    it('skips codegen if build was cached and codegen output exists', async () => {
      const deps = createDefaultDeps() // cache hit
      const builder = createBuilder(deps)
      const result = await builder.buildWithCodegen({...defaultOpts, language: 'ts'})

      expect(result.cached).toBe(true)
      expect(deps.sdk.codegen).not.toHaveBeenCalled()
    })

    it('runs codegen even on cache hit when force is true', async () => {
      const deps = createDefaultDeps()
      const builder = createBuilder(deps)
      await builder.buildWithCodegen({...defaultOpts, force: true, language: 'ts'})

      expect(deps.sdk.codegen).toHaveBeenCalled()
    })
  })

  describe('watch()', () => {
    function createMockWatcher(): BuildWatcher & {handlers: Map<string, (...args: unknown[]) => void>} {
      const handlers = new Map<string, (...args: unknown[]) => void>()
      return {
        close: vi.fn().mockResolvedValue(undefined),
        handlers,
        on(event: string, handler: (...args: unknown[]) => void) {
          handlers.set(event, handler)
          return this
        },
      }
    }

    function createMockOutput(): OutputWriter {
      return {
        error: vi.fn(),
        info: vi.fn(),
        log: vi.fn(),
        result: vi.fn(),
        spinner: vi.fn().mockReturnValue({fail: vi.fn(), start: vi.fn(), stop: vi.fn(), succeed: vi.fn()}),
        success: vi.fn(),
        table: vi.fn(),
        warn: vi.fn(),
      }
    }

    it('starts watching daml/ directory', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()
      const watchFn = vi.fn().mockReturnValue(mockWatcher)

      await builder.watch({
        output: createMockOutput(),
        projectDir: '/project',
        watch: watchFn,
      })

      expect(watchFn).toHaveBeenCalledWith('/project/daml', {ignoreInitial: true})
    })

    it('rebuilds on .daml file change', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()
      const output = createMockOutput()

      await builder.watch({
        debounceMs: 0,
        output,
        projectDir: '/project',
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      // Trigger a .daml file change
      mockWatcher.handlers.get('change')?.('/project/daml/Main.daml')
      await new Promise(r => setTimeout(r, 50))

      expect(deps.sdk.build).toHaveBeenCalled()
      expect(output.success).toHaveBeenCalled()
    })

    it('ignores non-.daml file changes', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()

      await builder.watch({
        debounceMs: 0,
        output: createMockOutput(),
        projectDir: '/project',
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      mockWatcher.handlers.get('change')?.('/project/daml/README.md')
      await new Promise(r => setTimeout(r, 50))

      expect(deps.sdk.build).not.toHaveBeenCalled()
    })

    it('reports build errors without crashing', async () => {
      const sdk = createMockSdk()
      sdk.build.mockRejectedValue(new CantonctlError(ErrorCode.BUILD_DAML_ERROR, {}))
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null), sdk})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()
      const output = createMockOutput()

      await builder.watch({
        debounceMs: 0,
        output,
        projectDir: '/project',
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      mockWatcher.handlers.get('change')?.('/project/daml/Main.daml')
      await new Promise(r => setTimeout(r, 50))

      expect(output.error).toHaveBeenCalled()
    })

    it('queues rebuild if one is in progress', async () => {
      let buildResolve: (() => void) | null = null
      const buildPromise = new Promise<SdkCommandResult>(resolve => {
        buildResolve = () => resolve({exitCode: 0, stderr: '', stdout: '', success: true})
      })
      const sdk = createMockSdk()
      sdk.build.mockReturnValue(buildPromise)
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null), sdk})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()

      await builder.watch({
        debounceMs: 0,
        output: createMockOutput(),
        projectDir: '/project',
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      // Trigger first change
      mockWatcher.handlers.get('change')?.('/project/daml/A.daml')
      await new Promise(r => setTimeout(r, 10))

      // Trigger second while first is building
      mockWatcher.handlers.get('change')?.('/project/daml/B.daml')
      await new Promise(r => setTimeout(r, 10))

      // Resolve first build
      buildResolve!()
      await new Promise(r => setTimeout(r, 50))

      expect(sdk.build.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('stop() closes watcher and clears timer', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()

      const {stop} = await builder.watch({
        output: createMockOutput(),
        projectDir: '/project',
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      await stop()
      expect(mockWatcher.close).toHaveBeenCalled()
    })

    it('respects AbortSignal', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()
      const controller = new AbortController()

      await builder.watch({
        output: createMockOutput(),
        projectDir: '/project',
        signal: controller.signal,
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      controller.abort()
      expect(mockWatcher.close).toHaveBeenCalled()
    })

    it('reports non-CantonctlError build failures', async () => {
      const sdk = createMockSdk()
      sdk.build.mockRejectedValue(new Error('ENOENT'))
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null), sdk})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()
      const output = createMockOutput()

      await builder.watch({
        debounceMs: 0,
        output,
        projectDir: '/project',
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      mockWatcher.handlers.get('change')?.('/project/daml/Main.daml')
      await new Promise(r => setTimeout(r, 50))

      expect(output.error).toHaveBeenCalledWith(expect.stringContaining('ENOENT'))
    })

    it('shows DAR filename in success message', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()
      const output = createMockOutput()

      await builder.watch({
        debounceMs: 0,
        output,
        projectDir: '/project',
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      mockWatcher.handlers.get('change')?.('/project/daml/Main.daml')
      await new Promise(r => setTimeout(r, 50))

      expect(output.success).toHaveBeenCalledWith(expect.stringContaining('my-app-1.0.0.dar'))
    })

    it('stop() clears pending debounce timer', async () => {
      const deps = createDefaultDeps({getFileMtime: vi.fn().mockResolvedValue(null)})
      const builder = createBuilder(deps)
      const mockWatcher = createMockWatcher()

      const {stop} = await builder.watch({
        debounceMs: 5000, // Long debounce so timer is still pending
        output: createMockOutput(),
        projectDir: '/project',
        watch: vi.fn().mockReturnValue(mockWatcher),
      })

      // Trigger a change to create a pending debounce timer
      mockWatcher.handlers.get('change')?.('/project/daml/Main.daml')

      // Stop should clear the timer without building
      await stop()
      expect(mockWatcher.close).toHaveBeenCalled()
      expect(deps.sdk.build).not.toHaveBeenCalled()
    })
  })
})
