export interface CoverageExcludeRegistryEntry {
  reason: string
}

export interface InlineV8IgnoreRegistryEntry {
  directive: string
  reason: string
}

export interface ExclusionsRegistry {
  coverageExclude: Record<string, CoverageExcludeRegistryEntry>
  inlineV8Ignore: Record<string, InlineV8IgnoreRegistryEntry>
}

export interface ParseExclusionsRegistryResult {
  errors: string[]
  registry?: ExclusionsRegistry
}

export interface InlineV8IgnoreMatch {
  directive: string
  id: string
}

export function parseExclusionsRegistry(markdown: string): ParseExclusionsRegistryResult
export function findInlineV8Ignores(options: {cwd: string; roots?: string[]}): InlineV8IgnoreMatch[]
export function verifyCoverageExclusions(options: {
  excludePatterns: string[]
  inlineIgnores: InlineV8IgnoreMatch[]
  registry: ExclusionsRegistry
}): string[]
