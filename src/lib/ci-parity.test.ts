import * as fs from 'node:fs'
import * as path from 'node:path'

import {describe, expect, it} from 'vitest'

import {
  CI_MODES,
  CI_SUITES,
  COVERAGE_POLICY,
  VITEST_PROJECTS,
  getRequiredSuitesForScope,
  getSuitesForScope,
} from '../../scripts/ci/manifest.js'

function listE2eFiles(): string[] {
  const root = path.resolve(process.cwd(), 'test', 'e2e')
  return fs.readdirSync(root)
    .filter(name => name.endsWith('.e2e.test.ts'))
    .map(name => path.posix.join('test/e2e', name))
    .sort()
}

function readText(filePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8')
}

describe('CI parity manifest', () => {
  it('assigns every E2E file to exactly one vitest project', () => {
    const actualFiles = listE2eFiles()
    const assignments = actualFiles.map((filePath) => {
      const owners = Object.values(VITEST_PROJECTS)
        .filter(project => project.name !== 'unit' && project.include.includes(filePath))
        .map(project => project.name)

      return {filePath, owners}
    })

    expect(assignments).toEqual(
      actualFiles.map(filePath => ({filePath, owners: [expect.any(String)]})),
    )
    for (const assignment of assignments) {
      expect(assignment.owners, `${assignment.filePath} owners`).toHaveLength(1)
    }
  })

  it('defines a deterministic required gate with playground and docker included', () => {
    expect(CI_MODES.required).toEqual([
      'generated-specs',
      'e2e-sdk',
      'e2e-stable-public',
      'e2e-sandbox',
      'e2e-playground',
      'e2e-docker',
    ])
    expect(CI_MODES.all).toContain('e2e-experimental')
  })

  it('maps suites into PR, main, and release scopes', () => {
    expect(getRequiredSuitesForScope('pr').map(suite => suite.id)).toEqual(CI_MODES.required)
    expect(getRequiredSuitesForScope('release').map(suite => suite.id)).toEqual(CI_MODES.required)
    expect(getSuitesForScope('main').map(suite => suite.id)).toEqual([
      'unit',
      ...CI_MODES.required,
      'e2e-experimental',
    ])
  })

  it('keeps package scripts aligned with the manifest-driven runner', () => {
    const packageJson = JSON.parse(readText('package.json')) as {scripts: Record<string, string>}

    expect(packageJson.scripts.ci).toBe('node scripts/ci/run.js docker required')
    expect(packageJson.scripts['ci:all']).toBe('node scripts/ci/run.js docker all')
    expect(packageJson.scripts['ci:native']).toBe('node scripts/ci/run.js native required')
    expect(packageJson.scripts['test:coverage']).toBe(
      'node scripts/verify-coverage-exclusions.mjs && vitest run --project unit --coverage',
    )
    expect(packageJson.scripts['test:coverage:strict']).toBe(
      'node scripts/verify-coverage-exclusions.mjs && COVERAGE_STRICT=1 vitest run --project unit --coverage',
    )
    expect(packageJson.scripts['test:e2e']).toBe(
      'vitest run --project e2e-sdk --project e2e-stable-public --project e2e-sandbox --project e2e-playground --project e2e-docker',
    )

    for (const suite of Object.values(CI_SUITES)) {
      expect(packageJson.scripts[suite.npmScript]).toBeDefined()
    }
  })

  it('keeps GitHub workflows wired to the shared manifest and runner', () => {
    const ciWorkflow = readText('.github/workflows/ci.yml')
    const releaseWorkflow = readText('.github/workflows/release.yml')

    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      expect(workflow).toContain('node scripts/ci/github-manifest.js')
      expect(workflow).toContain('node scripts/ci/run.js suite ${{ matrix.suite.id }}')
      expect(workflow).toContain('unit-node-versions')
    }

    expect(ciWorkflow).toContain('pr-suites')
    expect(ciWorkflow).toContain('main-extra-suites')
    expect(releaseWorkflow).toContain('release-suites')
  })

  it('tracks narrow coverage exclusions and strict-report settings in the shared manifest', () => {
    expect(COVERAGE_POLICY.include).toEqual(['src/**/*.ts'])
    expect(COVERAGE_POLICY.exclude).toEqual([
      'src/**/*.test.ts',
      'src/**/*.d.ts',
      'src/generated/**',
      'src/lib/adapters/index.ts',
    ])
    expect(COVERAGE_POLICY.reporters).toEqual(['text', 'text-summary', 'lcov', 'json-summary'])
    expect(COVERAGE_POLICY.strictThresholds).toEqual({
      branches: 100,
      functions: 100,
      lines: 100,
      perFile: true,
      statements: 100,
    })
  })
})
