import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
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
  it('exposes codegen and compatibility command metadata', () => {
    expect(CodegenSync.description).toContain('Sync upstream specs')
    expect(CodegenSync.examples).toEqual(expect.arrayContaining([
      '<%= config.bin %> codegen sync --json',
    ]))
    expect(CodegenSync.flags).toEqual(expect.objectContaining({
      json: expect.any(Object),
    }))

    expect(CompatCheck.args).toEqual(expect.objectContaining({
      profile: expect.any(Object),
    }))
    expect(CompatCheck.description).toContain('Check stable-surface compatibility')
    expect(CompatCheck.examples).toEqual(expect.arrayContaining([
      '<%= config.bin %> compat check sandbox --json',
    ]))
    expect(CompatCheck.flags).toEqual(expect.objectContaining({
      json: expect.any(Object),
    }))
  })

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

  it('renders the profile list in human mode', async () => {
    class TestProfilesList extends ProfilesList {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestProfilesList.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('sandbox')
    expect(result.stdout).toContain('splice-devnet')
  })

  it('renders empty and single-profile list states in human mode', async () => {
    class EmptyProfilesList extends ProfilesList {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          'default-profile': undefined,
          profiles: {},
        }
      }
    }

    class SingleProfilesList extends ProfilesList {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          'default-profile': 'sv',
          profiles: {
            sv: {
              experimental: false,
              kind: 'remote-sv-network',
              name: 'sv',
              services: {},
            },
          },
        }
      }
    }

    const emptyResult = await captureOutput(() => EmptyProfilesList.run([], {root: CLI_ROOT}))
    expect(emptyResult.error).toBeUndefined()
    expect(emptyResult.stdout).toContain('No profiles resolved from cantonctl.yaml')

    const singleResult = await captureOutput(() => SingleProfilesList.run([], {root: CLI_ROOT}))
    expect(singleResult.error).toBeUndefined()
    expect(singleResult.stdout).toContain('sv')
    expect(singleResult.stdout).toContain('Resolved 1 profile')
  })

  it('executes profiles list through the base class static path', async () => {
    const loadProjectConfigSpy = vi
      .spyOn(ProfilesList.prototype as unknown as {loadProjectConfig: () => Promise<CantonctlConfig>}, 'loadProjectConfig')
      .mockResolvedValue(createConfig())

    try {
      const result = await captureOutput(() => ProfilesList.run(['--json'], {root: CLI_ROOT}))
      expect(result.error).toBeUndefined()

      const json = parseJson(result.stdout)
      expect(json.success).toBe(true)
      expect(json.data).toEqual(expect.objectContaining({
        defaultProfile: 'sandbox',
      }))
    } finally {
      loadProjectConfigSpy.mockRestore()
    }
  })

  it('serializes profile list configuration errors and rethrows unexpected ones', async () => {
    class ListConfigError extends ProfilesList {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Fix profiles',
        })
      }
    }

    class ListUnexpectedError extends ProfilesList {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('list boom')
      }
    }

    const result = await captureOutput(() => ListConfigError.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
        suggestion: 'Fix profiles',
      }),
      success: false,
    }))

    await expect(ListUnexpectedError.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('list boom')
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

  it('renders a single profile in human mode', async () => {
    class TestProfilesShow extends ProfilesShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestProfilesShow.run(['splice-devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Profile: splice-devnet')
    expect(result.stdout).toContain('scanProxy')
    expect(result.stdout).toContain('validator')
  })

  it('renders experimental profiles with config-only services in human mode', async () => {
    const baseConfig = createConfig()

    class TestProfilesShow extends ProfilesShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...baseConfig,
          profiles: {
            ...baseConfig.profiles,
            'splice-localnet': {
              experimental: true,
              kind: 'splice-localnet',
              name: 'splice-localnet',
              services: {
                localnet: {distribution: 'splice', version: '0.5.x'},
                validator: {url: 'https://validator.local'},
              },
            },
          },
        }
      }
    }

    const result = await captureOutput(() => TestProfilesShow.run(['splice-localnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Experimental: yes')
    expect(result.stdout).toContain('localnet')
    expect(result.stdout).toContain('config-only')
  })

  it('executes profiles show through the base class static path', async () => {
    const loadProjectConfigSpy = vi
      .spyOn(ProfilesShow.prototype as unknown as {loadProjectConfig: () => Promise<CantonctlConfig>}, 'loadProjectConfig')
      .mockResolvedValue(createConfig())

    try {
      const result = await captureOutput(() => ProfilesShow.run(['splice-devnet', '--json'], {root: CLI_ROOT}))
      expect(result.error).toBeUndefined()

      const json = parseJson(result.stdout)
      expect(json.success).toBe(true)
      expect(json.data).toEqual(expect.objectContaining({
        profile: expect.objectContaining({name: 'splice-devnet'}),
      }))
    } finally {
      loadProjectConfigSpy.mockRestore()
    }
  })

  it('serializes profile show configuration errors and rethrows unexpected ones', async () => {
    class ShowConfigError extends ProfilesShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Fix profile selection',
        })
      }
    }

    class ShowUnexpectedError extends ProfilesShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('show boom')
      }
    }

    const result = await captureOutput(() => ShowConfigError.run(['sandbox', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
        suggestion: 'Fix profile selection',
      }),
      success: false,
    }))

    await expect(ShowUnexpectedError.run(['sandbox', '--json'], {root: CLI_ROOT})).rejects.toThrow('show boom')
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

  it('renders validation summaries in human mode', async () => {
    class TestProfilesValidate extends ProfilesValidate {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestProfilesValidate.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Validated 2 profiles')
  })

  it('renders a singular validation summary in human mode', async () => {
    const baseConfig = createConfig()

    class TestProfilesValidate extends ProfilesValidate {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...baseConfig,
          profiles: {
            sandbox: baseConfig.profiles!.sandbox,
          },
        }
      }
    }

    const result = await captureOutput(() => TestProfilesValidate.run(['sandbox'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Validated 1 profile')
  })

  it('executes profiles validate through the base class static path', async () => {
    const loadProjectConfigSpy = vi
      .spyOn(
        ProfilesValidate.prototype as unknown as {loadProjectConfig: () => Promise<CantonctlConfig>},
        'loadProjectConfig',
      )
      .mockResolvedValue(createConfig())

    try {
      const result = await captureOutput(() => ProfilesValidate.run(['sandbox', '--json'], {root: CLI_ROOT}))
      expect(result.error).toBeUndefined()

      const json = parseJson(result.stdout)
      expect(json.success).toBe(true)
      expect(json.data).toEqual(expect.objectContaining({
        profileCount: 1,
      }))
    } finally {
      loadProjectConfigSpy.mockRestore()
    }
  })

  it('serializes profile validation errors and rethrows unexpected ones', async () => {
    class ValidateConfigError extends ProfilesValidate {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Fix validation input',
        })
      }
    }

    class ValidateUnexpectedError extends ProfilesValidate {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('validate boom')
      }
    }

    const result = await captureOutput(() => ValidateConfigError.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
        suggestion: 'Fix validation input',
      }),
      success: false,
    }))

    await expect(ValidateUnexpectedError.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('validate boom')
  })

  it('delegates base profile command config loading to loadConfig', async () => {
    const config = createConfig()
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)

    class ListHarness extends ProfilesList {
      public async callLoadProjectConfig(): Promise<CantonctlConfig> {
        return this.loadProjectConfig()
      }
    }

    class ShowHarness extends ProfilesShow {
      public async callLoadProjectConfig(): Promise<CantonctlConfig> {
        return this.loadProjectConfig()
      }
    }

    class ValidateHarness extends ProfilesValidate {
      public async callLoadProjectConfig(): Promise<CantonctlConfig> {
        return this.loadProjectConfig()
      }
    }

    try {
      await expect(new ListHarness([], {} as never).callLoadProjectConfig()).resolves.toBe(config)
      await expect(new ShowHarness([], {} as never).callLoadProjectConfig()).resolves.toBe(config)
      await expect(new ValidateHarness([], {} as never).callLoadProjectConfig()).resolves.toBe(config)
      expect(loadConfigSpy).toHaveBeenCalledTimes(3)
    } finally {
      loadConfigSpy.mockRestore()
    }
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

  it('reports failing codegen steps in json mode', async () => {
    const runner: ProcessRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({exitCode: 0, stderr: '', stdout: 'ok'})
        .mockResolvedValueOnce({exitCode: 1, stderr: 'boom', stdout: ''}),
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
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.SDK_COMMAND_FAILED,
    }))
  })

  it('executes codegen sync through the instance run path', async () => {
    const runner: ProcessRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({exitCode: 0, stderr: '', stdout: 'fetched'})
        .mockResolvedValueOnce({exitCode: 0, stderr: '', stdout: 'generated'}),
      spawn: vi.fn(),
      which: vi.fn(),
    }

    const command = new CodegenSync([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({flags: {json: false}} as never)
    vi.spyOn(command as unknown as {createRunner: () => ProcessRunner}, 'createRunner').mockReturnValue(runner)
    vi.spyOn(command as unknown as {getCommandCwd: () => string}, 'getCommandCwd').mockReturnValue('/repo')

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Fetch upstream specs')
    expect(result.stdout).toContain('Generate stable clients')
    expect(result.stdout).toContain('Upstream specs synced and stable clients regenerated')
  })

  it('rethrows unexpected codegen sync failures', async () => {
    const runner: ProcessRunner = {
      run: vi.fn().mockRejectedValue(new Error('boom')),
      spawn: vi.fn(),
      which: vi.fn(),
    }

    class TestCodegenSync extends CodegenSync {
      protected override createRunner(): ProcessRunner {
        return runner
      }
    }

    await expect(TestCodegenSync.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
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

  it('renders compatibility passes in human mode', async () => {
    class TestCompatCheck extends CompatCheck {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          'default-profile': 'validator-only',
          profiles: {
            'validator-only': {
              experimental: false,
              kind: 'remote-validator',
              name: 'validator-only',
              services: {
                validator: {url: 'https://validator.example.com'},
              },
            },
          },
        }
      }
    }

    const result = await captureOutput(() => TestCompatCheck.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Profile: validator-only')
    expect(result.stdout).toContain('Compatibility checks passed with 1 warning')
  })

  it('renders compatibility failures in human mode', async () => {
    class TestCompatCheck extends CompatCheck {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          project: {name: 'demo', 'sdk-version': '4.0.0'},
        }
      }
    }

    const result = await captureOutput(() => TestCompatCheck.run(['splice-devnet'], {root: CLI_ROOT}))
    expect(result.stdout).toContain('Profile: splice-devnet')
    expect(result.stdout).toContain('Kind: remote-validator')
    expect(result.stdout).toContain('Service')
  })

  it('fails compatibility checks in json mode when the SDK drifts outside the pinned baseline', async () => {
    class TestCompatCheck extends CompatCheck {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          project: {name: 'demo', 'sdk-version': '4.0.0'},
        }
      }
    }

    const result = await captureOutput(() => TestCompatCheck.run(['splice-devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      failed: 1,
      profile: expect.objectContaining({name: 'splice-devnet'}),
    }))
  })

  it('serializes CantonctlError failures for compatibility checks', async () => {
    class TestCompatCheck extends CompatCheck {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
          suggestion: 'Create cantonctl.yaml before running compat check.',
        })
      }
    }

    const result = await captureOutput(() => TestCompatCheck.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_NOT_FOUND,
      suggestion: 'Create cantonctl.yaml before running compat check.',
    }))
  })

  it('executes compat check through the instance run path', async () => {
    const command = new CompatCheck([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      args: {profile: 'splice-devnet'},
      flags: {json: false},
    } as never)
    vi.spyOn(command as unknown as {loadProjectConfig: () => Promise<CantonctlConfig>}, 'loadProjectConfig')
      .mockResolvedValue(createConfig())

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Profile: splice-devnet')
    expect(result.stdout).toContain('Kind: remote-validator')
  })

  it('rethrows unexpected compatibility check failures', async () => {
    class TestCompatCheck extends CompatCheck {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('boom')
      }
    }

    await expect(TestCompatCheck.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
  })
})
