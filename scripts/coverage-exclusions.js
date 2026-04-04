import * as fs from 'node:fs'
import * as path from 'node:path'

const CODE_FILE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const INLINE_V8_IGNORE_PATTERN = /^\s*(?:\/\/|\/\*+|\*)\s*v8 ignore (next|if|else|start|stop)\b/

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRegistrySection(entries, sectionName, errors, options = {}) {
  if (!isObject(entries)) {
    errors.push(`Registry section "${sectionName}" must be a JSON object.`)
    return {}
  }

  const normalized = {}
  for (const [key, value] of Object.entries(entries)) {
    if (!isObject(value)) {
      errors.push(`Registry entry "${sectionName}.${key}" must be an object.`)
      continue
    }

    if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
      errors.push(`Registry entry "${sectionName}.${key}" must include a non-empty reason.`)
      continue
    }

    if (options.requireDirective) {
      if (typeof value.directive !== 'string' || value.directive.trim().length === 0) {
        errors.push(`Registry entry "${sectionName}.${key}" must include a directive.`)
        continue
      }

      normalized[key] = {directive: value.directive.trim(), reason: value.reason.trim()}
      continue
    }

    normalized[key] = {reason: value.reason.trim()}
  }

  return normalized
}

export function parseExclusionsRegistry(markdown) {
  const errors = []
  const matches = [...markdown.matchAll(/```json\s*([\s\S]*?)```/g)]

  if (matches.length !== 1) {
    return {
      errors: ['EXCLUSIONS.md must contain exactly one fenced JSON registry.'],
      registry: undefined,
    }
  }

  let parsed
  try {
    parsed = JSON.parse(matches[0][1])
  } catch (error) {
    return {
      errors: [`Failed to parse EXCLUSIONS.md JSON registry: ${error instanceof Error ? error.message : String(error)}`],
      registry: undefined,
    }
  }

  if (!isObject(parsed)) {
    return {
      errors: ['EXCLUSIONS.md JSON registry must be a JSON object.'],
      registry: undefined,
    }
  }

  const registry = {
    coverageExclude: normalizeRegistrySection(parsed.coverageExclude, 'coverageExclude', errors),
    inlineV8Ignore: normalizeRegistrySection(parsed.inlineV8Ignore, 'inlineV8Ignore', errors, {requireDirective: true}),
  }

  return {errors, registry: errors.length === 0 ? registry : undefined}
}

function collectFiles(targetPath, files) {
  if (!fs.existsSync(targetPath)) {
    return
  }

  const stat = fs.statSync(targetPath)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath, {withFileTypes: true})) {
      collectFiles(path.join(targetPath, entry.name), files)
    }
    return
  }

  if (CODE_FILE_EXTENSIONS.has(path.extname(targetPath))) {
    files.add(targetPath)
  }
}

export function findInlineV8Ignores(options) {
  const cwd = path.resolve(options.cwd)
  const roots = options.roots ?? []
  const files = new Set()

  for (const root of roots) {
    collectFiles(path.resolve(cwd, root), files)
  }

  const ignores = []
  for (const filePath of [...files].sort()) {
    const relativePath = path.relative(cwd, filePath).split(path.sep).join(path.posix.sep)
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)

    for (const [index, line] of lines.entries()) {
      const match = line.match(INLINE_V8_IGNORE_PATTERN)
      if (!match) {
        continue
      }

      ignores.push({
        directive: `v8 ignore ${match[1]}`,
        id: `${relativePath}:${index + 1}`,
      })
    }
  }

  return ignores
}

export function verifyCoverageExclusions({excludePatterns, inlineIgnores, registry}) {
  const failures = []

  const actualExcludePatterns = [...new Set(excludePatterns)].sort()
  const documentedExcludePatterns = Object.keys(registry.coverageExclude).sort()

  for (const pattern of actualExcludePatterns) {
    if (!(pattern in registry.coverageExclude)) {
      failures.push(`Undocumented coverage.exclude entry: ${pattern}`)
    }
  }

  for (const pattern of documentedExcludePatterns) {
    if (!actualExcludePatterns.includes(pattern)) {
      failures.push(`Stale coverage.exclude registry entry: ${pattern}`)
    }
  }

  const actualInlineIgnores = new Map(
    [...inlineIgnores]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(ignore => [ignore.id, ignore.directive]),
  )
  const documentedInlineIgnores = Object.keys(registry.inlineV8Ignore).sort()

  for (const [id, directive] of actualInlineIgnores) {
    if (!(id in registry.inlineV8Ignore)) {
      failures.push(`Undocumented inline v8 ignore: ${id} (${directive})`)
      continue
    }

    if (registry.inlineV8Ignore[id].directive !== directive) {
      failures.push(
        `Inline v8 ignore directive mismatch for ${id}: expected ${directive}, found ${registry.inlineV8Ignore[id].directive}`,
      )
    }
  }

  for (const id of documentedInlineIgnores) {
    if (!actualInlineIgnores.has(id)) {
      failures.push(`Stale inline v8 ignore registry entry: ${id}`)
    }
  }

  return failures
}
