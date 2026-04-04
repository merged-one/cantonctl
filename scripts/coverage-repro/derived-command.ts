export interface DerivedOutput {
  log: (message: string) => void
  result: (value: unknown) => void
  warn: (message: string) => void
}

export interface DerivedProfile {
  name: string
}

export interface DerivedResult {
  response: {
    entryContextCid?: string
    name?: string
    subscriptionRequestCid?: string
  }
  warnings: string[]
}

export interface DerivedService {
  createEntry(input: {
    baseUrl?: string
    description: string
    name: string
    profile?: DerivedProfile
    token?: string
    url: string
  }): Promise<DerivedResult>
}

interface DerivedFlags {
  'base-url'?: string
  description: string
  json: boolean
  name: string
  profile?: string
  token?: string
  url: string
}

export class DerivedBase {
  protected createService(): DerivedService {
    return {
      createEntry: async () => ({
        response: {},
        warnings: [],
      }),
    }
  }

  protected handleCommandError(error: unknown, _out: DerivedOutput): never {
    throw error
  }

  protected async maybeLoadProfileContext(_options: {needsProfile: boolean; profileName?: string}): Promise<DerivedProfile | undefined> {
    return {name: 'default'}
  }

  protected outputFor(_json: boolean): DerivedOutput {
    return {
      log: () => undefined,
      result: () => undefined,
      warn: () => undefined,
    }
  }

  protected async parse(_self: unknown): Promise<{flags: DerivedFlags}> {
    return {
      flags: {
        description: 'default description',
        json: false,
        name: 'default-name',
        url: '',
      },
    }
  }
}

export class DerivedCommand extends DerivedBase {
  static examples = ['derived command --json']

  static flags = {
    json: {default: false},
    name: {required: true},
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(DerivedCommand)
    const out = this.outputFor(flags.json)

    try {
      const profile = await this.maybeLoadProfileContext({
        needsProfile: !flags['base-url'],
        profileName: flags.profile,
      })
      const result = await this.createService().createEntry({
        baseUrl: flags['base-url'],
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
