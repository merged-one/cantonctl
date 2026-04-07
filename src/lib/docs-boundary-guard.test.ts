import * as fs from 'node:fs'
import * as path from 'node:path'

import {describe, expect, it} from 'vitest'

const REPO_ROOT = process.cwd()

const CONTROL_PLANE_REFERENCE_GUARDS = [
  {
    file: 'docs/reference/deploy.md',
    required: [
      '`cantonctl deploy`',
      'project-local control-plane boundary',
      'official runtime endpoints',
      'DPM and Daml Studio',
      'Quickstart and the official LocalNet workspace',
    ],
  },
  {
    file: 'docs/reference/promotion.md',
    required: [
      '`cantonctl promote diff`',
      'official-stack and operator-owned work as explicit runbooks',
      'stable/public canary coverage',
      'companion mutation boundary',
    ],
  },
  {
    file: 'docs/reference/upgrade.md',
    required: [
      '`cantonctl upgrade check`',
      'project-local day-2 boundary',
      'manual-only',
      'official LocalNet workspace',
      'remote upgrade execution remains operator-owned',
    ],
  },
  {
    file: 'docs/reference/reset.md',
    required: [
      '`cantonctl reset checklist`',
      'boundary-aware',
      'official LocalNet workspace',
      'remote reset execution remains operator-owned',
    ],
  },
  {
    file: 'docs/reference/diagnostics.md',
    required: [
      '`cantonctl diagnostics bundle`',
      'inventory.json',
      'drift.json',
      'last-operation.json',
      '.cantonctl/control-plane/last-operation.json',
    ],
  },
  {
    file: 'docs/reference/operator.md',
    required: [
      '`cantonctl operator`',
      'stable/public-first',
      'This namespace is explicit by design.',
      'explicit operator auth',
    ],
  },
  {
    file: 'docs/reference/status.md',
    required: [
      '`cantonctl status`',
      'companion support surface',
      'authoritative machine-readable runtime inventory',
      'upstream- or operator-owned manual steps',
    ],
  },
  {
    file: 'docs/reference/preflight.md',
    required: [
      '`cantonctl preflight`',
      'read-only rollout gate',
      'stable/public service reachability checks',
      'companion mutation boundary',
    ],
  },
  {
    file: 'docs/reference/api-stability.md',
    required: [
      'stable/public',
      'official SDKs',
      'explicit `operator` namespace',
    ],
  },
] as const

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
}

describe('docs boundary guard', () => {
  it('keeps control-plane reference docs aligned with the live command scope and boundary', () => {
    for (const {file, required} of CONTROL_PLANE_REFERENCE_GUARDS) {
      const contents = read(file)
      for (const phrase of required) {
        expect(contents, `${file} should include ${phrase}`).toContain(phrase)
      }
    }
  })

  it('keeps current-state and docs indexes focused on shipped surfaces', () => {
    const currentState = read('docs/CURRENT_STATE.md')
    const rootReadme = read('README.md')
    const docsReadme = read('docs/README.md')

    expect(currentState).toContain('Do not use it for aspirational planning')
    expect(currentState).toContain('Use it to describe what exists on the current branch')

    for (const retired of ['vNEXT', 'phase-prep', 'worklog', 'funding-justification']) {
      expect(currentState, `docs/CURRENT_STATE.md should not include ${retired}`).not.toContain(retired)
    }

    expect(rootReadme).toContain('[docs/release-notes/](docs/release-notes/)')
    expect(rootReadme).toContain('[docs/migration/](docs/migration/)')
    expect(docsReadme).toContain('[Release notes](release-notes/)')
    expect(docsReadme).toContain('[Migration guides](migration/)')
  })

  it('keeps docs policy explicit for added and trimmed command-scope and boundary changes', () => {
    const bestPractices = read('docs/BEST_PRACTICES.md')
    const agents = read('AGENTS.md')

    for (const contents of [bestPractices, agents]) {
      expect(contents).toContain('added or trimmed')
      expect(contents).toContain('command help')
      expect(contents).toContain('docs/reference')
      expect(contents).toContain('CURRENT_STATE')
      expect(contents).toContain('command scope')
      expect(contents).toContain('boundary')
    }

    expect(bestPractices).toContain('release or migration notes')
    expect(agents).toContain('release/migration notes')
  })
})
