import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'
import {generateTopology} from '../../lib/topology.js'

const DEFAULT_CANTON_IMAGE = 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3'

export default class TopologyShow extends Command {
  static override description = 'Show the resolved local Canton net topology without starting Docker'

  static override examples = [
    '<%= config.bin %> topology show',
    '<%= config.bin %> topology show --topology demo',
    '<%= config.bin %> topology show --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output topology as JSON',
    }),
    topology: Flags.string({
      description: 'Named topology from topologies: in cantonctl.yaml',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(TopologyShow)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()
      const topology = generateTopology({
        cantonImage: DEFAULT_CANTON_IMAGE,
        config,
        topologyName: flags.topology,
      })
      const metadata = topology.manifest!.metadata

      if (flags.json) {
        out.result({
          data: {
            metadata,
            participants: topology.participants,
            synchronizer: topology.synchronizer,
          },
          success: true,
        })
        return
      }

      out.log('')
      out.log(`Topology: ${metadata.topologyName} (${metadata.selectedBy})`)
      out.log(`Mode: ${metadata.mode}`)
      out.log(`Base port: ${metadata['base-port']}`)
      out.log(`Image: ${metadata['canton-image']}`)
      out.log('')
      out.table(
        ['Participant', 'JSON API', 'Parties'],
        topology.participants.map(participant => [
          participant.name,
          String(participant.ports.jsonApi),
          participant.parties.length > 0 ? participant.parties.join(', ') : '(none)',
        ]),
      )
      out.log('')
      out.table(
        ['Synchronizer', 'Endpoint'],
        [
          ['Public API', String(topology.synchronizer.publicApi)],
          ['Admin API', String(topology.synchronizer.admin)],
        ],
      )
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

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}
