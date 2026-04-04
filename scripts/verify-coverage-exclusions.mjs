#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import {COVERAGE_POLICY} from './ci/manifest.js'
import {
  findInlineV8Ignores,
  parseExclusionsRegistry,
  verifyCoverageExclusions,
} from './coverage-exclusions.js'

const registryPath = path.resolve(process.cwd(), COVERAGE_POLICY.registryPath)

if (!fs.existsSync(registryPath)) {
  console.error(`Coverage exclusion registry not found at ${registryPath}`)
  process.exit(1)
}

const parsed = parseExclusionsRegistry(fs.readFileSync(registryPath, 'utf8'))
if (parsed.errors.length > 0 || !parsed.registry) {
  console.error('\nCoverage exclusion registry is invalid:')
  for (const error of parsed.errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

const failures = verifyCoverageExclusions({
  excludePatterns: [...COVERAGE_POLICY.exclude],
  inlineIgnores: findInlineV8Ignores({
    cwd: process.cwd(),
    roots: [...COVERAGE_POLICY.inlineIgnoreRoots],
  }),
  registry: parsed.registry,
})

if (failures.length > 0) {
  console.error('\nCoverage exclusion verification failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('\nCoverage exclusions verified.')
