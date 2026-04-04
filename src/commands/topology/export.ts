import * as fs from 'node:fs'
import * as path from 'node:path'

import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'
import {generateTopology, serializeTopologyManifest} from '../../lib/topology.js'

const DEFAULT_CANTON_IMAGE = 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3'

export default class TopologyExport extends Command {
  static override description = 'Export the resolved local Canton net topology files without starting Docker'

  static override examples = [
    '<%= config.bin %> topology export',
    '<%= config.bin %> topology export --topology demo --out-dir .cantonctl/export/demo',
    '<%= config.bin %> topology export --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output export summary as JSON',
    }),
    'out-dir': Flags.string({
      description: 'Output directory for exported topology files',
    }),
    topology: Flags.string({
      description: 'Named topology from topologies: in cantonctl.yaml',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(TopologyExport)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()
      const topology = generateTopology({
        cantonImage: DEFAULT_CANTON_IMAGE,
        config,
        topologyName: flags.topology,
      })
      const metadata = topology.manifest!.metadata
      const outDir = path.resolve(
        flags['out-dir'] ?? path.join(process.cwd(), '.cantonctl', 'export', metadata.topologyName),
      )

      await fs.promises.mkdir(outDir, {recursive: true})
      await Promise.all([
        fs.promises.writeFile(path.join(outDir, 'docker-compose.yml'), topology.dockerCompose, 'utf8'),
        fs.promises.writeFile(path.join(outDir, 'canton.conf'), topology.cantonConf, 'utf8'),
        fs.promises.writeFile(path.join(outDir, 'bootstrap.canton'), topology.bootstrapScript, 'utf8'),
        fs.promises.writeFile(path.join(outDir, 'topology.json'), serializeTopologyManifest(topology), 'utf8'),
      ])

      const data = {
        files: [
          path.join(outDir, 'docker-compose.yml'),
          path.join(outDir, 'canton.conf'),
          path.join(outDir, 'bootstrap.canton'),
          path.join(outDir, 'topology.json'),
        ],
        outDir,
        topology: metadata.topologyName,
      }

      if (flags.json) {
        out.result({data, success: true})
        return
      }

      out.success(`Exported topology "${data.topology}" to ${outDir}`)
      out.table(['File'], data.files.map(file => [file]))
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
