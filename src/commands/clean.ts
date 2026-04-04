/**
 * @module commands/clean
 *
 * Removes build artifacts (.daml/, dist/) from the project. Thin oclif
 * wrapper over {@link createCleaner}.
 */

import {Command, Flags} from '@oclif/core'
import * as fs from 'node:fs'
import * as readline from 'node:readline'

import {createCleaner, type Cleaner} from '../lib/cleaner.js'
import {CantonctlError} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'

export default class Clean extends Command {
  static override description = 'Remove build artifacts (.daml/, dist/)'

  static override examples = [
    '<%= config.bin %> clean',
    '<%= config.bin %> clean --all',
    '<%= config.bin %> clean --force',
    '<%= config.bin %> clean --json',
  ]

  static override flags = {
    all: Flags.boolean({
      default: false,
      description: 'Also remove node_modules/',
    }),
    force: Flags.boolean({
      default: false,
      description: 'Skip confirmation prompt',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output result as JSON',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Clean)
    const out = createOutput({json: flags.json})

    try {
      const cleaner = this.createCleaner(flags.json, out)

      const result = await cleaner.clean({
        all: flags.all,
        force: flags.force,
        projectDir: process.cwd(),
      })

      out.result({
        data: {
          removed: result.removed,
          skipped: result.skipped,
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

  protected createCleaner(json: boolean, out: ReturnType<typeof createOutput>): Cleaner {
    return createCleaner({
      confirm: json ? undefined : (msg: string) => this.promptConfirm(msg),
      fs: {
        rm: (path: string, opts: {force: boolean; recursive: boolean}) => fs.promises.rm(path, opts),
        stat: (path: string) => fs.promises.stat(path),
      },
      output: out,
    })
  }

  protected createReadlineInterface(options: readline.ReadLineOptions): readline.Interface {
    return readline.createInterface(options)
  }

  private async promptConfirm(message: string): Promise<boolean> {
    const rl = this.createReadlineInterface({
      input: process.stdin,
      output: process.stderr,
    })

    return new Promise((resolve) => {
      rl.question(`${message} [y/N] `, (answer) => {
        rl.close()
        resolve(answer.trim().toLowerCase() === 'y')
      })
    })
  }
}
