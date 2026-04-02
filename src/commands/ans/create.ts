import {Flags} from '@oclif/core'

import {StableSurfaceCommand} from '../stable-surface-command.js'

export default class AnsCreate extends StableSurfaceCommand {
  static override description = 'Create an ANS entry through the stable external ANS surface'

  static override examples = [
    '<%= config.bin %> ans create --profile splice-devnet --name alice.unverified.ans --url https://alice.example.com --description "Alice profile" --token eyJ...',
    '<%= config.bin %> ans create --ans-url https://ans.example.com --name alice.unverified.ans --url https://alice.example.com --description "Alice profile" --token eyJ... --json',
  ]

  static override flags = {
    'ans-url': Flags.string({
      description: 'Explicit ANS base URL override',
    }),
    description: Flags.string({
      description: 'Human-readable description for the entry',
      required: true,
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    name: Flags.string({
      description: 'ANS entry name to create',
      required: true,
    }),
    profile: Flags.string({
      description: 'Resolved runtime profile that exposes ans',
    }),
    token: Flags.string({
      description: 'JWT bearer token for the ANS request',
    }),
    url: Flags.string({
      default: '',
      description: 'Optional URL for the ANS entry',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AnsCreate)
    const out = this.outputFor(flags.json)

    try {
      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['ans-url'],
        profileName: flags.profile,
      })
      const result = await this.createStableSplice().createAnsEntry({
        ansBaseUrl: flags['ans-url'],
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
      out.log(`Subscription request: ${String(result.response.subscriptionRequestCid ?? '-')}`)
      out.log(`Entry context: ${String(result.response.entryContextCid ?? '-')}`)
      for (const warning of result.warnings) {
        out.warn(warning)
      }
    } catch (error) {
      this.handleCommandError(error, out)
    }
  }
}
