import {Args, Command, Flags} from '@oclif/core'

import {type CantonctlConfig, loadConfig} from '../../lib/config.js'
import {listProfiles, resolveProfile} from '../../lib/compat.js'
import {CantonctlError} from '../../lib/errors.js'
import {createOutput} from '../../lib/output.js'

export default class ProfilesValidate extends Command {
  static override args = {
    name: Args.string({
      description: 'Optional profile name',
      required: false,
    }),
  }

  static override description = 'Validate resolved runtime profiles'

  static override examples = [
    '<%= config.bin %> profiles validate',
    '<%= config.bin %> profiles validate sandbox --json',
  ]

  static override flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ProfilesValidate)
    const out = createOutput({json: flags.json})

    try {
      const config = await this.loadProjectConfig()
      const profiles = args.name
        ? [resolveProfile(config, args.name).profile]
        : listProfiles(config).map(entry => resolveProfile(config, entry.name).profile)

      if (!flags.json) {
        out.success(`Validated ${profiles.length} ${profiles.length === 1 ? 'profile' : 'profiles'}`)
      }

      out.result({
        data: flags.json ? {
          profileCount: profiles.length,
          profiles: profiles.map(profile => ({
            experimental: profile.experimental,
            kind: profile.kind,
            name: profile.name,
            services: Object.entries(profile.services)
              .filter(([, value]) => value !== undefined)
              .map(([name]) => name),
            valid: true,
          })),
        } : undefined,
        success: true,
      })
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
