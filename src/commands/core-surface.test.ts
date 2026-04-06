import * as fs from 'node:fs'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import * as readline from 'node:readline'
import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {Builder} from '../lib/builder.js'
import type {CantonctlConfig} from '../lib/config.js'
import * as damlModule from '../lib/daml.js'
import type {KeychainBackend} from '../lib/credential-store.js'
import type {DamlSdk} from '../lib/daml.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import * as keytarBackendModule from '../lib/keytar-backend.js'
import * as processRunnerModule from '../lib/process-runner.js'
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

afterEach(() => {
  vi.restoreAllMocks()
})

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

function setProcessStdinTty(value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value})
  return () => {
    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor)
      return
    }

    delete (process.stdin as {isTTY?: boolean}).isTTY
  }
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
        scope: 'app',
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
    expect(store).toHaveBeenCalledWith('devnet', 'jwt-token', {mode: 'env-or-keychain-jwt', scope: 'app'})
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'env-or-keychain-jwt',
        network: 'devnet',
        persisted: true,
        scope: 'app',
        source: 'memory',
      },
      success: true,
    }))
  })

  it('stores explicit operator credentials in the separate operator scope', async () => {
    const store = vi.fn().mockResolvedValue(undefined)

    class TestAuthLogin extends AuthLogin {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
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
      '--scope',
      'operator',
      '--token',
      'operator-token',
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(store).toHaveBeenCalledWith('devnet', 'operator-token', {mode: 'env-or-keychain-jwt', scope: 'operator'})
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'env-or-keychain-jwt',
        network: 'devnet',
        persisted: true,
        scope: 'operator',
        source: 'keychain',
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
          {
            app: {authenticated: true, envVarName: 'CANTONCTL_JWT_DEVNET', mode: 'env-or-keychain-jwt', source: 'memory'},
            network: 'devnet',
            operator: {
              authenticated: true,
              envVarName: 'CANTONCTL_OPERATOR_TOKEN_DEVNET',
              mode: 'env-or-keychain-jwt',
              required: true,
              source: 'memory',
            },
          },
          {
            app: {authenticated: true, envVarName: 'CANTONCTL_JWT_LOCAL', mode: 'bearer-token', source: 'generated'},
            network: 'local',
            operator: {
              authenticated: true,
              envVarName: 'CANTONCTL_OPERATOR_TOKEN_LOCAL',
              mode: 'bearer-token',
              required: false,
              source: 'generated',
            },
          },
        ]),
      },
      success: true,
    }))
  })

  it('marks scan-only remote profiles as not requiring operator credentials in auth status', async () => {
    class TestAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn().mockResolvedValue(null),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return {
          networks: {
            observer: {auth: 'jwt', type: 'remote', url: 'https://ledger.example.com'},
          },
          networkProfiles: {
            observer: 'observer',
          },
          profiles: {
            observer: {
              experimental: false,
              kind: 'remote-sv-network',
              name: 'observer',
              services: {
                auth: {issuer: 'https://login.example.com', kind: 'oidc'},
                scan: {url: 'https://scan.example.com'},
              },
            },
          },
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }
    }

    const result = await captureOutput(() => TestAuthStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        networks: [
          {
            app: {authenticated: false, envVarName: 'CANTONCTL_JWT_OBSERVER', mode: 'env-or-keychain-jwt', source: null},
            network: 'observer',
            operator: {
              authenticated: false,
              envVarName: 'CANTONCTL_OPERATOR_TOKEN_OBSERVER',
              mode: 'env-or-keychain-jwt',
              required: false,
              source: null,
            },
          },
        ],
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
      data: {network: 'devnet', removed: true, scope: 'app'},
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

  it('runs build watch mode and cleans up interactive input', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    const build = vi.fn().mockResolvedValue({
      cached: false,
      darPath: '/repo/.daml/dist/demo.dar',
      durationMs: 25,
      success: true,
    })
    const restoreStdinTty = setProcessStdinTty(true)
    const originalSetRawMode = (process.stdin as {setRawMode?: (value: boolean) => void}).setRawMode
    const originalResume = process.stdin.resume.bind(process.stdin)
    const originalPause = process.stdin.pause.bind(process.stdin)
    const originalOn = process.stdin.on.bind(process.stdin)
    const setRawMode = vi.fn()
    const resume = vi.fn()
    const pause = vi.fn()

    ;(process.stdin as {setRawMode?: (value: boolean) => void}).setRawMode = setRawMode
    process.stdin.resume = resume as typeof process.stdin.resume
    process.stdin.pause = pause as typeof process.stdin.pause
    process.stdin.on = vi.fn((event: string, handler: (data: Buffer) => void) => {
      if (event === 'data') {
        setTimeout(() => {
          handler(Buffer.from('x'))
          handler(Buffer.from('q'))
        }, 0)
      }

      return process.stdin
    }) as unknown as typeof process.stdin.on

    class TestBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build,
          buildWithCodegen: vi.fn(),
          watch: vi.fn().mockResolvedValue({stop}),
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

    try {
      const result = await captureOutput(() => TestBuild.run(['--watch'], {root: CLI_ROOT}))
      expect(result.error).toBeUndefined()
      expect(build).toHaveBeenCalledWith({force: false, projectDir: '/repo'})
      expect(stop).toHaveBeenCalledTimes(1)
      expect(setRawMode).toHaveBeenCalledWith(true)
      expect(setRawMode).toHaveBeenCalledWith(false)
      expect(resume).toHaveBeenCalledTimes(1)
      expect(pause).toHaveBeenCalledTimes(1)
      expect(result.stdout).toContain('Starting watch mode...')
      expect(result.stdout).toContain('Watch mode stopped')
    } finally {
      restoreStdinTty()
      ;(process.stdin as {setRawMode?: (value: boolean) => void}).setRawMode = originalSetRawMode
      process.stdin.resume = originalResume
      process.stdin.pause = originalPause
      process.stdin.on = originalOn
    }
  })

  it('handles build codegen, cached results, and failures', async () => {
    class CodegenBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn().mockResolvedValue({
            cached: false,
            darPath: '/repo/.daml/dist/demo.dar',
            durationMs: 20,
            success: true,
          }),
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

    class CachedBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            cached: true,
            darPath: undefined,
            durationMs: 10,
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

    class HandledBuildError extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.BUILD_DAML_ERROR, {suggestion: 'fix daml'})),
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

    class UnexpectedBuildError extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockRejectedValue(new Error('build boom')),
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

    class JsonWatchBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            cached: true,
            darPath: '/repo/.daml/dist/demo.dar',
            durationMs: 8,
            success: true,
          }),
          buildWithCodegen: vi.fn(),
          watch: vi.fn().mockResolvedValue({stop: vi.fn().mockResolvedValue(undefined)}),
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

    class UndefinedCachedBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            cached: undefined,
            darPath: undefined,
            durationMs: 11,
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
    }

    const codegen = await captureOutput(() => CodegenBuild.run(['--codegen'], {root: CLI_ROOT}))
    expect(codegen.error).toBeUndefined()
    expect(codegen.stdout).toContain('TypeScript bindings generated')
    expect(codegen.stdout).toContain('DAR: .daml/dist/demo.dar')

    const cached = await captureOutput(() => CachedBuild.run([], {root: CLI_ROOT}))
    expect(cached.error).toBeUndefined()
    expect(cached.stdout).toContain('Build up to date (cached)')

    const originalProcessOn = process.on.bind(process)
    process.on = vi.fn(((event: string, handler: () => Promise<void>) => {
      if (event === 'SIGINT') {
        setTimeout(() => {
          void handler()
        }, 0)
      }

      return process
    }) as typeof process.on)

    try {
      const watchJson = await captureOutput(() => JsonWatchBuild.run(['--watch', '--json'], {root: CLI_ROOT}))
      expect(watchJson.error).toBeUndefined()
    } finally {
      process.on = originalProcessOn
    }

    const undefinedCached = await captureOutput(() => UndefinedCachedBuild.run(['--json'], {root: CLI_ROOT}))
    expect(undefinedCached.error).toBeUndefined()
    expect(parseJson(undefinedCached.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({cached: false}),
      success: true,
    }))

    const handled = await captureOutput(() => HandledBuildError.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.BUILD_DAML_ERROR}),
      success: false,
    }))

    await expect(UnexpectedBuildError.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('build boom')
  })

  it('reports test command failures and unexpected errors', async () => {
    class FailedTest extends Test {
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
            durationMs: 15,
            output: 'failure output',
            passed: false,
            success: false,
          }),
        }
      }
    }

    class HandledTestError extends Test {
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
          run: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.TEST_EXECUTION_FAILED, {suggestion: 'rerun'})),
        }
      }
    }

    class UnexpectedTestError extends Test {
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
          run: vi.fn().mockRejectedValue(new Error('test boom')),
        }
      }
    }

    const failed = await captureOutput(() => FailedTest.run([], {root: CLI_ROOT}))
    expect(failed.error).toBeDefined()
    expect(failed.stdout).toContain('failure output')

    const handled = await captureOutput(() => HandledTestError.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.TEST_EXECUTION_FAILED}),
      success: false,
    }))

    await expect(UnexpectedTestError.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('test boom')
  })

  it('supports interactive init flows and helper methods', async () => {
    class InteractiveInit extends Init {
      protected override async promptInteractive() {
        return {name: 'wizard-app', template: 'splice-scan-reader' as const}
      }

      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: 'splice-scan-reader'}) {
        return {
          files: ['cantonctl.yaml'],
          projectDir: options.dir,
          template: options.template,
        }
      }
    }

    class UnexpectedInitError extends Init {
      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(): never {
        throw new Error('init boom')
      }
    }

    class NonSpliceInit extends Init {
      protected override async promptInteractive() {
        return {name: 'custom-app', template: 'custom-template' as never}
      }

      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: string}) {
        return {
          files: ['cantonctl.yaml'],
          projectDir: options.dir,
          template: options.template as never,
        }
      }
    }

    class InitHarness extends Init {
      public async callLoadInteractivePrompts() {
        return this.loadInteractivePrompts()
      }

      public async callPromptInteractive() {
        return this.promptInteractive()
      }

      public callResolveProjectDir(projectName: string) {
        return this.resolveProjectDir(projectName)
      }

      public callScaffoldProject(options: {dir: string; name: string; template: 'splice-dapp-sdk'}) {
        return this.scaffoldProject(options)
      }

      protected override async loadInteractivePrompts() {
        return {
          input: vi.fn().mockResolvedValue('prompted-app'),
          select: vi.fn().mockResolvedValue('splice-token-app'),
        }
      }

      public async run(): Promise<void> {}
    }

    class DefaultPromptsHarness extends Init {
      public async callLoadInteractivePrompts() {
        return this.loadInteractivePrompts()
      }

      public async run(): Promise<void> {}
    }

    class ValidationHarness extends Init {
      public async callPromptInteractive() {
        return this.promptInteractive()
      }

      protected override async loadInteractivePrompts() {
        return {
          input: vi.fn().mockImplementation(async (options: {
            message: string
            validate: (value: string) => string | true
          }) => {
            expect(options.validate('')).toBe('Project name is required')
            expect(options.validate('bad name!')).toBe('Use only letters, numbers, hyphens, and underscores')
            expect(options.validate('good_name')).toBe(true)
            return 'prompted-app'
          }),
          select: vi.fn().mockResolvedValue('splice-token-app'),
        }
      }

      public async run(): Promise<void> {}
    }

    const interactive = await captureOutput(() => InteractiveInit.run([], {root: CLI_ROOT}))
    expect(interactive.error).toBeUndefined()
    expect(interactive.stdout).toContain('Creating companion-ready project: wizard-app')
    expect(interactive.stdout).toContain('Template: splice-scan-reader')

    const nonSplice = await captureOutput(() => NonSpliceInit.run([], {root: CLI_ROOT}))
    expect(nonSplice.error).toBeUndefined()
    expect(nonSplice.stdout).not.toContain('cantonctl compat check splice-devnet')

    await expect(UnexpectedInitError.run(['demo-app', '--json'], {root: CLI_ROOT})).rejects.toThrow('init boom')

    const promptsHarness = new InitHarness([], {} as never)
    const promptsModule = await new DefaultPromptsHarness([], {} as never).callLoadInteractivePrompts()
    expect(promptsModule).toEqual(expect.objectContaining({
      input: expect.any(Function),
      select: expect.any(Function),
    }))
    await expect(new ValidationHarness([], {} as never).callPromptInteractive()).resolves.toEqual({
      name: 'prompted-app',
      template: 'splice-token-app',
    })
    expect(promptsHarness.callResolveProjectDir('demo')).toBe(path.resolve('demo'))

    const rootDir = fs.mkdtempSync(path.join(tmpdir(), 'cantonctl-init-helper-'))
    const projectDir = path.join(rootDir, 'helper-app')
    try {
      const result = promptsHarness.callScaffoldProject({
        dir: projectDir,
        name: 'helper-app',
        template: 'splice-dapp-sdk',
      })
      expect(result.projectDir).toBe(projectDir)
      expect(fs.existsSync(path.join(projectDir, 'cantonctl.yaml'))).toBe(true)
    } finally {
      fs.rmSync(rootDir, {force: true, recursive: true})
    }
  })

  it('covers auth login prompts, warnings, and helper methods', async () => {
    class HumanFallbackLogin extends AuthLogin {
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

    class PromptFailureLogin extends AuthLogin {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createReadlineInterface(): readline.Interface {
        return {
          close: vi.fn(),
          question: vi.fn((_: string, callback: (answer: string) => void) => callback('   ')),
        } as unknown as readline.Interface
      }
    }

    const store = vi.fn().mockResolvedValue(undefined)
    class PromptedLogin extends AuthLogin {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
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
          getVersion: vi.fn().mockRejectedValue(new Error('cannot reach ledger')),
        } as never
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createReadlineInterface(): readline.Interface {
        return {
          close: vi.fn(),
          question: vi.fn((_: string, callback: (answer: string) => void) => callback('jwt-token')),
        } as unknown as readline.Interface
      }
    }

    class LoginHarness extends AuthLogin {
      public async callCreateBackend() {
        return this.createBackend()
      }

      public async callLoadCommandConfig() {
        return this.loadCommandConfig()
      }

      public callCreateReadlineInterface(options: readline.ReadLineOptions) {
        return this.createReadlineInterface(options)
      }

      public async run(): Promise<void> {}
    }

    class ModeOverrideLogin extends AuthLogin {
      static capturedBaseUrls: string[] = []

      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn().mockResolvedValue(undefined),
        }
      }

      protected override createLedgerClient(options: {baseUrl: string}) {
        ModeOverrideLogin.capturedBaseUrls.push(options.baseUrl)
        return {
          getVersion: vi.fn().mockResolvedValue({version: '3.4.11'}),
        } as never
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        const config = createConfig()
        return {
          ...config,
          networks: {
            ...config.networks,
            devnet: {'json-api-port': 9100, auth: 'jwt', type: 'remote'},
          },
        }
      }
    }

    class UnexpectedLoginError extends AuthLogin {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override async createBackend(): Promise<{backend: KeychainBackend; isKeychain: boolean}> {
        throw new Error('login boom')
      }
    }

    class QuietLogin extends AuthLogin {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn().mockResolvedValue(undefined),
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

    const fallback = await captureOutput(() => HumanFallbackLogin.run(['local'], {root: CLI_ROOT}))
    const fallbackOutput = `${fallback.stdout}${fallback.stderr ?? ''}`
    expect(fallback.error).toBeUndefined()
    expect(fallbackOutput).toContain('Resolved auth profile for local: bearer-token (app)')
    expect(fallbackOutput).toContain('Bearer-token mode uses an explicitly supplied token')
    expect(fallbackOutput).toContain('Using local fallback auth for local')

    const missingToken = await captureOutput(() => PromptFailureLogin.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(missingToken.error).toBeDefined()
    expect(parseJson(missingToken.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.DEPLOY_AUTH_FAILED}),
      success: false,
    }))

    const prompted = await captureOutput(() => PromptedLogin.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(prompted.error).toBeUndefined()
    expect(store).toHaveBeenCalledWith('devnet', 'jwt-token', {mode: 'env-or-keychain-jwt', scope: 'app'})
    expect(parseJson(prompted.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'env-or-keychain-jwt',
        network: 'devnet',
        persisted: true,
        scope: 'app',
        source: 'keychain',
      },
      success: true,
      warnings: ['Could not verify connectivity to devnet. Token stored anyway.'],
    }))

    ModeOverrideLogin.capturedBaseUrls = []
    const modeOverrideResult = await captureOutput(() => ModeOverrideLogin.run([
      'devnet',
      '--token',
      'jwt-token',
      '--mode',
      'bearer-token',
      '--json',
    ], {root: CLI_ROOT}))
    expect(modeOverrideResult.error).toBeUndefined()
    expect(ModeOverrideLogin.capturedBaseUrls).toEqual(['http://localhost:9100'])
    expect(parseJson(modeOverrideResult.stdout)).toEqual(expect.objectContaining({
      success: true,
      warnings: expect.arrayContaining([
        expect.stringContaining('Operator override: using auth mode "bearer-token"'),
        expect.stringContaining('Bearer-token mode requires explicit remote credentials'),
      ]),
    }))

    const quiet = await captureOutput(() => QuietLogin.run([
      'devnet',
      '--token',
      'jwt-token',
      '--json',
    ], {root: CLI_ROOT}))
    expect(quiet.error).toBeUndefined()
    expect(parseJson(quiet.stdout)).toEqual({
      data: {
        mode: 'env-or-keychain-jwt',
        network: 'devnet',
        persisted: true,
        scope: 'app',
        source: 'keychain',
      },
      success: true,
    })

    await expect(UnexpectedLoginError.run(['devnet', '--token', 'jwt-token', '--json'], {root: CLI_ROOT}))
      .rejects.toThrow('login boom')

    const backend = createBackend()
    const createBackendSpy = vi
      .spyOn(keytarBackendModule, 'createBackendWithFallback')
      .mockResolvedValue({backend, isKeychain: false})
    const loadConfigSpy = vi
      .spyOn(configModule, 'loadConfig')
      .mockResolvedValue(createConfig())

    const harness = new LoginHarness([], {} as never)
    await expect(harness.callCreateBackend()).resolves.toEqual({backend, isKeychain: false})
    await expect(harness.callLoadCommandConfig()).resolves.toEqual(createConfig())
    const rl = harness.callCreateReadlineInterface({
      input: process.stdin,
      output: process.stderr,
    })
    expect(rl).toEqual(expect.objectContaining({close: expect.any(Function)}))
    rl.close()
    expect(createBackendSpy).toHaveBeenCalledTimes(1)
    expect(loadConfigSpy).toHaveBeenCalledTimes(1)
  })

  it('covers auth logout status messages and helper methods', async () => {
    class HumanLogout extends AuthLogout {
      protected override async createBackend() {
        return {backend: createBackend()}
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

    class HandledLogoutError extends AuthLogout {
      protected override async createBackend(): Promise<{backend: KeychainBackend}> {
        throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'login first'})
      }
    }

    class UnexpectedLogoutError extends AuthLogout {
      protected override async createBackend(): Promise<{backend: KeychainBackend}> {
        throw new Error('logout boom')
      }
    }

    class LogoutHarness extends AuthLogout {
      public async callCreateBackend() {
        return this.createBackend()
      }

      public async run(): Promise<void> {}
    }

    const result = await captureOutput(() => HumanLogout.run(['devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('No app credentials stored for devnet')

    const handled = await captureOutput(() => HandledLogoutError.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    await expect(UnexpectedLogoutError.run(['devnet', '--json'], {root: CLI_ROOT})).rejects.toThrow('logout boom')

    const backend = createBackend()
    const createBackendSpy = vi
      .spyOn(keytarBackendModule, 'createBackendWithFallback')
      .mockResolvedValue({backend, isKeychain: false})
    const harness = new LogoutHarness([], {} as never)
    await expect(harness.callCreateBackend()).resolves.toEqual(expect.objectContaining({backend}))
    expect(createBackendSpy).toHaveBeenCalledTimes(1)
  })

  it('covers auth status rendering, warnings, and helper methods', async () => {
    class EmptyStatus extends AuthStatus {
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
        return {
          ...createConfig(),
          networks: undefined,
        }
      }
    }

    class HumanStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: false}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn().mockImplementation(async (network: string) => {
            if (network === 'devnet') {
              return {
                mode: 'bearer-token',
                source: 'stored',
                storedAt: '2026-04-05T00:00:00Z',
                token: 'stored-token',
              }
            }

            if (network === 'local') {
              return {
                mode: 'bearer-token',
                source: 'stored',
                storedAt: '2026-04-05T00:00:00Z',
                token: 'stored-local',
              }
            }

            if (network === 'testnet') {
              return {
                source: 'env',
                token: 'env-token',
              }
            }

            return null
          }),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        const config = createConfig()
        return {
          ...config,
          networks: {
            ...config.networks,
            prod: {auth: 'jwt', type: 'remote', url: 'https://ledger.prod.example.com'},
            testnet: {auth: 'jwt', type: 'remote', url: 'https://ledger.testnet.example.com'},
          },
          networkProfiles: {
            ...config.networkProfiles,
            prod: 'splice-prod',
            testnet: 'splice-testnet',
          },
          profiles: {
            ...config.profiles,
            'splice-prod': {
              experimental: false,
              kind: 'remote-validator',
              name: 'splice-prod',
              services: {
                auth: {issuer: 'https://login.prod.example.com', kind: 'oidc'},
                ledger: {url: 'https://ledger.prod.example.com'},
                validator: {url: 'https://validator.prod.example.com'},
              },
            },
            'splice-testnet': {
              experimental: false,
              kind: 'remote-validator',
              name: 'splice-testnet',
              services: {
                auth: {issuer: 'https://login.testnet.example.com', kind: 'oidc'},
                ledger: {url: 'https://ledger.testnet.example.com'},
                validator: {url: 'https://validator.testnet.example.com'},
              },
            },
          },
        }
      }
    }

    class HandledStatusError extends AuthStatus {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'add config'})
      }
    }

    class UnexpectedStatusError extends AuthStatus {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('status boom')
      }
    }

    class StatusHarness extends AuthStatus {
      public async callCreateBackend() {
        return this.createBackend()
      }

      public async callLoadCommandConfig() {
        return this.loadCommandConfig()
      }

      public async run(): Promise<void> {}
    }

    class KeychainStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn().mockImplementation(async (network: string) => (
            network === 'local'
              ? {source: 'env', token: 'env-token'}
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

    const empty = await captureOutput(() => EmptyStatus.run([], {root: CLI_ROOT}))
    expect(empty.error).toBeUndefined()
    expect(empty.stdout).toContain('No networks configured in cantonctl.yaml')

    const human = await captureOutput(() => HumanStatus.run([], {root: CLI_ROOT}))
    const humanOutput = `${human.stdout}${human.stderr ?? ''}`
    expect(human.error).toBeUndefined()
    expect(humanOutput).toContain('devnet')
    expect(humanOutput).toContain('local')
    expect(humanOutput).toContain('testnet')
    expect(humanOutput).toContain('prod')
    expect(humanOutput).toContain('Stored credential mode "bearer-token" overrides the inferred "env-or-keychain-jwt" profile.')
    expect(humanOutput).toContain('env')
    expect(humanOutput).toContain('-')

    const handled = await captureOutput(() => HandledStatusError.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    const keychain = await captureOutput(() => KeychainStatus.run(['--json'], {root: CLI_ROOT}))
    expect(keychain.error).toBeUndefined()
    expect(parseJson(keychain.stdout)).toEqual(expect.objectContaining({
      data: {
        networks: expect.arrayContaining([
          {
            app: {authenticated: true, envVarName: 'CANTONCTL_JWT_LOCAL', mode: 'bearer-token', source: 'env'},
            network: 'local',
            operator: {
              authenticated: true,
              envVarName: 'CANTONCTL_OPERATOR_TOKEN_LOCAL',
              mode: 'bearer-token',
              required: false,
              source: 'env',
            },
          },
        ]),
      },
      success: true,
    }))

    await expect(UnexpectedStatusError.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('status boom')

    const backend = createBackend()
    const createBackendSpy = vi
      .spyOn(keytarBackendModule, 'createBackendWithFallback')
      .mockResolvedValue({backend, isKeychain: true})
    const loadConfigSpy = vi
      .spyOn(configModule, 'loadConfig')
      .mockResolvedValue(createConfig())
    const harness = new StatusHarness([], {} as never)
    await expect(harness.callCreateBackend()).resolves.toEqual({backend, isKeychain: true})
    await expect(harness.callLoadCommandConfig()).resolves.toEqual(createConfig())
    expect(createBackendSpy).toHaveBeenCalledTimes(1)
    expect(loadConfigSpy).toHaveBeenCalledTimes(1)
  })

  it('wires build helper factories through the default modules', async () => {
    class BuildHarness extends Build {
      public callCreateRunner() {
        return this.createRunner()
      }

      public callCreateSdk(runner: ProcessRunner) {
        return this.createSdk(runner)
      }

      public callCreateWatcher() {
        return this.createWatcher()
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public async run(): Promise<void> {}
    }

    const runner = createRunner()
    const sdk = createSdk()
    const createRunnerSpy = vi
      .spyOn(processRunnerModule, 'createProcessRunner')
      .mockReturnValue(runner)
    const createSdkSpy = vi
      .spyOn(damlModule, 'createDamlSdk')
      .mockReturnValue(sdk)
    const harness = new BuildHarness([], {} as never)
    const createdRunner = harness.callCreateRunner()
    expect(createdRunner).toBe(runner)
    expect(harness.callCreateSdk(createdRunner)).toBe(sdk)
    const watchRoot = fs.mkdtempSync(path.join(tmpdir(), 'cantonctl-build-watcher-'))
    try {
      const watcher = harness.callCreateWatcher()(watchRoot, {})
      await watcher.close()
    } finally {
      fs.rmSync(watchRoot, {force: true, recursive: true})
    }
    expect(harness.callGetProjectDir()).toBe(process.cwd())
    expect(createRunnerSpy).toHaveBeenCalledTimes(1)
    expect(createSdkSpy).toHaveBeenCalledWith({runner})
  })
})
