import {Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {listProfiles} from '../../lib/compat.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'

export default class ProfilesList extends Command {
  static override description = 'List resolved runtime profiles'

  static override examples = [
    '<%= config.bin %> profiles list',
    '<%= config.bin %> profiles list --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProfilesList)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()
      const profiles = listProfiles(config)

      if (!flags.json) {
        if (profiles.length === 0) {
          out.info('No profiles resolved from cantonctl.yaml')
        } else {
          out.table(
            ['Name', 'Kind', 'Default', 'Services'],
            profiles.map(profile => [
              profile.name,
              profile.kind,
              profile.isDefault ? 'yes' : 'no',
              profile.services.join(', ') || '-',
            ]),
          )
          out.success(`Resolved ${profiles.length} ${profiles.length === 1 ? 'profile' : 'profiles'}`)
        }
      }

      if (flags.json) {
        out.result({
          data: {
            defaultProfile: config['default-profile'],
            profiles,
          },
          success: true,
        })
      }
    } catch (err) {
      if (err instanceof CantonctlError) {
        out.result({
          error: {code: err.code, message: err.message, suggestion: err.suggestion},
          success: false,
        })
        this.exit(1)
      }

      throw err
    }
  }

  protected async loadProjectConfig(): Promise<CantonctlConfig> {
    return loadConfig()
  }
}
