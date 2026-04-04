import {Command, Flags} from '@oclif/core'

import {createNetworkDiscoveryFetcher, type NetworkDiscoveryFetcher} from '../../lib/discovery/fetch.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'

export default class DiscoverNetwork extends Command {
  static override description = 'Discover stable/public network metadata from a scan endpoint'

  static override examples = [
    '<%= config.bin %> discover network --scan-url https://scan.example.com',
    '<%= config.bin %> discover network --scan-url https://scan.example.com --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    'scan-url': Flags.string({
      description: 'Scan base URL',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DiscoverNetwork)
    const out = createOutput({json: flags.json})

    try {
      const snapshot = await this.createFetcher().fetch({scanUrl: flags['scan-url']})

      if (!flags.json) {
        out.log(`Scan: ${snapshot.scanUrl}`)
        out.log(`Connected scans: ${snapshot.scans.length}`)
        out.log(`Sequencer groups: ${snapshot.sequencers.length}`)
      }

      out.result({
        data: flags.json ? snapshot : undefined,
        success: true,
      })
    } catch (error) {
      if (error instanceof CantonctlError) {
        out.result({
          error: {code: error.code, message: error.message, suggestion: error.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw error
    }
  }

  protected createFetcher(): NetworkDiscoveryFetcher {
    return createNetworkDiscoveryFetcher()
  }
}

