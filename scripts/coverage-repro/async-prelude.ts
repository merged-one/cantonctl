export interface ReproOutput {
  result: (value: unknown) => void
  warn: (message: string) => void
}

export class AsyncPreludeCommand {
  protected async doWork(): Promise<{warnings: string[]}> {
    return {warnings: []}
  }

  protected handleFailure(error: unknown, _out: ReproOutput): never {
    throw error
  }

  protected outputFor(_json: boolean): ReproOutput {
    return {
      result: () => undefined,
      warn: () => undefined,
    }
  }

  protected async parse(): Promise<{flags: {json: boolean}}> {
    return {flags: {json: false}}
  }

  async run(): Promise<void> {
    const {flags} = await this.parse()
    const out = this.outputFor(flags.json)

    try {
      const result = await this.doWork()
      out.result({success: true, warnings: [...result.warnings]})
    } catch (error) {
      this.handleFailure(error, out)
    }
  }
}
