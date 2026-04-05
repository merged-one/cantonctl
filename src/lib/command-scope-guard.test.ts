import * as fs from 'node:fs'
import * as path from 'node:path'

import {describe, expect, it} from 'vitest'

const REPO_ROOT = process.cwd()

const REMOVED_FILES = [
  'src/commands/clean.ts',
  'src/commands/console.ts',
  'src/commands/playground.ts',
  'src/commands/serve.ts',
  'src/commands/validator/experimental/base.ts',
  'src/commands/validator/experimental/external-party-generate.ts',
  'src/commands/validator/experimental/external-party-submit.ts',
  'src/commands/validator/experimental/offboard-user.ts',
  'src/commands/validator/experimental/register-user.ts',
  'src/commands/validator/experimental/setup-preapproval.ts',
  'docs/reference/clean.md',
  'docs/reference/console.md',
  'docs/reference/experimental.md',
  'docs/reference/playground.md',
  'docs/reference/serve.md',
  'docs/tasks/use-the-console.md',
  'playground',
  'assets/templates/api-service',
  'assets/templates/basic',
  'assets/templates/defi-amm',
  'assets/templates/token',
  'assets/templates/zenith-evm',
]

const REQUIRED_FILES = [
  'src/commands/profiles/import-localnet.ts',
  'src/commands/readiness.ts',
  'src/lib/localnet-import.ts',
  'src/lib/readiness.ts',
  'docs/reference/readiness.md',
]

const ACTIVE_SURFACES = [
  'README.md',
  'docs/README.md',
  'docs/CURRENT_STATE.md',
  'docs/reference/init.md',
  'docs/reference/auth.md',
  'docs/reference/localnet.md',
  'docs/reference/readiness.md',
  'docs/concepts/authentication.md',
  'docs/troubleshooting/errors.md',
]

function exists(relPath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relPath))
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
}

describe('command scope guard', () => {
  it('keeps retired files out of the active tree', () => {
    for (const file of REMOVED_FILES) {
      expect(exists(file), `${file} should stay removed`).toBe(false)
    }
  })

  it('keeps the reduced control-plane surfaces present', () => {
    for (const file of REQUIRED_FILES) {
      expect(exists(file), `${file} should exist`).toBe(true)
    }
  })

  it('keeps retired commands and auth modes out of active docs', () => {
    const combined = ACTIVE_SURFACES.map(read).join('\n')

    expect(combined).not.toContain('cantonctl serve')
    expect(combined).not.toContain('cantonctl playground')
    expect(combined).not.toContain('cantonctl console')
    expect(combined).not.toContain('cantonctl clean --force')
    expect(combined).not.toContain('validator experimental')
    expect(combined).not.toContain('oidc-client-credentials')
    expect(combined).not.toContain('localnet-unsafe-hmac')
  })

  it('keeps init docs limited to the supported Splice starter templates', () => {
    const combined = [
      read('README.md'),
      read('docs/reference/init.md'),
      read('docs/reference/cantonctl-schema.json'),
    ].join('\n')

    expect(combined).toContain('splice-dapp-sdk')
    expect(combined).toContain('splice-scan-reader')
    expect(combined).toContain('splice-token-app')
    expect(combined).not.toContain('defi-amm')
    expect(combined).not.toContain('api-service')
    expect(combined).not.toContain('zenith-evm')
  })
})
