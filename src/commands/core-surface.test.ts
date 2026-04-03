import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import type {ResolvedCredential, StoredCredential} from '../lib/credential-store.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {KeychainBackend} from '../lib/credential-store.js'
import type {Builder} from '../lib/builder.js'
import type {Cleaner} from '../lib/cleaner.js'
import type {CantonctlConfig} from '../lib/config.js'
import type {DamlSdk} from '../lib/daml.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import type {Template} from '../lib/scaffold.js'
import type {TestRunner} from '../lib/test-runner.js'
import AuthLogin from './auth/login.js'
import AuthLogout from './auth/logout.js'
import AuthStatus from './auth/status.js'
import Build from './build.js'
import Clean from './clean.js'
import Init from './init.js'
import Test from './test.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function createConfig(): CantonctlConfig {
  return {
    networks: {
      devnet: {type: 'remote', url: 'https://ledger.example.com'},
      local: {type: 'docker'},
    },
    networkProfiles: {
      devnet: 'splice-devnet',
      local: 'splice-localnet',
    },
    profiles: {
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {issuer: 'https://login.example.com', kind: 'oidc'},
          ledger: {url: 'https://ledger.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      'splice-localnet': {
        experimental: true,
        kind: 'splice-localnet',
        name: 'splice-localnet',
        services: {
          localnet: {distribution: 'splice-localnet', version: '0.5.x'},
          validator: {url: 'https://validator.local'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createRunner(): ProcessRunner {
  return {
    run: vi.fn(),
    spawn: vi.fn(),
    which: vi.fn(),
  }
}

function createSdk(): DamlSdk {
  return {
    build: vi.fn(),
    codegen: vi.fn(),
    detectCommand: vi.fn(),
    getVersion: vi.fn(),
    startSandbox: vi.fn(),
    test: vi.fn(),
  } as unknown as DamlSdk
}

function createKeychainBackend(): KeychainBackend {
  return {
    deletePassword: vi.fn(),
    findCredentials: vi.fn().mockResolvedValue([]),
    getPassword: vi.fn().mockResolvedValue(null),
    setPassword: vi.fn(),
  }
}

describe('core command surface', () => {
  it('build emits codegen results in json mode', async () => {
    const builder: Builder = {
      build: vi.fn(),
      buildWithCodegen: vi.fn().mockResolvedValue({
        cached: false,
        darPath: '/repo/.daml/dist/demo.dar',
        durationMs: 25,
        success: true,
      }),
      watch: vi.fn(),
    }

    class TestBuild extends Build {
      protected override createBuilder(): Builder {
        return builder
      }

      protected override createHooks() {
        return {emit: vi.fn()} as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override getProjectDir(): string {
        return '/repo'
      }
    }

    const result = await captureOutput(() => TestBuild.run(['--json', '--codegen'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      cached: false,
      darPath: '/repo/.daml/dist/demo.dar',
      durationMs: 25,
    })
  })

  it('serializes build errors through CantonctlError', async () => {
    class TestBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.BUILD_DAR_NOT_FOUND, {
            suggestion: 'Check daml.yaml',
          })),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        }
      }

      protected override createHooks() {
        return {emit: vi.fn()} as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }
    }

    const result = await captureOutput(() => TestBuild.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.BUILD_DAR_NOT_FOUND,
      suggestion: 'Check daml.yaml',
    }))
  })

  it('stops watch mode cleanly on SIGINT', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)

    class TestBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            cached: false,
            darPath: '/repo/.daml/dist/demo.dar',
            durationMs: 20,
            success: true,
          }),
          buildWithCodegen: vi.fn(),
          watch: vi.fn().mockImplementation(async () => {
            setTimeout(() => {
              process.emit('SIGINT')
            }, 10)
            return {stop}
          }),
        }
      }

      protected override createHooks() {
        return {emit: vi.fn()} as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override getProjectDir(): string {
        return '/repo'
      }
    }

    const result = await captureOutput(() => TestBuild.run(['--json', '--watch'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(stop).toHaveBeenCalled()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({status: 'stopped'})
  })

  it('emits clean results in json mode', async () => {
    class TestClean extends Clean {
      protected override createCleaner(): Cleaner {
        return {
          clean: vi.fn().mockResolvedValue({
            durationMs: 15,
            removed: ['.daml', 'dist'],
            skipped: ['node_modules'],
          }),
        }
      }
    }

    const result = await captureOutput(() => TestClean.run(['--json', '--all'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      removed: ['.daml', 'dist'],
      skipped: ['node_modules'],
    })
  })

  it('renders clean summaries in human mode', async () => {
    class TestClean extends Clean {
      protected override createCleaner(): Cleaner {
        return {
          clean: vi.fn().mockResolvedValue({
            durationMs: 15,
            removed: ['.daml'],
            skipped: [],
          }),
        }
      }
    }

    const result = await captureOutput(() => TestClean.run(['--all'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('"removed"')
    expect(result.stdout).toContain('.daml')
  })

  it('serializes clean failures through CantonctlError', async () => {
    class TestClean extends Clean {
      protected override createCleaner(): Cleaner {
        return {
          clean: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_DIRECTORY_EXISTS, {
            suggestion: 'Delete the directory first',
          })),
        }
      }
    }

    const result = await captureOutput(() => TestClean.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_DIRECTORY_EXISTS,
      suggestion: 'Delete the directory first',
    }))
  })

  it('emits test results in json mode', async () => {
    class TestCommand extends Test {
      protected override createHooks() {
        return {emit: vi.fn()} as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createTestRunner(): TestRunner {
        return {
          run: vi.fn().mockResolvedValue({
            durationMs: 42,
            output: 'all green',
            passed: true,
            success: true,
          }),
        }
      }

      protected override getProjectDir(): string {
        return '/repo'
      }
    }

    const result = await captureOutput(() => TestCommand.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      durationMs: 42,
      output: 'all green',
      passed: true,
    })
  })

  it('exits non-zero when script tests fail', async () => {
    class TestCommand extends Test {
      protected override createHooks() {
        return {emit: vi.fn()} as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createTestRunner(): TestRunner {
        return {
          run: vi.fn().mockResolvedValue({
            durationMs: 12,
            output: 'failed',
            passed: false,
            success: false,
          }),
        }
      }
    }

    const result = await captureOutput(() => TestCommand.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({passed: false}))
  })

  it('prints failing test output in human mode', async () => {
    class TestCommand extends Test {
      protected override createHooks() {
        return {emit: vi.fn()} as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createTestRunner(): TestRunner {
        return {
          run: vi.fn().mockResolvedValue({
            durationMs: 12,
            output: 'testTransfer failed',
            passed: false,
            success: false,
          }),
        }
      }
    }

    const result = await captureOutput(() => TestCommand.run([], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.stdout).toContain('Running Daml Script tests...')
    expect(result.stdout).toContain('testTransfer failed')
    expect(result.stderr).toContain('Some tests failed')
  })

  it('scaffolds built-in templates in json mode', async () => {
    class TestInit extends Init {
      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: 'basic' | 'token' | 'defi-amm' | 'api-service' | 'zenith-evm' | 'splice-token-app' | 'splice-scan-reader' | 'splice-dapp-sdk'}) {
        return {
          files: ['cantonctl.yaml', 'daml.yaml'],
          projectDir: options.dir,
          template: options.template,
        }
      }
    }

    const result = await captureOutput(() => TestInit.run([
      'demo-app',
      '--template',
      'token',
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      files: ['cantonctl.yaml', 'daml.yaml'],
      projectDir: '/tmp/demo-app',
      template: 'token',
    })
  })

  it('supports interactive init flows through the prompt helper', async () => {
    class TestInit extends Init {
      protected override async promptInteractive() {
        return {name: 'interactive-app', template: 'basic' as const}
      }

      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: 'basic' | 'token' | 'defi-amm' | 'api-service' | 'zenith-evm' | 'splice-token-app' | 'splice-scan-reader' | 'splice-dapp-sdk'}) {
        return {
          files: ['cantonctl.yaml'],
          projectDir: options.dir,
          template: options.template,
        }
      }
    }

    const result = await captureOutput(() => TestInit.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      files: ['cantonctl.yaml'],
      projectDir: '/tmp/interactive-app',
      template: 'basic',
    })
  })

  it('loads interactive prompts through the base helper', async () => {
    let inputOptions:
      | {
        message: string
        validate: (value: string) => string | true
      }
      | undefined
    let selectOptions:
      | {
        choices: Array<{description: string; name: string; value: string}>
        message: string
      }
      | undefined

    class TestInit extends Init {
      public async callPromptInteractive() {
        return this.promptInteractive()
      }

      protected override async loadInteractivePrompts() {
        return {
          input: async (options: {message: string; validate: (value: string) => string | true}) => {
            inputOptions = options
            return 'interactive-app'
          },
          select: async (options: {
            choices: Array<{description: string; name: string; value: Template}>
            message: string
          }) => {
            selectOptions = options
            return 'token' as Template
          },
        }
      }
    }

    const answers = await new TestInit([], {} as never).callPromptInteractive()
    expect(answers).toEqual({name: 'interactive-app', template: 'token'})
    expect(inputOptions?.message).toBe('Project name:')
    expect(inputOptions?.validate('')).toBe('Project name is required')
    expect(inputOptions?.validate('bad name')).toBe('Use only letters, numbers, hyphens, and underscores')
    expect(inputOptions?.validate('good_name')).toBe(true)
    expect(selectOptions?.message).toBe('Select a template:')
    expect(selectOptions?.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'basic', value: 'basic'}),
      expect.objectContaining({name: 'token', value: 'token'}),
    ]))
  })

  it('prints next steps for built-in templates in human mode', async () => {
    class TestInit extends Init {
      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: 'basic' | 'token' | 'defi-amm' | 'api-service' | 'zenith-evm' | 'splice-token-app' | 'splice-scan-reader' | 'splice-dapp-sdk'}) {
        return {
          files: ['cantonctl.yaml', 'daml.yaml'],
          projectDir: options.dir,
          template: options.template,
        }
      }
    }

    const result = await captureOutput(() => TestInit.run(['demo-app'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Creating new Canton project: demo-app')
    expect(result.stdout).toContain('Next steps:')
    expect(result.stdout).toContain('cantonctl dev')
  })

  it('requires a project name for community templates', async () => {
    const result = await captureOutput(() => Init.run([
      '--json',
      '--from',
      'https://github.com/example/template',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
    }))
  })

  it('scaffolds community templates when a project name is provided', async () => {
    const scaffoldFromUrl = vi.fn().mockResolvedValue(undefined)

    class TestInit extends Init {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldFromUrl(options: {dir: string; runner: ProcessRunner; url: string}) {
        return scaffoldFromUrl(options)
      }
    }

    const result = await captureOutput(() => TestInit.run([
      'community-app',
      '--json',
      '--from',
      'https://github.com/example/template',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(scaffoldFromUrl).toHaveBeenCalledWith({
      dir: '/tmp/community-app',
      runner: expect.any(Object),
      url: 'https://github.com/example/template',
    })

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      from: 'https://github.com/example/template',
      projectDir: '/tmp/community-app',
    })
  })

  it('prints human-mode output for community templates', async () => {
    const scaffoldFromUrl = vi.fn().mockResolvedValue(undefined)

    class TestInit extends Init {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldFromUrl(options: {dir: string; runner: ProcessRunner; url: string}) {
        return scaffoldFromUrl(options)
      }
    }

    const result = await captureOutput(() => TestInit.run([
      'community-app',
      '--from',
      'https://github.com/example/template',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Scaffolding from community template: https://github.com/example/template')
    expect(result.stdout).toContain('Project created from https://github.com/example/template')
    expect(result.stdout).toContain('"from": "https://github.com/example/template"')
  })

  it('stores auth tokens and reports non-keychain persistence warnings', async () => {
    const storeToken = vi.fn()

    class TestAuthLogin extends AuthLogin {
      protected override async createBackend() {
        return {backend: createKeychainBackend(), isKeychain: false}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: storeToken,
        }
      }

      protected override createLedgerClient() {
        return {
          getVersion: vi.fn().mockResolvedValue({version: '3.4.11'}),
        } as never
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run([
      'local',
      '--experimental',
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(storeToken).not.toHaveBeenCalled()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      mode: 'localnet-unsafe-hmac',
      network: 'local',
      persisted: false,
      source: 'generated',
    })
  })

  it('requires explicit experimental acknowledgement for operator auth modes', async () => {
    class TestAuthLogin extends AuthLogin {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run([
      'devnet',
      '--json',
      '--token',
      'jwt-token',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.EXPERIMENTAL_CONFIRMATION_REQUIRED,
    }))
  })

  it('stores remote auth tokens after connectivity verification', async () => {
    const storeToken = vi.fn()

    class TestAuthLogin extends AuthLogin {
      protected override async createBackend() {
        return {backend: createKeychainBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: storeToken,
        }
      }

      protected override createLedgerClient() {
        return {
          getVersion: vi.fn().mockResolvedValue({version: '3.4.11'}),
        } as never
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run([
      'devnet',
      '--experimental',
      '--json',
      '--token',
      'jwt-token',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(storeToken).toHaveBeenCalledWith('devnet', 'jwt-token', {mode: 'oidc-client-credentials'})

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      mode: 'oidc-client-credentials',
      network: 'devnet',
      persisted: true,
      source: 'keychain',
    })
  })

  it('removes stored auth credentials in json mode', async () => {
    class TestAuthLogout extends AuthLogout {
      protected override async createBackend() {
        return {backend: createKeychainBackend()}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn().mockResolvedValue(true),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }
    }

    const result = await captureOutput(() => TestAuthLogout.run([
      'devnet',
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({network: 'devnet', removed: true})
  })

  it('reports when no stored credentials exist in human mode', async () => {
    class TestAuthLogout extends AuthLogout {
      protected override async createBackend() {
        return {backend: createKeychainBackend()}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn().mockResolvedValue(false),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }
    }

    const result = await captureOutput(() => TestAuthLogout.run(['devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('No credentials stored for devnet')
  })

  it('reports auth status across configured networks', async () => {
    const records = new Map<string, ResolvedCredential | null>([
      ['devnet', {mode: 'oidc-client-credentials', source: 'stored', storedAt: '2026-04-02T20:00:00Z', token: 'jwt'}],
      ['local', null],
    ])

    class TestAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createKeychainBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn(async (network: string) => records.get(network) ?? null),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAuthStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      networks: expect.arrayContaining([
        expect.objectContaining({
          authenticated: true,
          mode: 'oidc-client-credentials',
          network: 'devnet',
          source: 'keychain',
        }),
        expect.objectContaining({
          authenticated: true,
          mode: 'localnet-unsafe-hmac',
          network: 'local',
          source: 'generated',
        }),
      ]),
    }))
  })

  it('prints guidance when no networks are configured for auth status', async () => {
    class TestAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createKeychainBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return {
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }
    }

    const result = await captureOutput(() => TestAuthStatus.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('No networks configured in cantonctl.yaml')
  })
})
