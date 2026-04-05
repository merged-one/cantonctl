import {captureOutput} from '@oclif/test'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
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

function combinedOutput(result: {stderr: string; stdout: string}): string {
  return `${result.stdout}\n${result.stderr}`
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

  it('prints cached and codegen build results in human mode', async () => {
    class CachedBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            cached: true,
            darPath: '/repo/.daml/dist/demo.dar',
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

    class CodegenBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn().mockResolvedValue({
            cached: false,
            darPath: '/repo/.daml/dist/demo.dar',
            durationMs: 25,
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

    const cached = await captureOutput(() => CachedBuild.run([], {root: CLI_ROOT}))
    expect(cached.error).toBeUndefined()
    expect(cached.stdout).toContain('Build up to date (cached)')

    const codegen = await captureOutput(() => CodegenBuild.run(['--codegen'], {root: CLI_ROOT}))
    expect(codegen.error).toBeUndefined()
    expect(codegen.stdout).toContain('Build successful')
    expect(codegen.stdout).toContain('TypeScript bindings generated')
    expect(codegen.stdout).toContain('DAR: .daml/dist/demo.dar')
  })

  it('runs build watch mode and shuts down from interactive input', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    let stdinHandler: ((data: Buffer) => Promise<void>) | undefined
    const originalIsTTY = process.stdin.isTTY
    const originalSetRawMode = process.stdin.setRawMode
    const originalResume = process.stdin.resume
    const originalPause = process.stdin.pause
    const originalOn = process.stdin.on
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process)

    ;(process.stdin as typeof process.stdin & {isTTY: boolean}).isTTY = true
    process.stdin.setRawMode = vi.fn() as never
    process.stdin.resume = vi.fn()
    process.stdin.pause = vi.fn()
    process.stdin.on = vi.fn((event: string, handler: (data: Buffer) => Promise<void>) => {
      if (event === 'data') {
        stdinHandler = handler
      }

      return process.stdin
    }) as never

    class WatchBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockImplementation(async () => {
            await stdinHandler?.(Buffer.from('x'))
            await stdinHandler?.(Buffer.from('q'))
            return {
              cached: false,
              darPath: '/repo/.daml/dist/demo.dar',
              durationMs: 25,
              success: true,
            }
          }),
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
      const result = await captureOutput(() => WatchBuild.run(['--watch'], {root: CLI_ROOT}))
      expect(result.error).toBeUndefined()
      expect(stop).toHaveBeenCalled()
      expect(combinedOutput(result)).toContain('Starting watch mode...')
      expect(combinedOutput(result)).toContain('Build successful')
      expect(combinedOutput(result)).toContain('Stopping watch mode...')
      expect(combinedOutput(result)).toContain('Watch mode stopped')
      expect(process.stdin.setRawMode).toHaveBeenNthCalledWith(1, true)
      expect(process.stdin.setRawMode).toHaveBeenNthCalledWith(2, false)
      expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    } finally {
      ;(process.stdin as typeof process.stdin & {isTTY: boolean}).isTTY = originalIsTTY
      process.stdin.setRawMode = originalSetRawMode
      process.stdin.resume = originalResume
      process.stdin.pause = originalPause
      process.stdin.on = originalOn
      processOnSpy.mockRestore()
    }
  })

  it('reports cached rebuilds in watch mode', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    let stdinHandler: ((data: Buffer) => Promise<void>) | undefined
    const originalIsTTY = process.stdin.isTTY
    const originalSetRawMode = process.stdin.setRawMode
    const originalResume = process.stdin.resume
    const originalPause = process.stdin.pause
    const originalOn = process.stdin.on

    ;(process.stdin as typeof process.stdin & {isTTY: boolean}).isTTY = true
    process.stdin.setRawMode = vi.fn() as never
    process.stdin.resume = vi.fn()
    process.stdin.pause = vi.fn()
    process.stdin.on = vi.fn((event: string, handler: (data: Buffer) => Promise<void>) => {
      if (event === 'data') {
        stdinHandler = handler
      }

      return process.stdin
    }) as never

    class CachedWatchBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockImplementation(async () => {
            await stdinHandler?.(Buffer.from('\u0003'))
            return {
              cached: true,
              darPath: '/repo/.daml/dist/demo.dar',
              durationMs: 25,
              success: true,
            }
          }),
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
    }

    try {
      const result = await captureOutput(() => CachedWatchBuild.run(['--watch'], {root: CLI_ROOT}))
      expect(result.error).toBeUndefined()
      expect(result.stdout).toContain('Build up to date (cached)')
    } finally {
      ;(process.stdin as typeof process.stdin & {isTTY: boolean}).isTTY = originalIsTTY
      process.stdin.setRawMode = originalSetRawMode
      process.stdin.resume = originalResume
      process.stdin.pause = originalPause
      process.stdin.on = originalOn
    }
  })

  it('executes the default chokidar watcher factory', async () => {
    class WatcherHarness extends Build {
      public createDefaultWatcher() {
        return this.createWatcher()
      }
    }

    const rootDir = mkdtempSync(join(tmpdir(), 'cantonctl-build-watcher-'))
    const watchedFile = join(rootDir, 'watched.daml')
    writeFileSync(watchedFile, 'template Demo where')

    try {
      const watcher = new WatcherHarness([], {} as never).createDefaultWatcher()(watchedFile, {ignoreInitial: true})
      await watcher.close()
    } finally {
      rmSync(rootDir, {force: true, recursive: true})
    }
  })

  it('handles json watch mode and ctrl-c shutdowns without interactive stdin setup', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    const handlers = new Map<string, () => Promise<void>>()
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      handlers.set(String(event), handler as () => Promise<void>)
      return process
    })
    const originalIsTTY = process.stdin.isTTY

    ;(process.stdin as typeof process.stdin & {isTTY: boolean}).isTTY = true

    class JsonWatchBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockImplementation(async () => {
            await handlers.get('SIGINT')?.()
            return {
              cached: false,
              darPath: undefined,
              durationMs: 25,
              success: true,
            }
          }),
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
    }

    class UndefinedCachedBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            cached: undefined,
            darPath: undefined,
            durationMs: 12,
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

    try {
      const watchResult = await captureOutput(() => JsonWatchBuild.run(['--watch', '--json'], {root: CLI_ROOT}))
      expect(watchResult.error).toBeUndefined()
      expect(stop).toHaveBeenCalled()
      expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
      expect(watchResult.stdout).not.toContain('Starting watch mode...')

      const undefinedCached = await captureOutput(() => UndefinedCachedBuild.run(['--json'], {root: CLI_ROOT}))
      expect(undefinedCached.error).toBeUndefined()
      expect(parseJson(undefinedCached.stdout)).toEqual(expect.objectContaining({
        data: expect.objectContaining({
          cached: false,
        }),
        success: true,
      }))
    } finally {
      ;(process.stdin as typeof process.stdin & {isTTY: boolean}).isTTY = originalIsTTY
      processOnSpy.mockRestore()
    }
  })

  it('serializes structured build failures and rethrows unexpected ones', async () => {
    class BrokenBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.SDK_COMMAND_FAILED, {
            suggestion: 'fix build',
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

    class UnexpectedBuild extends Build {
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

    const handled = await captureOutput(() => BrokenBuild.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.SDK_COMMAND_FAILED,
        suggestion: 'fix build',
      }),
      success: false,
    }))

    await expect(UnexpectedBuild.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('build boom')
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

  it('prints failing test output in human mode and exits non-zero', async () => {
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
            output: 'failing script output',
            passed: false,
            success: false,
          }),
        }
      }
    }

    const result = await captureOutput(() => TestCommand.run([], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(combinedOutput(result)).toContain('Some tests failed')
    expect(combinedOutput(result)).toContain('failing script output')
  })

  it('serializes structured test failures', async () => {
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
          run: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.SDK_COMMAND_FAILED, {
            suggestion: 'fix tests',
          })),
        }
      }
    }

    const result = await captureOutput(() => TestCommand.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.SDK_COMMAND_FAILED,
        suggestion: 'fix tests',
      }),
      success: false,
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

  it('runs init interactively when no project name is supplied', async () => {
    class TestInit extends Init {
      protected override async promptInteractive() {
        return {name: 'wizard-app', template: 'splice-scan-reader' as Template}
      }

      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: Template}) {
        return {
          files: ['cantonctl.yaml', 'scripts/read-scan-updates.mjs'],
          projectDir: options.dir,
          template: options.template,
        }
      }
    }

    const result = await captureOutput(() => TestInit.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        projectDir: '/tmp/wizard-app',
        template: 'splice-scan-reader',
      }),
      success: true,
    }))
  })

  it('validates interactive prompt helpers and dynamically loads the prompt module', async () => {
    class PromptHarness extends Init {
      public async callLoadInteractivePrompts() {
        return this.loadInteractivePrompts()
      }

      public async callPromptInteractive() {
        return this.promptInteractive()
      }

      protected override async loadInteractivePrompts() {
        return {
          input: vi.fn().mockImplementation(async (options: {validate: (value: string) => string | true}) => {
            expect(options.validate('')).toBe('Project name is required')
            expect(options.validate('bad name!')).toBe('Use only letters, numbers, hyphens, and underscores')
            expect(options.validate('good_name')).toBe(true)
            return 'good_name'
          }),
          select: vi.fn().mockResolvedValue('splice-token-app'),
        }
      }
    }

    const loaded = await new Init([], {} as never).loadInteractivePrompts()
    expect(loaded).toEqual(expect.objectContaining({
      input: expect.any(Function),
      select: expect.any(Function),
    }))

    await expect(new PromptHarness([], {} as never).callPromptInteractive()).resolves.toEqual({
      name: 'good_name',
      template: 'splice-token-app',
    })
  })

  it('uses the default init scaffold helper to create a project tree', () => {
    class ScaffoldHarness extends Init {
      public callScaffoldProject(projectDir: string) {
        return this.scaffoldProject({dir: projectDir, name: 'scaffold-app', template: 'splice-dapp-sdk'})
      }
    }

    const rootDir = mkdtempSync(join(tmpdir(), 'cantonctl-init-scaffold-'))
    const projectDir = join(rootDir, 'scaffold-app')

    try {
      const result = new ScaffoldHarness([], {} as never).callScaffoldProject(projectDir)
      expect(result.projectDir).toBe(projectDir)
      expect(result.files).toContain('cantonctl.yaml')
    } finally {
      rmSync(rootDir, {force: true, recursive: true})
    }
  })

  it('omits the compat next-step when a non-splice template is injected through the instance path', async () => {
    class LooseTemplateInit extends Init {
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

    const command = new LooseTemplateInit([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      args: {name: 'demo-app'},
      flags: {json: false, template: 'custom-template'},
    } as never)

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeUndefined()
    expect(result.stdout).not.toContain('cantonctl compat check splice-devnet')
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

  it('prints local fallback auth messaging in human mode', async () => {
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

    const result = await captureOutput(() => TestAuthLogin.run(['local'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Resolved auth profile for local: bearer-token')
    expect(result.stdout).toContain('This profile relies on the built-in local fallback token path.')
    expect(result.stdout).toContain('Using local fallback auth for local')
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

  it('prompts for remote tokens in human mode and surfaces verification and storage warnings', async () => {
    const store = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn()

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
          getVersion: vi.fn().mockRejectedValue(new Error('connect failed')),
        } as never
      }

      protected override createReadlineInterface() {
        return {
          close,
          question: (_prompt: string, callback: (answer: string) => void) => callback('prompted-token'),
        } as never
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run([
      'devnet',
      '--mode',
      'bearer-token',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(close).toHaveBeenCalled()
    expect(store).toHaveBeenCalledWith('devnet', 'prompted-token', {mode: 'bearer-token'})
    expect(combinedOutput(result)).toContain('Resolved auth profile for devnet: bearer-token')
    expect(combinedOutput(result)).toContain('Operator override: using auth mode "bearer-token"')
    expect(combinedOutput(result)).toContain('Could not verify connectivity to devnet. Token stored anyway.')
    expect(combinedOutput(result)).toContain('OS keychain unavailable')
    expect(combinedOutput(result)).toContain('Authenticated with devnet')
  })

  it('uses network port fallback and keychain persistence for remote auth login', async () => {
    const store = vi.fn().mockResolvedValue(undefined)

    class PortFallbackAuthLogin extends AuthLogin {
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

      protected override createLedgerClient(options: {baseUrl: string; token: string}) {
        expect(options.baseUrl).toBe('http://localhost:9000')
        return {
          getVersion: vi.fn().mockResolvedValue({version: '3.4.11'}),
        } as never
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          networks: {
            ...createConfig().networks,
            devnet: {'json-api-port': 9000, type: 'remote'},
          },
          profiles: {
            ...createConfig().profiles,
            'splice-devnet': {
              ...createConfig().profiles!['splice-devnet'],
              services: {
                ...createConfig().profiles!['splice-devnet'].services,
                ledger: {},
              },
            },
          },
        }
      }
    }

    const result = await captureOutput(() => PortFallbackAuthLogin.run([
      'devnet',
      '--token',
      'jwt-token',
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(store).toHaveBeenCalledWith('devnet', 'jwt-token', {mode: 'env-or-keychain-jwt'})
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({source: 'keychain'}),
      success: true,
    }))
  })

  it('serializes missing prompted tokens as structured auth failures', async () => {
    class TestAuthLogin extends AuthLogin {
      protected override createReadlineInterface() {
        return {
          close: vi.fn(),
          question: (_prompt: string, callback: (answer: string) => void) => callback('   '),
        } as never
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.DEPLOY_AUTH_FAILED,
      }),
      success: false,
    }))
  })

  it('rethrows unexpected auth command failures', async () => {
    class BrokenAuthLogin extends AuthLogin {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('login boom')
      }
    }

    class BrokenAuthStatus extends AuthStatus {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('status boom')
      }
    }

    class BrokenAuthLogout extends AuthLogout {
      protected override async createBackend() {
        throw new Error('logout boom')
      }
    }

    await expect(BrokenAuthLogin.run(['devnet', '--json'], {root: CLI_ROOT})).rejects.toThrow('login boom')
    await expect(BrokenAuthStatus.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('status boom')
    await expect(BrokenAuthLogout.run(['devnet', '--json'], {root: CLI_ROOT})).rejects.toThrow('logout boom')
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

  it('renders empty and warning-rich auth status views and serializes warnings in json mode', async () => {
    class EmptyAuthStatus extends AuthStatus {
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
          ...createConfig(),
          networks: undefined,
        }
      }
    }

    const empty = await captureOutput(() => EmptyAuthStatus.run([], {root: CLI_ROOT}))
    expect(empty.error).toBeUndefined()
    expect(empty.stdout).toContain('No networks configured in cantonctl.yaml')

    class WarningAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn().mockImplementation(async (network: string) => {
            if (network === 'devnet') {
              return {mode: 'bearer-token', source: 'stored', storedAt: '2026-04-02T20:00:00Z', token: 'jwt'}
            }

            if (network === 'local') {
              return {mode: 'bearer-token', source: 'env', token: 'local-token'}
            }

            return null
          }),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const human = await captureOutput(() => WarningAuthStatus.run([], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(combinedOutput(human)).toContain('Stored credential mode "bearer-token" overrides the inferred "env-or-keychain-jwt" profile.')
    expect(combinedOutput(human)).toContain('devnet')
    expect(combinedOutput(human)).toContain('keychain')
    expect(combinedOutput(human)).toContain('env')

    const json = await captureOutput(() => WarningAuthStatus.run(['--json'], {root: CLI_ROOT}))
    expect(json.error).toBeUndefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      success: true,
      warnings: expect.arrayContaining([
        'devnet: Stored credential mode "bearer-token" overrides the inferred "env-or-keychain-jwt" profile.',
      ]),
    }))

    class MissingAndGeneratedStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn().mockImplementation(async (network: string) => {
            if (network === 'local') {
              return {mode: 'bearer-token', source: 'stored', token: 'sandbox'}
            }

            return null
          }),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const missing = await captureOutput(() => MissingAndGeneratedStatus.run([], {root: CLI_ROOT}))
    expect(missing.error).toBeUndefined()
    expect(combinedOutput(missing)).toContain('no')
    expect(combinedOutput(missing)).toContain('keychain')

    class EnvRemoteStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createBackend(), isKeychain: true}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn(),
          resolve: vi.fn(),
          resolveRecord: vi.fn().mockResolvedValue({mode: 'env-or-keychain-jwt', source: 'env', token: 'jwt'}),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          networks: {
            devnet: {type: 'remote', url: 'https://ledger.example.com'},
          },
          networkProfiles: {
            devnet: 'splice-devnet',
          },
        }
      }
    }

    const envRemote = await captureOutput(() => EnvRemoteStatus.run(['--json'], {root: CLI_ROOT}))
    expect(envRemote.error).toBeUndefined()
    expect(parseJson(envRemote.stdout)).toEqual(expect.objectContaining({
      data: {
        networks: [
          {authenticated: true, mode: 'env-or-keychain-jwt', network: 'devnet', source: 'env'},
        ],
      },
      success: true,
    }))
  })

  it('serializes structured auth status failures', async () => {
    class TestAuthStatus extends AuthStatus {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'fix auth config',
        })
      }
    }

    const result = await captureOutput(() => TestAuthStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
        suggestion: 'fix auth config',
      }),
      success: false,
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

  it('prints the no-op logout path in human mode and serializes structured logout failures', async () => {
    class MissingAuthLogout extends AuthLogout {
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

    const human = await captureOutput(() => MissingAuthLogout.run(['devnet'], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('No credentials stored for devnet')

    class BrokenAuthLogout extends AuthLogout {
      protected override async createBackend() {
        throw new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'fix logout backend',
        })
      }
    }

    const json = await captureOutput(() => BrokenAuthLogout.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(json.error).toBeDefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
        suggestion: 'fix logout backend',
      }),
      success: false,
    }))
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

  it('rethrows unexpected init failures', async () => {
    class TestInit extends Init {
      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(): never {
        throw new Error('init boom')
      }
    }

    await expect(TestInit.run(['demo-app', '--json'], {root: CLI_ROOT})).rejects.toThrow('init boom')
  })
})
