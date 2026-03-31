import {Command, Flags} from '@oclif/core'
import {loadConfig} from '../lib/config.js'

export default class Dev extends Command {
  static override description = 'Start a local Canton development environment with hot-reload'

  static override examples = [
    '<%= config.bin %> dev',
    '<%= config.bin %> dev --full',
    '<%= config.bin %> dev --port 5001',
  ]

  static override flags = {
    background: Flags.boolean({
      char: 'b',
      default: false,
      description: 'Run in background',
    }),
    full: Flags.boolean({
      default: false,
      description: 'Start full multi-node topology (requires Docker)',
    }),
    port: Flags.integer({
      char: 'p',
      default: 5001,
      description: 'Canton node port',
    }),
    'json-api-port': Flags.integer({
      default: 7575,
      description: 'JSON Ledger API port',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Dev)
    const config = await loadConfig()

    if (flags.full) {
      this.log('Starting full Canton topology (Docker)...')
      // TODO: Orchestrate multi-node Docker Compose setup
      // This wraps cn-quickstart-style infrastructure
      this.warn('Full mode not yet implemented. Use --no-full for sandbox mode.')
      return
    }

    this.log('Starting Canton sandbox...')
    this.log('')

    // TODO: Start dpm sandbox subprocess
    // TODO: Auto-provision parties from cantonctl.yaml
    // TODO: Start file watcher for hot-reload
    // TODO: Start JSON Ledger API

    const parties = config.parties?.map((p: {name: string}) => p.name).join(', ') ?? 'none'

    this.log(`  Canton node:  localhost:${flags.port}`)
    this.log(`  JSON API:     localhost:${flags['json-api-port']}`)
    this.log(`  Parties:      ${parties}`)
    this.log(`  Watching:     daml/ for changes`)
    this.log('')
    this.log('Press [q] to quit')
  }
}
