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

import {createBuilder, type Builder} from '../lib/builder.js'
import {createDamlSdk, type DamlSdk} from '../lib/daml.js'
import {CantonctlError} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import {createPluginHookManager, type PluginHookManager} from '../lib/plugin-hooks.js'
import {createProcessRunner, type ProcessRunner} from '../lib/process-runner.js'
import {findDarFile, getFileMtime, getNewestDamlSourceMtime} from '../lib/runtime-support.js'

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
      const runner = this.createRunner()
      const sdk = this.createSdk(runner)
      const hooks = this.createHooks()
      const builder = this.createBuilder({hooks, sdk})
      const projectDir = this.getProjectDir()

      if (flags.watch) {
        // Watch mode: continuous compilation
        out.info('Starting watch mode...')

        const controller = new AbortController()
        let shutdownResolve: (() => void) | null = null
        const shutdownPromise = new Promise<void>(resolve => { shutdownResolve = resolve })

        const {stop} = await builder.watch({
          output: out,
          projectDir,
          signal: controller.signal,
          watch: this.createWatcher(),
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
        const result = await builder.build({force: flags.force, projectDir})
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
        ? await builder.buildWithCodegen({force: flags.force, language: 'ts', projectDir})
        : await builder.build({force: flags.force, projectDir})

      if (result.cached) {
        out.success('Build up to date (cached)')
      } else {
        out.success('Build successful')
        if (flags.codegen) {
          out.success('TypeScript bindings generated')
        }
      }

      if (result.darPath) {
        out.info(`DAR: ${path.relative(projectDir, result.darPath)}`)
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

  protected createBuilder(deps: {hooks: PluginHookManager; sdk: DamlSdk}): Builder {
    return createBuilder({
      findDarFile,
      getDamlSourceMtime: getNewestDamlSourceMtime,
      getFileMtime,
      hooks: deps.hooks,
      sdk: deps.sdk,
    })
  }

  protected createHooks(): PluginHookManager {
    return createPluginHookManager()
  }

  protected createRunner(): ProcessRunner {
    return createProcessRunner()
  }

  protected createSdk(runner: ProcessRunner): DamlSdk {
    return createDamlSdk({runner})
  }

  protected createWatcher() {
    return (paths: string | string[], opts: Parameters<typeof watch>[1]) => watch(paths, opts)
  }

  protected getProjectDir(): string {
    return process.cwd()
  }
}
