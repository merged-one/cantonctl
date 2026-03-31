import {Command, Flags} from '@oclif/core'
import {execSync} from 'node:child_process'

export default class Test extends Command {
  static override description = 'Run Daml Script tests with structured output'

  static override examples = [
    '<%= config.bin %> test',
    '<%= config.bin %> test --json',
    '<%= config.bin %> test --filter testTransfer',
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

    if (!flags.json) {
      this.log('Running Daml Script tests...')
      this.log('')
    }

    try {
      const testCmd = this.resolveTestCommand(flags.filter)
      const startTime = Date.now()

      execSync(testCmd, {stdio: flags.json ? 'pipe' : 'inherit'})

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

      if (!flags.json) {
        this.log('')
        this.log(`All tests passed in ${elapsed}s`)
      }
    } catch {
      if (flags.json) {
        this.log(JSON.stringify({passed: false, error: 'Test execution failed'}))
      }

      this.error('Tests failed')
    }
  }

  private resolveTestCommand(filter?: string): string {
    let cmd: string
    try {
      execSync('which dpm', {stdio: 'ignore'})
      cmd = 'dpm test'
    } catch {
      try {
        execSync('which daml', {stdio: 'ignore'})
        cmd = 'daml test'
      } catch {
        this.error('Neither dpm nor daml found. Install the Daml SDK.')
      }
    }

    if (filter) {
      cmd += ` --test-pattern "${filter}"`
    }

    return cmd
  }
}
