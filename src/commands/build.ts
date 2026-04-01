/**
 * @module commands/build
 *
 * Compiles Daml contracts and optionally generates TypeScript bindings.
 * Thin oclif wrapper over {@link createBuilder}.
 */

import {Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {watch} from 'chokidar'

import {createBuilder} from '../lib/builder.js'
import {createDamlSdk} from '../lib/daml.js'
import {CantonctlError} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import {createPluginHookManager} from '../lib/plugin-hooks.js'
import {createProcessRunner} from '../lib/process-runner.js'

/** Find the first .dar file in a directory. */
async function findDarFile(dir: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(dir)
    const darFile = entries.find(e => e.endsWith('.dar'))
    return darFile ? path.join(dir, darFile) : null
  } catch {
    return null
  }
}

/** Get file modification time in ms since epoch. */
async function getFileMtime(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(filePath)
    return stat.mtimeMs
  } catch {
    return null
  }
}

/** Get the newest mtime among all .daml files in a directory (recursive). */
async function getDamlSourceMtime(dir: string): Promise<number> {
  let newest = 0
  try {
    const entries = await fs.promises.readdir(dir, {withFileTypes: true})
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const sub = await getDamlSourceMtime(fullPath)
        if (sub > newest) newest = sub
      } else if (entry.name.endsWith('.daml')) {
        const stat = await fs.promises.stat(fullPath)
        if (stat.mtimeMs > newest) newest = stat.mtimeMs
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return newest
}

export default class Build extends Command {
  static override description = 'Compile Daml contracts and generate TypeScript bindings'

  static override examples = [
    '<%= config.bin %> build',
    '<%= config.bin %> build --codegen',
    '<%= config.bin %> build --force',
    '<%= config.bin %> build --watch',
    '<%= config.bin %> build --json',
  ]

  static override flags = {
    codegen: Flags.boolean({
      allowNo: true,
      char: 'c',
      default: false,
      description: 'Generate TypeScript bindings after compilation',
    }),
    force: Flags.boolean({
      default: false,
      description: 'Force rebuild even if DAR is up to date',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
    watch: Flags.boolean({
      char: 'w',
      default: false,
      description: 'Watch for changes and rebuild automatically',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Build)
    const out = createOutput({json: flags.json})

    try {
      const runner = createProcessRunner()
      const sdk = createDamlSdk({runner})
      const hooks = createPluginHookManager()
      const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, hooks, sdk})

      if (flags.watch) {
        // Watch mode: continuous compilation
        out.info('Starting watch mode...')

        const controller = new AbortController()
        let shutdownResolve: (() => void) | null = null
        const shutdownPromise = new Promise<void>(resolve => { shutdownResolve = resolve })

        const {stop} = await builder.watch({
          output: out,
          projectDir: process.cwd(),
          signal: controller.signal,
          watch: (paths, opts) => watch(paths, opts),
        })

        const shutdown = async () => {
          out.info('\nStopping watch mode...')
          controller.abort()
          await stop()
          out.success('Watch mode stopped')
          out.result({data: {status: 'stopped'}, success: true})
          shutdownResolve?.()
        }

        process.on('SIGINT', shutdown)
        process.on('SIGTERM', shutdown)

        if (process.stdin.isTTY && !flags.json) {
          process.stdin.setRawMode(true)
          process.stdin.resume()
          process.stdin.on('data', async (data) => {
            const key = data.toString()
            if (key === 'q' || key === '\u0003') await shutdown()
          })
        }

        // Do an initial build
        const result = await builder.build({force: flags.force, projectDir: process.cwd()})
        if (result.cached) {
          out.success('Build up to date (cached)')
        } else {
          out.success('Build successful')
        }

        out.log('\nPress Ctrl+C or q to stop watching')
        await shutdownPromise

        if (process.stdin.isTTY && !flags.json) {
          process.stdin.setRawMode(false)
          process.stdin.pause()
        }

        return
      }

      // Single build mode
      out.info('Compiling Daml contracts...')

      const result = flags.codegen
        ? await builder.buildWithCodegen({force: flags.force, language: 'ts', projectDir: process.cwd()})
        : await builder.build({force: flags.force, projectDir: process.cwd()})

      if (result.cached) {
        out.success('Build up to date (cached)')
      } else {
        out.success('Build successful')
        if (flags.codegen) {
          out.success('TypeScript bindings generated')
        }
      }

      if (result.darPath) {
        out.info(`DAR: ${path.relative(process.cwd(), result.darPath)}`)
      }

      out.result({
        data: {
          cached: result.cached ?? false,
          darPath: result.darPath,
          durationMs: result.durationMs,
        },
        success: true,
        timing: {durationMs: result.durationMs},
      })
    } catch (err) {
      if (err instanceof CantonctlError) {
        out.result({
          error: {code: err.code, message: err.message, suggestion: err.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw err
    }
  }
}
