import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {afterEach, describe, expect, it} from 'vitest'

import {
  findInlineV8Ignores,
  parseExclusionsRegistry,
  verifyCoverageExclusions,
} from '../../scripts/coverage-exclusions.js'

const tempDirs: string[] = []

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-coverage-'))
  tempDirs.push(tempDir)
  return tempDir
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, {force: true, recursive: true})
  }
})

describe('coverage exclusion registry', () => {
  it('parses a fenced JSON registry and matches documented exclusions exactly', () => {
    const parsed = parseExclusionsRegistry(`
# Coverage Exclusions

\`\`\`json
{
  "coverageExclude": {
    "src/generated/**": {"reason": "Generated clients are validated by smoke tests and regeneration checks."}
  },
  "inlineV8Ignore": {
    "src/lib/example.ts:2": {
      "directive": "v8 ignore next",
      "reason": "TTY-only branch is not reachable under captureOutput."
    }
  }
}
\`\`\`
`)

    expect(parsed.errors).toEqual([])
    expect(parsed.registry).toBeDefined()

    const failures = verifyCoverageExclusions({
      excludePatterns: ['src/generated/**'],
      inlineIgnores: [{directive: 'v8 ignore next', id: 'src/lib/example.ts:2'}],
      registry: parsed.registry!,
    })

    expect(failures).toEqual([])
  })

  it('reports undocumented and stale exclusion entries', () => {
    const parsed = parseExclusionsRegistry(`
# Coverage Exclusions

\`\`\`json
{
  "coverageExclude": {
    "src/generated/**": {"reason": "Generated clients are validated by smoke tests and regeneration checks."},
    "src/old/**": {"reason": "Stale entry."}
  },
  "inlineV8Ignore": {
    "src/lib/example.ts:99": {
      "directive": "v8 ignore next",
      "reason": "Stale entry."
    }
  }
}
\`\`\`
`)

    expect(parsed.errors).toEqual([])

    const failures = verifyCoverageExclusions({
      excludePatterns: ['src/generated/**', 'src/lib/adapters/index.ts'],
      inlineIgnores: [{directive: 'v8 ignore next', id: 'src/lib/example.ts:2'}],
      registry: parsed.registry!,
    })

    expect(failures).toContain('Undocumented coverage.exclude entry: src/lib/adapters/index.ts')
    expect(failures).toContain('Stale coverage.exclude registry entry: src/old/**')
    expect(failures).toContain('Undocumented inline v8 ignore: src/lib/example.ts:2 (v8 ignore next)')
    expect(failures).toContain('Stale inline v8 ignore registry entry: src/lib/example.ts:99')
  })

  it('scans inline v8 ignore comments using relative file ids', () => {
    const tempDir = createTempDir()
    const sourceDir = path.join(tempDir, 'src', 'lib')
    fs.mkdirSync(sourceDir, {recursive: true})
    fs.writeFileSync(
      path.join(sourceDir, 'example.ts'),
      [
        'export function chooseBranch(flag: boolean) {',
        '  // v8 ignore next -- covered only in interactive TTY mode',
        '  if (flag) return 1',
        '  return 0',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )

    expect(findInlineV8Ignores({cwd: tempDir, roots: ['src']})).toEqual([
      {directive: 'v8 ignore next', id: 'src/lib/example.ts:2'},
    ])
  })
})
