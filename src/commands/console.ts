import {Command, Flags} from '@oclif/core'

export default class Console extends Command {
  static override description = 'Interactive REPL connected to a Canton node'

  static override examples = [
    '<%= config.bin %> console',
    '<%= config.bin %> console --network devnet',
  ]

  static override flags = {
    network: Flags.string({
      char: 'n',
      default: 'local',
      description: 'Network to connect to',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Console)

    this.log(`Connecting to ${flags.network}...`)
    this.log('')
    this.log('Canton Console (cantonctl)')
    this.log('Type "help" for commands, "exit" to quit')
    this.log('')

    // TODO: Implement REPL using Node.js readline
    // Built-in commands:
    //   parties          - List provisioned parties
    //   submit <party> <cmd>  - Submit a command
    //   query <template> [--party <party>] - Query contracts
    //   status           - Show node status
    //   help             - Show available commands
    //   exit             - Exit console

    this.log('canton> (REPL not yet implemented)')
  }
}
