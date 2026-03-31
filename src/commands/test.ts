/**
 * @module commands/test
 *
 * Runs Daml Script tests with structured output. Thin oclif wrapper
 * over {@link createTestRunner}.
 */

import {Command, Flags} from '@oclif/core'

import {createDamlSdk} from '../lib/daml.js'
import {CantonctlError} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import {createPluginHookManager} from '../lib/plugin-hooks.js'
import {createProcessRunner} from '../lib/process-runner.js'
import {createTestRunner} from '../lib/test-runner.js'

export default class Test extends Command {
  static override description = 'Run Daml Script tests with structured output'

  static override examples = [
    '<%= config.bin %> test',
    '<%= config.bin %> test --filter testTransfer',
    '<%= config.bin %> test --json',
  ]

  static override flags = {
    filter: Flags.string({
      char: 'f',
      description: 'Filter tests by name pattern',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output results as JSON (for CI)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Test)
    const out = createOutput({json: flags.json})

    try {
      const runner = createProcessRunner()
      const sdk = createDamlSdk({runner})
      const hooks = createPluginHookManager()
      const testRunner = createTestRunner({hooks, sdk})

      out.info('Running Daml Script tests...')

      const result = await testRunner.run({
        filter: flags.filter,
        projectDir: process.cwd(),
      })

      if (result.passed) {
        out.success('All tests passed')
      } else {
        out.error('Some tests failed')
      }

      if (!flags.json && result.output) {
        out.log(result.output)
      }

      out.result({
        data: {
          durationMs: result.durationMs,
          output: result.output,
          passed: result.passed,
        },
        success: result.success,
        timing: {durationMs: result.durationMs},
      })

      if (!result.passed) {
        this.exit(1)
      }
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
