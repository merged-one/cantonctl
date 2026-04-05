import * as fs from 'node:fs'
import * as path from 'node:path'

import {describe, expect, it} from 'vitest'

const REPO_ROOT = process.cwd()

const PRIMARY_SURFACES = [
  'README.md',
  'package.json',
  'docs/README.md',
  'docs/concepts/ecosystem-fit.md',
  'docs/concepts/when-to-use-which-tool.md',
  'docs/concepts/target-users.md',
  'docs/concepts/non-goals.md',
  'docs/reference/build.md',
  'docs/reference/dev.md',
  'docs/reference/test.md',
  'docs/reference/init.md',
  'docs/reference/configuration.md',
  'docs/reference/localnet.md',
  'docs/reference/compatibility.md',
  'docs/reference/auth.md',
  'docs/reference/status.md',
  'docs/reference/readiness.md',
  'docs/reference/deploy.md',
  'proposals/cantonctl.md',
]

const RETIRED_PHRASES = [
  'Hardhat for Canton',
  'complete developer toolchain for Canton',
  'Institutional-grade CLI toolchain for building on Canton Network',
  'Remix-like browser IDE',
]

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
}

describe('positioning guard', () => {
  it('keeps retired phrases out of primary positioning surfaces', () => {
    for (const file of PRIMARY_SURFACES) {
      const contents = read(file)
      for (const phrase of RETIRED_PHRASES) {
        expect(contents, `${file} should not include ${phrase}`).not.toContain(phrase)
      }
    }
  })

  it('keeps companion language present across primary docs', () => {
    const combined = [
      read('README.md'),
      read('docs/README.md'),
      read('docs/concepts/ecosystem-fit.md'),
      read('docs/reference/api-stability.md'),
      read('docs/reference/compatibility.md'),
      read('proposals/cantonctl.md'),
    ].join('\n')

    expect(combined).toContain('Splice-aware orchestration companion')
    expect(combined).toContain('wrap, do not replace')
    expect(combined).toContain('DPM')
    expect(combined).toContain('Daml Studio')
    expect(combined).toContain('Quickstart')
    expect(combined).toContain('stable/public')
    expect(combined).toContain('experimental')
  })
})
