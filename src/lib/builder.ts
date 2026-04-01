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
import type {OutputWriter} from './output.js'
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

/** Minimal chokidar-compatible watcher interface for DI. */
export interface BuildWatcher {
  on(event: string, handler: (...args: unknown[]) => void): BuildWatcher
  close(): Promise<void>
}

export interface WatchOptions {
  /** Absolute path to the project root. */
  projectDir: string
  /** Output writer for status messages. */
  output: OutputWriter
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
  /** File watcher factory (chokidar.watch). */
  watch: (paths: string, opts?: Record<string, unknown>) => BuildWatcher
  /** Debounce delay in ms (default 300). */
  debounceMs?: number
}

export interface Builder {
  /** Compile Daml to .dar with caching. */
  build(opts: BuildOptions): Promise<BuildResult>
  /** Compile Daml to .dar then generate language bindings. */
  buildWithCodegen(opts: BuildWithCodegenOptions): Promise<BuildResult>
  /** Watch for .daml file changes and rebuild automatically. Returns a stop function. */
  watch(opts: WatchOptions): Promise<{stop: () => Promise<void>}>
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

    async watch(opts: WatchOptions): Promise<{stop: () => Promise<void>}> {
      const {output, projectDir, watch} = opts
      const debounceMs = opts.debounceMs ?? 300
      const damlDir = `${projectDir}/${SOURCE_DIR}`

      let rebuildInProgress = false
      let rebuildQueued = false
      let debounceTimer: ReturnType<typeof setTimeout> | null = null

      const watcher = watch(damlDir, {ignoreInitial: true})

      const triggerBuild = async () => {
        if (rebuildInProgress) {
          rebuildQueued = true
          return
        }

        rebuildInProgress = true
        try {
          output.info('Rebuilding...')
          const result = await runBuild({projectDir, force: true})
          if (result.darPath) {
            output.success(`Build successful: ${result.darPath.split('/').pop()}`)
          } else {
            output.success('Build successful')
          }
        } catch (err) {
          if (err instanceof CantonctlError) {
            output.error(`${err.code}: ${err.message}`)
          } else {
            output.error(`Build failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        } finally {
          rebuildInProgress = false
          if (rebuildQueued) {
            rebuildQueued = false
            await triggerBuild()
          }
        }
      }

      watcher.on('change', (filePath: unknown) => {
        const fp = String(filePath)
        if (!fp.endsWith('.daml')) return

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          output.info(`File changed: ${fp}`)
          triggerBuild()
        }, debounceMs)
      })

      // Handle abort signal
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          if (debounceTimer) clearTimeout(debounceTimer)
          watcher.close()
        }, {once: true})
      }

      output.info(`Watching for changes: ${damlDir}`)

      return {
        async stop() {
          if (debounceTimer) {
            clearTimeout(debounceTimer)
            debounceTimer = null
          }

          await watcher.close()
        },
      }
    },
  }
}
