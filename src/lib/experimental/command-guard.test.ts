import {captureOutput} from '@oclif/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

import ExternalPartyGenerate from '../../commands/validator/experimental/external-party-generate.js'
import ExternalPartySubmit from '../../commands/validator/experimental/external-party-submit.js'
import OffboardUser from '../../commands/validator/experimental/offboard-user.js'
import RegisterUser from '../../commands/validator/experimental/register-user.js'
import SetupPreapproval from '../../commands/validator/experimental/setup-preapproval.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function listStableCommandFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (fullPath.includes(`${path.sep}experimental`)) continue
      results.push(...listStableCommandFiles(fullPath))
      continue
    }

    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
    results.push(fullPath)
  }

  return results
}

describe('experimental validator commands', () => {
  it('require explicit opt-in before touching validator-internal flows', async () => {
    const invocations = [
      () => RegisterUser.run(['devnet', '--name', 'alice', '--json'], {root: CLI_ROOT}),
      () => OffboardUser.run(['devnet', '--username', 'alice', '--json'], {root: CLI_ROOT}),
      () => ExternalPartyGenerate.run([
        'devnet',
        '--party-hint',
        'alice',
        '--public-key',
        'abcd1234',
        '--json',
      ], {root: CLI_ROOT}),
      () => ExternalPartySubmit.run([
        'devnet',
        '--public-key',
        'abcd1234',
        '--signed-topology-tx',
        'dG9wb2xvZ3k=:deadbeef',
        '--json',
      ], {root: CLI_ROOT}),
      () => SetupPreapproval.run([
        'devnet',
        '--user-party-id',
        'Alice::1220',
        '--json',
      ], {root: CLI_ROOT}),
    ]

    for (const invocation of invocations) {
      const result = await captureOutput(invocation)
      const json = parseJson(result.stdout)
      expect(json.success).toBe(false)
      expect(json.error).toEqual(expect.objectContaining({
        code: 'E1006',
      }))
    }
  }, 30_000)
})

describe('stable command imports', () => {
  it('keep stable commands isolated from experimental modules', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const commandsDir = path.resolve(here, '../../commands')
    const stableFiles = listStableCommandFiles(commandsDir)

    for (const file of stableFiles) {
      const importLines = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line.startsWith('import '))
        .join('\n')
      expect(importLines).not.toMatch(/\/experimental\//)
      expect(importLines).not.toMatch(/experimental\./)
    }
  })
})
