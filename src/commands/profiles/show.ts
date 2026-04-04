import {Args, Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {resolveProfile, summarizeProfileServices} from '../../lib/compat.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'

export default class ProfilesShow extends Command {
  static override args = {
    name: Args.string({
      description: 'Profile name',
      required: true,
    }),
  }

  static override description = 'Show a resolved runtime profile'

  static override examples = [
    '<%= config.bin %> profiles show sandbox',
    '<%= config.bin %> profiles show splice-devnet --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ProfilesShow)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()
      const {profile, source} = resolveProfile(config, args.name)
      const services = summarizeProfileServices(profile)

      if (!flags.json) {
        out.log(`Profile: ${profile.name}`)
        out.log(`Kind: ${profile.kind}`)
        out.log(`Resolved from: ${source}`)
        out.log(`Experimental: ${profile.experimental ? 'yes' : 'no'}`)
        out.log('')
        out.table(
          ['Service', 'Endpoint', 'Stability'],
          services.map(service => [
            service.name,
            service.endpoint ?? '-',
            service.stability,
          ]),
        )
      }

      if (flags.json) {
        out.result({
          data: {
            profile: {
              experimental: profile.experimental,
              kind: profile.kind,
              name: profile.name,
            },
            resolvedFrom: source,
            services,
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
