export interface FactoryDeps {
  read: (name: string) => Promise<boolean>
  write: (name: string) => Promise<void>
}

export function createCollector(deps: FactoryDeps): {
  collect(names: string[]): Promise<string[]>
} {
  const {read, write} = deps

  return {
    async collect(names: string[]): Promise<string[]> {
      const existing: string[] = []

      for (const name of names) {
        if (await read(name)) {
          existing.push(name)
        }
      }

      if (existing.length === 0) {
        return existing
      }

      for (const name of existing) {
        await write(name)
      }

      return existing
    },
  }
}
