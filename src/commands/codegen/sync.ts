import {Command, Flags} from '@oclif/core'

import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'
import {createProcessRunner, type ProcessRunner} from '../../lib/process-runner.js'

interface SyncStepResult {
  command: string
  exitCode: number
  stderr: string
  stdout: string
  success: boolean
}

export default class CodegenSync extends Command {
  static override description = 'Sync upstream specs and regenerate stable generated clients'

  static override examples = [
    '<%= config.bin %> codegen sync',
    '<%= config.bin %> codegen sync --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CodegenSync)
    const out = createOutput({json: flags.json})

    try {
      const runner = this.createRunner()
      const cwd = this.getCommandCwd()
      const steps: Array<{args: string[]; label: string}> = [
        {args: ['run', 'codegen:fetch-specs'], label: 'Fetch upstream specs'},
        {args: ['run', 'codegen:generate-types'], label: 'Generate stable clients'},
      ]
      const results: SyncStepResult[] = []

      for (const step of steps) {
        if (!flags.json) {
          out.info(step.label)
        }

        const result = await runner.run('npm', step.args, {
          cwd,
          ignoreExitCode: true,
        })
        const command = `npm ${step.args.join(' ')}`
        const success = result.exitCode === 0

        results.push({
          command,
          exitCode: result.exitCode,
          stderr: result.stderr,
          stdout: result.stdout,
          success,
        })

        if (!success) {
          throw new CantonctlError(ErrorCode.SDK_COMMAND_FAILED, {
            context: {command, cwd, exitCode: result.exitCode, stderr: result.stderr},
            suggestion: 'Run the codegen scripts from the repository root and inspect the failing step output.',
          })
        }
      }

      if (!flags.json) {
        out.success('Upstream specs synced and stable clients regenerated')
      }

      if (flags.json) {
        out.result({
          data: {steps: results},
          success: true,
        })
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

  protected createRunner(): ProcessRunner {
    return createProcessRunner()
  }

  protected getCommandCwd(): string {
    return process.cwd()
  }
}
