import * as fs from 'node:fs'
import * as path from 'node:path'

import {Command, Flags} from '@oclif/core'

import {CantonctlError, ErrorCode} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'
import {createNetworkDiscoveryFetcher, type NetworkDiscoveryFetcher} from '../../lib/discovery/fetch.js'
import {
  mergeProfileIntoConfigYaml,
  synthesizeProfileFromDiscovery,
} from '../../lib/discovery/synthesize.js'

export default class ProfilesImportScan extends Command {
  static override description = 'Synthesize a profile from stable/public scan discovery data'

  static override examples = [
    '<%= config.bin %> profiles import-scan --scan-url https://scan.example.com --kind remote-sv-network',
    '<%= config.bin %> profiles import-scan --scan-url https://scan.example.com --kind remote-validator --write --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    kind: Flags.string({
      description: 'Profile kind to synthesize',
      options: ['remote-sv-network', 'remote-validator'],
      required: true,
    }),
    name: Flags.string({
      description: 'Profile name override',
    }),
    'scan-url': Flags.string({
      description: 'Scan base URL',
      required: true,
    }),
    write: Flags.boolean({
      default: false,
      description: 'Write the synthesized profile into cantonctl.yaml',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProfilesImportScan)
    const out = createOutput({json: flags.json})

    try {
      const discovery = await this.createFetcher().fetch({scanUrl: flags['scan-url']})
      const synthesized = synthesizeProfileFromDiscovery({
        discovery,
        kind: flags.kind as 'remote-sv-network' | 'remote-validator',
        name: flags.name,
      })

      let configPath: string | undefined
      if (flags.write) {
        configPath = path.join(process.cwd(), 'cantonctl.yaml')
        if (!fs.existsSync(configPath)) {
          throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
            suggestion: 'Run this command from a cantonctl project root with an existing cantonctl.yaml file.',
          })
        }
        const merged = mergeProfileIntoConfigYaml({
          existingConfigYaml: fs.readFileSync(configPath, 'utf8'),
          synthesized,
        })
        fs.writeFileSync(configPath, merged, 'utf8')
      }

      if (!flags.json) {
        out.log(synthesized.yaml)
        if (flags.write && configPath) {
          out.success(`Wrote ${synthesized.name} to ${configPath}`)
        }
      }

      out.result({
        data: flags.json ? {
          configPath,
          profile: synthesized.profile,
          profileName: synthesized.name,
          warnings: synthesized.warnings,
          write: flags.write,
          yaml: synthesized.yaml,
        } : undefined,
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

