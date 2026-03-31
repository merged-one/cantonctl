/**
 * @module builder
 *
 * Build orchestration for cantonctl. Wraps `DamlSdk.build()` with:
 * - **DAR caching** via mtime comparison (skip build when .dar is newer than sources)
 * - **Codegen** option to generate TypeScript bindings after compilation
 * - **AbortSignal** for cancellation
 *
 * Follows ADR-0011 (wrap SDK, don't reimplement) and ADR-0013 (mtime caching).
 *
 * @example
 * ```ts
 * const builder = createBuilder({ sdk, findDarFile, getFileMtime, getDamlSourceMtime })
 * const result = await builder.build({ projectDir: '/my-app' })
 * console.log(result.darPath) // .daml/dist/my-app-1.0.0.dar
 * ```
 */

import type {DamlSdk} from './daml.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {PluginHookManager} from './plugin-hooks.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuilderDeps {
  /** Daml SDK abstraction. */
  sdk: DamlSdk
  /** Find the .dar file in a directory. Returns absolute path or null. */
  findDarFile: (dir: string) => Promise<string | null>
  /** Get mtime of a file in ms since epoch. Returns null if file doesn't exist. */
  getFileMtime: (path: string) => Promise<number | null>
  /** Get the newest mtime among all .daml source files. Returns 0 if no sources. */
  getDamlSourceMtime: (sourceDir: string) => Promise<number>
  /** Plugin hook manager for lifecycle events. */
  hooks?: PluginHookManager
}

export interface BuildOptions {
  /** Absolute path to the project root. */
  projectDir: string
  /** Force rebuild even if DAR is fresh. */
  force?: boolean
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
}

export interface BuildWithCodegenOptions extends BuildOptions {
  /** Target language for code generation. */
  language: 'ts' | 'java'
}

export interface BuildResult {
  success: boolean
  /** Absolute path to the .dar file. */
  darPath: string | null
  /** True if the build was skipped due to cache. */
  cached?: boolean
  /** Build duration in milliseconds. */
  durationMs: number
}

export interface Builder {
  /** Compile Daml to .dar with caching. */
  build(opts: BuildOptions): Promise<BuildResult>
  /** Compile Daml to .dar then generate language bindings. */
  buildWithCodegen(opts: BuildWithCodegenOptions): Promise<BuildResult>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DAR_DIR = '.daml/dist'
const SOURCE_DIR = 'daml'

/**
 * Create a Builder that wraps DamlSdk with caching and codegen.
 */
export function createBuilder(deps: BuilderDeps): Builder {
  const {findDarFile, getDamlSourceMtime, getFileMtime, hooks, sdk} = deps

  async function runBuild(opts: BuildOptions): Promise<BuildResult> {
    const start = Date.now()
    const darDir = `${opts.projectDir}/${DAR_DIR}`
    const sourceDir = `${opts.projectDir}/${SOURCE_DIR}`

    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    await hooks?.emit('beforeBuild', {force: opts.force, projectDir: opts.projectDir})

    // Check cache: skip build if DAR is newer than all sources
    if (!opts.force) {
      const existingDar = await findDarFile(darDir)
      if (existingDar) {
        const darMtime = await getFileMtime(existingDar)
        const sourceMtime = await getDamlSourceMtime(sourceDir)
        if (darMtime !== null && darMtime > sourceMtime) {
          const result: BuildResult = {
            cached: true,
            darPath: existingDar,
            durationMs: Date.now() - start,
            success: true,
          }
          await hooks?.emit('afterBuild', {cached: true, darPath: existingDar, durationMs: result.durationMs, projectDir: opts.projectDir})
          return result
        }
      }
    }

    // Run build
    await sdk.build({projectDir: opts.projectDir, signal: opts.signal})

    // Find the produced DAR
    const darPath = await findDarFile(darDir)
    if (!darPath) {
      throw new CantonctlError(ErrorCode.BUILD_DAR_NOT_FOUND, {
        context: {darDir},
        suggestion: 'Build succeeded but no .dar was produced. Check daml.yaml name and source fields.',
      })
    }

    const durationMs = Date.now() - start
    await hooks?.emit('afterBuild', {cached: false, darPath, durationMs, projectDir: opts.projectDir})

    return {
      darPath,
      durationMs,
      success: true,
    }
  }

  return {
    async build(opts: BuildOptions): Promise<BuildResult> {
      return runBuild(opts)
    },

    async buildWithCodegen(opts: BuildWithCodegenOptions): Promise<BuildResult> {
      const result = await runBuild(opts)

      // Skip codegen on cache hit (unless forced)
      if (result.cached && !opts.force) {
        return result
      }

      await sdk.codegen({language: opts.language, projectDir: opts.projectDir, signal: opts.signal})
      return result
    },
  }
}
