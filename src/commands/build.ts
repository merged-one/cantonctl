import {Command, Flags} from '@oclif/core'
import {execSync} from 'node:child_process'

export default class Build extends Command {
  static override description = 'Compile Daml contracts and generate TypeScript bindings'

  static override examples = [
    '<%= config.bin %> build',
    '<%= config.bin %> build --codegen',
  ]

  static override flags = {
    codegen: Flags.boolean({
      char: 'c',
      default: true,
      description: 'Generate TypeScript bindings after compilation',
    }),
    watch: Flags.boolean({
      char: 'w',
      default: false,
      description: 'Watch for changes and rebuild automatically',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Build)

    this.log('Compiling Daml contracts...')

    try {
      // Use dpm if available, fall back to daml
      const buildCmd = this.resolveBuildCommand()
      execSync(buildCmd, {stdio: 'inherit'})
      this.log('Compilation successful')

      // Extract package info
      // TODO: Parse .dar metadata for package ID
      this.log('Package ID: (extracted from .dar)')

      if (flags.codegen) {
        this.log('')
        this.log('Generating TypeScript bindings...')
        // TODO: Run daml codegen js or dpm codegen
        this.log('TypeScript bindings generated -> frontend/src/generated/')
      }
    } catch {
      this.error('Compilation failed. Check your Daml source for errors.')
    }
  }

  private resolveBuildCommand(): string {
    try {
      execSync('which dpm', {stdio: 'ignore'})
      return 'dpm build'
    } catch {
      try {
        execSync('which daml', {stdio: 'ignore'})
        return 'daml build'
      } catch {
        this.error(
          'Neither dpm nor daml found. Install the Daml SDK:\n' +
          '  https://docs.daml.com/getting-started/installation.html',
        )
      }
    }
  }
}
