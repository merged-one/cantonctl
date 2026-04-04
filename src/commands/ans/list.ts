import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

export default class AnsList extends StableSurfaceCommand {
  static override description = 'List ANS entries through stable ANS, Scan, or scan-proxy surfaces'

  static override examples = [
    '<%= config.bin %> ans list --profile splice-devnet --token eyJ...',
    '<%= config.bin %> ans list --scan-proxy-url https://validator.example.com/api/validator --name-prefix alice --json',
  ]

  static override flags = {
    'ans-url': Flags.string({
      description: 'Explicit ANS base URL override',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    name: Flags.string({
      description: 'Look up a single ANS name exactly',
    }),
    'name-prefix': Flags.string({
      description: 'Prefix filter for public ANS listing',
    }),
    'page-size': Flags.integer({
      default: 20,
      description: 'Maximum number of public ANS entries to return',
    }),
    party: Flags.string({
      description: 'Look up the first public ANS entry owned by a party',
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes ans, scan, or scanProxy',
    }),
    'scan-proxy-url': Flags.string({
      description: 'Explicit scan-proxy base URL override',
    }),
    'scan-url': Flags.string({
      description: 'Explicit scan base URL override',
    }),
    source: Flags.string({
      default: 'auto',
      description: 'Preferred ANS source',
      options: ['ans', 'auto', 'scan', 'scanProxy'],
    }),
    token: Flags.string({
      description: 'JWT bearer token for the owned-entry ANS service',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AnsList)
    const out = this.outputFor(flags.json)

    try {
      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['ans-url'] && !flags['scan-url'] && !flags['scan-proxy-url'],
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().listAnsEntries({
        ansBaseUrl: flags['ans-url'],
        name: flags.name,
        namePrefix: flags['name-prefix'],
        pageSize: flags['page-size'],
        party: flags.party,
        profile,
        scanBaseUrl: flags['scan-url'],
        scanProxyBaseUrl: flags['scan-proxy-url'],
        source: flags.source as 'ans' | 'auto' | 'scan' | 'scanProxy',
        token: flags.token,
      })

      if (flags.json) {
        out.result({data: result, success: true, warnings: [...result.warnings]})
        return
      }

      out.log(`Source: ${result.source}`)
      out.table(
        ['Name', 'Owner', 'URL', 'Contract'],
        result.entries.map(entry => [
          String(entry.name ?? '-'),
          String(entry.user ?? '-'),
          String(entry.url ?? '-'),
          String(entry.contractId ?? '-'),
        ]),
      )
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
