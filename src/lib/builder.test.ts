import {describe, expect, it, vi} from 'vitest'

import type {DamlSdk, SdkCommandResult} from './daml.js'
import {type BuildOptions, type BuildResult, type Builder, type BuilderDeps, createBuilder} from './builder.js'
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
})
