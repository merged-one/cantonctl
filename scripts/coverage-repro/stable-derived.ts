import {Flags} from '@oclif/core'

import type {NormalizedProfile} from '../../src/lib/config.js'
import type {StableSplice} from '../../src/lib/splice-public.js'
import {StableSurfaceCommand} from '../../src/commands/stable-surface-command.js'

export class StableDerivedCommand extends StableSurfaceCommand {
  static examples = [
    'stable-derived --name alice --description desc --json',
  ]

  static flags = {
    description: Flags.string({required: true}),
    json: Flags.boolean({default: false}),
    name: Flags.string({required: true}),
    profile: Flags.string(),
    token: Flags.string(),
    url: Flags.string({default: ''}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(StableDerivedCommand)
    const out = this.outputFor(flags.json)

    try {
      const profile = await this.maybeLoadProfileContext({
        needsProfile: true,
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().createAnsEntry({
        description: flags.description,
        name: flags.name,
        profile,
        token: flags.token,
        url: flags.url,
      })

      if (flags.json) {
        out.result({data: result, success: true, warnings: [...result.warnings]})
        return
      }

      out.log(`Entry: ${String(result.response.name ?? flags.name)}`)
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }

  protected override createStableSplice(): StableSplice {
    return {
      createAnsEntry: async () => ({
        endpoint: 'https://ans.example.com',
        response: {
          name: 'default',
        },
        source: 'ans',
        warnings: [],
      }),
    } as unknown as StableSplice
  }

  protected override async maybeLoadProfileContext(
    options: {needsProfile: boolean; profileName?: string},
  ): Promise<NormalizedProfile | undefined> {
    return super.maybeLoadProfileContext(options)
  }
}
