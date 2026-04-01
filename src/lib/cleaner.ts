/**
 * @module cleaner
 *
 * Build artifact cleanup for cantonctl. Removes `.daml/`, `dist/`, and
 * optionally `node_modules/`. Confirms before deleting unless `--force`.
 *
 * @example
 * ```ts
 * const cleaner = createCleaner({ fs, output })
 * const result = await cleaner.clean({ projectDir: '/my-app', force: true })
 * console.log(result.removed) // ['.daml', 'dist']
 * ```
 */

import type {OutputWriter} from './output.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CleanerDeps {
  /** Filesystem abstraction for testability. */
  fs: {
    rm: (path: string, opts: {force: boolean; recursive: boolean}) => Promise<void>
    stat: (path: string) => Promise<{isDirectory: () => boolean}>
  }
  /** Output writer for progress messages. */
  output: OutputWriter
  /** Confirmation prompt. Returns true to proceed. */
  confirm?: (message: string) => Promise<boolean>
}

export interface CleanOptions {
  /** Absolute path to the project root. */
  projectDir: string
  /** Also remove node_modules/. */
  all?: boolean
  /** Skip confirmation prompt. */
  force?: boolean
}

export interface CleanResult {
  /** Directories that were removed. */
  removed: string[]
  /** Directories that didn't exist (skipped). */
  skipped: string[]
  /** Clean duration in milliseconds. */
  durationMs: number
}

export interface Cleaner {
  /** Remove build artifacts from the project. */
  clean(opts: CleanOptions): Promise<CleanResult>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_TARGETS = ['.daml', 'dist', '.cantonctl']
const ALL_TARGETS = [...DEFAULT_TARGETS, 'node_modules']

/**
 * Create a Cleaner for removing build artifacts.
 */
export function createCleaner(deps: CleanerDeps): Cleaner {
  const {confirm, fs, output} = deps

  return {
    async clean(opts: CleanOptions): Promise<CleanResult> {
      const start = Date.now()
      const targets = opts.all ? ALL_TARGETS : DEFAULT_TARGETS
      const removed: string[] = []
      const skipped: string[] = []

      // Check which targets exist
      const existing: string[] = []
      for (const target of targets) {
        const fullPath = `${opts.projectDir}/${target}`
        try {
          const stat = await fs.stat(fullPath)
          if (stat.isDirectory()) {
            existing.push(target)
          } else {
            skipped.push(target)
          }
        } catch {
          skipped.push(target)
        }
      }

      if (existing.length === 0) {
        output.info('Nothing to clean')
        return {durationMs: Date.now() - start, removed, skipped}
      }

      // Confirm unless --force
      if (!opts.force && confirm) {
        const proceed = await confirm(`Remove ${existing.join(', ')}?`)
        if (!proceed) {
          output.info('Clean cancelled')
          return {durationMs: Date.now() - start, removed: [], skipped: existing}
        }
      }

      // Remove
      for (const target of existing) {
        const fullPath = `${opts.projectDir}/${target}`
        await fs.rm(fullPath, {force: true, recursive: true})
        removed.push(target)
        output.success(`Removed ${target}/`)
      }

      return {durationMs: Date.now() - start, removed, skipped}
    },
  }
}
