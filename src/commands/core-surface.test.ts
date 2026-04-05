import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import type {Builder} from '../lib/builder.js'
import type {CantonctlConfig} from '../lib/config.js'
import type {KeychainBackend} from '../lib/credential-store.js'
import type {DamlSdk} from '../lib/daml.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import type {Template} from '../lib/scaffold.js'
import type {TestRunner} from '../lib/test-runner.js'
import AuthLogin from './auth/login.js'
import AuthLogout from './auth/logout.js'
import AuthStatus from './auth/status.js'
import Build from './build.js'
import Init from './init.js'
import Test from './test.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networks: {
      devnet: {type: 'remote', url: 'https://ledger.example.com'},
      local: {type: 'docker'},
    },
    networkProfiles: {
      devnet: 'splice-devnet',
      local: 'splice-localnet',
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
          validator: {url: 'https://validator.example.com'},
        },
      },
      'splice-localnet': {
        experimental: false,
        kind: 'splice-localnet',
        name: 'splice-localnet',
        services: {
          localnet: {distribution: 'splice-localnet', version: '0.5.3'},
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

function createBackend(): KeychainBackend {
  return {
    deletePassword: vi.fn(),
    findCredentials: vi.fn().mockResolvedValue([]),
    getPassword: vi.fn().mockResolvedValue(null),
    setPassword: vi.fn(),
  }
}

describe('core command surface', () => {
  it('exposes metadata for build, test, init, and auth commands', () => {
    expect(Build.description).toContain('Compile Daml contracts')
    expect(Build.flags).toEqual(expect.objectContaining({
      codegen: expect.any(Object),
      force: expect.any(Object),
      json: expect.any(Object),
    }))

    expect(Test.description).toContain('Run Daml Script tests')
    expect(Test.flags).toEqual(expect.objectContaining({
      filter: expect.any(Object),
      json: expect.any(Object),
    }))

    expect(Init.description).toContain('companion-ready Canton project')
    expect(Init.flags.template.default).toBe('splice-dapp-sdk')

    expect(AuthLogout.description).toContain('Remove stored credentials')
    expect(AuthStatus.description).toContain('Show authentication status')
    expect(AuthLogin.examples).toEqual(expect.arrayContaining([
      '<%= config.bin %> auth login localnet',
    ]))
  })

  it('emits build results in json mode', async () => {
    class TestBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            cached: false,
            darPath: '/repo/.daml/dist/demo.dar',
            durationMs: 25,
            success: true,
          }),
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

      protected override getProjectDir(): string {
        return '/repo'
      }
    }

    const result = await captureOutput(() => TestBuild.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        cached: false,
        darPath: '/repo/.daml/dist/demo.dar',
        durationMs: 25,
      }),
      success: true,
    }))
  })

  it('emits test runner results in json mode', async () => {
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
            durationMs: 30,
            output: 'all good',
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
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        durationMs: 30,
        output: 'all good',
        passed: true,
      }),
      success: true,
    }))
  })

  it('defaults init to the splice-dapp-sdk template in json mode', async () => {
    class TestInit extends Init {
      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: Template}) {
        return {
          files: ['cantonctl.yaml', 'daml.yaml'],
          projectDir: options.dir,
          template: options.template,
        }
      }
    }

    const result = await captureOutput(() => TestInit.run(['demo-app', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        projectDir: '/tmp/demo-app',
        template: 'splice-dapp-sdk',
      }),
      success: true,
    }))
  })

  it('prints splice-oriented next steps for splice templates', async () => {
    class TestInit extends Init {
      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: Template}) {
        return {
          files: ['cantonctl.yaml'],
          projectDir: options.dir,
          template: options.template,
        }
      }
    }

    const result = await captureOutput(() => TestInit.run([
      'demo-app',
      '--template',
      'splice-token-app',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('cantonctl compat check splice-devnet')
  })

  it('uses local fallback auth for splice-localnet-style networks without persisting credentials', async () => {
    class TestAuthLogin extends AuthLogin {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: false}
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
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run(['local', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'bearer-token',
        network: 'local',
        persisted: false,
        source: 'generated',
      },
      success: true,
    }))
  })

  it('stores explicit remote tokens with env-or-keychain-jwt mode', async () => {
    const store = vi.fn().mockResolvedValue(undefined)

    class TestAuthLogin extends AuthLogin {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: false}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store,
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
      '--token',
      'jwt-token',
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(store).toHaveBeenCalledWith('devnet', 'jwt-token', {mode: 'env-or-keychain-jwt'})
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'env-or-keychain-jwt',
        network: 'devnet',
        persisted: true,
        source: 'memory',
      },
      success: true,
    }))
  })

  it('reports stored remote auth and generated local fallback auth in auth status', async () => {
    class TestAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: false}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn().mockImplementation(async (network: string) => (
            network === 'devnet'
              ? {mode: 'env-or-keychain-jwt', source: 'stored', storedAt: '2026-04-02T20:00:00Z', token: 'jwt'}
              : null
          )),
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
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        networks: expect.arrayContaining([
          {authenticated: true, mode: 'env-or-keychain-jwt', network: 'devnet', source: 'memory'},
          {authenticated: true, mode: 'bearer-token', network: 'local', source: 'generated'},
        ]),
      },
      success: true,
    }))
  })

  it('removes stored credentials in json mode', async () => {
    class TestAuthLogout extends AuthLogout {
      protected override async createBackend() {
        return {backend: createBackend()}
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

    const result = await captureOutput(() => TestAuthLogout.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual({
      data: {network: 'devnet', removed: true},
      success: true,
    })
  })

  it('serializes structured init failures', async () => {
    class TestInit extends Init {
      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(): never {
        throw new CantonctlError(ErrorCode.CONFIG_DIRECTORY_EXISTS, {
          suggestion: 'choose another directory',
        })
      }
    }

    const result = await captureOutput(() => TestInit.run(['demo-app', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_DIRECTORY_EXISTS,
        suggestion: 'choose another directory',
      }),
      success: false,
    }))
  })
})
