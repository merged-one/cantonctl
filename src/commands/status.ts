import {Command, Flags} from '@oclif/core'

export default class Status extends Command {
  static override description = 'Show node health, deployed packages, and active parties'

  static override examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    network: Flags.string({
      char: 'n',
      default: 'local',
      description: 'Network to query',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Status)

    if (flags.json) {
      // TODO: Structured JSON output for CI
      this.log(JSON.stringify({network: flags.network, status: 'not connected'}))
      return
    }

    this.log(`Network: ${flags.network}`)
    this.log('')

    // TODO: Query Canton node for actual status
    this.log('Node Status')
    this.log('  Health:     (not connected)')
    this.log('  Port:       5001')
    this.log('  JSON API:   7575')
    this.log('')
    this.log('Parties')
    this.log('  (no parties provisioned)')
    this.log('')
    this.log('Packages')
    this.log('  (no packages deployed)')
  }
}
