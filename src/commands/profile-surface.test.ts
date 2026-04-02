import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../lib/config.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import CompatCheck from './compat/check.js'
import CodegenSync from './codegen/sync.js'
import ProfilesList from './profiles/list.js'
import ProfilesShow from './profiles/show.js'
import ProfilesValidate from './profiles/validate.js'

const CLI_ROOT = process.cwd()

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networks: {
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {issuer: 'https://login.example.com', kind: 'oidc'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          scanProxy: {url: 'https://scan-proxy.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

describe('profile command surface', () => {
  it('lists normalized profiles in json mode', async () => {
    const config = createConfig()

    class TestProfilesList extends ProfilesList {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }
    }

    const result = await captureOutput(() => TestProfilesList.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      defaultProfile: 'sandbox',
      profiles: [
        expect.objectContaining({isDefault: true, kind: 'sandbox', name: 'sandbox'}),
        expect.objectContaining({isDefault: false, kind: 'remote-validator', name: 'splice-devnet'}),
      ],
    }))
  })

  it('shows a single profile with kind and services', async () => {
    const config = createConfig()

    class TestProfilesShow extends ProfilesShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }
    }

    const result = await captureOutput(() => TestProfilesShow.run(['splice-devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      profile: expect.objectContaining({
        kind: 'remote-validator',
        name: 'splice-devnet',
      }),
      services: expect.arrayContaining([
        expect.objectContaining({name: 'ledger'}),
        expect.objectContaining({name: 'scanProxy'}),
        expect.objectContaining({name: 'validator'}),
      ]),
    }))
  })

  it('validates all profiles without changing the profile shape', async () => {
    const config = createConfig()

    class TestProfilesValidate extends ProfilesValidate {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }
    }

    const result = await captureOutput(() => TestProfilesValidate.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      profileCount: 2,
      profiles: [
        expect.objectContaining({kind: 'sandbox', name: 'sandbox', valid: true}),
        expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet', valid: true}),
      ],
    }))
  })

  it('runs manifest-driven codegen sync steps in order', async () => {
    const runner: ProcessRunner = {
      run: vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: 'ok'}),
      spawn: vi.fn(),
      which: vi.fn(),
    }

    class TestCodegenSync extends CodegenSync {
      protected override createRunner(): ProcessRunner {
        return runner
      }

      protected override getCommandCwd(): string {
        return '/repo'
      }
    }

    const result = await captureOutput(() => TestCodegenSync.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(runner.run).toHaveBeenNthCalledWith(
      1,
      'npm',
      ['run', 'codegen:fetch-specs'],
      expect.objectContaining({cwd: '/repo', ignoreExitCode: true}),
    )
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      'npm',
      ['run', 'codegen:generate-types'],
      expect.objectContaining({cwd: '/repo', ignoreExitCode: true}),
    )

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      steps: [
        expect.objectContaining({command: 'npm run codegen:fetch-specs', success: true}),
        expect.objectContaining({command: 'npm run codegen:generate-types', success: true}),
      ],
    }))
  })

  it('reports compatibility for the selected profile', async () => {
    const config = createConfig()

    class TestCompatCheck extends CompatCheck {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return config
      }
    }

    const result = await captureOutput(() => TestCompatCheck.run(['splice-devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      profile: expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}),
      warned: expect.any(Number),
    }))
    expect(json.data).toEqual(expect.objectContaining({
      checks: expect.arrayContaining([
        expect.objectContaining({name: 'Service ledger', status: 'pass'}),
        expect.objectContaining({name: 'Service scanProxy', status: 'warn'}),
        expect.objectContaining({name: 'Service validator', status: 'warn'}),
      ]),
    }))
  })
})
