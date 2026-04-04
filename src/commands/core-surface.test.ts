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
  it('exposes clean and auth command metadata', () => {
    expect(Clean.description).toContain('Remove build artifacts')
    expect(Clean.examples).toEqual(expect.arrayContaining([
      '<%= config.bin %> clean --all',
      '<%= config.bin %> clean --json',
    ]))
    expect(Clean.flags).toEqual(expect.objectContaining({
      all: expect.any(Object),
      force: expect.any(Object),
      json: expect.any(Object),
    }))

    expect(AuthLogout.args).toEqual(expect.objectContaining({
      network: expect.any(Object),
    }))
    expect(AuthLogout.description).toContain('Remove stored credentials')
    expect(AuthLogout.examples).toEqual(expect.arrayContaining([
      '<%= config.bin %> auth logout devnet',
    ]))
    expect(AuthLogout.flags).toEqual(expect.objectContaining({
      json: expect.any(Object),
    }))

    expect(AuthStatus.description).toContain('Show authentication status')
    expect(AuthStatus.examples).toEqual(expect.arrayContaining([
      '<%= config.bin %> auth status --json',
    ]))
    expect(AuthStatus.flags).toEqual(expect.objectContaining({
      json: expect.any(Object),
    }))
  })

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

  it('handles interactive watch shutdown and cached rebuilds in human mode', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    const stdin = process.stdin as NodeJS.ReadStream & {
      isTTY?: boolean
      on: typeof process.stdin.on
      pause: () => void
      resume: () => void
      setRawMode: (value: boolean) => void
    }
    const originalIsTTY = stdin.isTTY
    const originalOn = stdin.on
    const originalPause = stdin.pause
    const originalResume = stdin.resume
    const originalSetRawMode = stdin.setRawMode
    let dataHandler: ((data: Buffer) => Promise<void>) | undefined
    let resolveDataHandler: ((handler: (data: Buffer) => Promise<void>) => void) | undefined
    const dataHandlerReady = new Promise<(data: Buffer) => Promise<void>>(resolve => {
      resolveDataHandler = resolve
    })
    const pause = vi.fn()
    const resume = vi.fn()
    const setRawMode = vi.fn()
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((..._args: Parameters<typeof process.on>) => process) as never)

    Object.defineProperty(stdin, 'isTTY', {configurable: true, value: true})
    stdin.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'data') {
        dataHandler = handler as (data: Buffer) => Promise<void>
        resolveDataHandler?.(dataHandler)
      }

      return stdin
    }) as never
    stdin.pause = pause
    stdin.resume = resume
    stdin.setRawMode = setRawMode

    try {
      const builder: Builder = {
        build: vi.fn().mockResolvedValue({
          cached: true,
          durationMs: 20,
          success: true,
        }),
        buildWithCodegen: vi.fn(),
        watch: vi.fn().mockResolvedValue({stop}),
      }
      const command = new Build([], {} as never)
      vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
        flags: {codegen: false, force: false, json: false, watch: true},
      } as never)
      vi.spyOn(command as unknown as {createBuilder: () => Builder}, 'createBuilder').mockReturnValue(builder)
      vi.spyOn(command as unknown as {createHooks: () => unknown}, 'createHooks').mockReturnValue({emit: vi.fn()} as never)
      vi.spyOn(command as unknown as {createRunner: () => ProcessRunner}, 'createRunner').mockReturnValue(createRunner())
      vi.spyOn(command as unknown as {createSdk: () => DamlSdk}, 'createSdk').mockReturnValue(createSdk())
      vi.spyOn(command as unknown as {getProjectDir: () => string}, 'getProjectDir').mockReturnValue('/repo')

      const resultPromise = captureOutput(() => command.run())
      await (await dataHandlerReady)(Buffer.from('q'))

      const result = await resultPromise
      expect(result.error).toBeUndefined()
      expect(stop).toHaveBeenCalled()
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
      expect(setRawMode).toHaveBeenCalledWith(true)
      expect(setRawMode).toHaveBeenCalledWith(false)
      expect(resume).toHaveBeenCalled()
      expect(pause).toHaveBeenCalled()
      expect(result.stdout).toContain('Build up to date (cached)')
      expect(result.stdout).toContain('Watch mode stopped')
    } finally {
      Object.defineProperty(stdin, 'isTTY', {configurable: true, value: originalIsTTY})
      stdin.on = originalOn
      stdin.pause = originalPause
      stdin.resume = originalResume
      stdin.setRawMode = originalSetRawMode
    }
  })

  it('ignores non-quit watch input until a signal shuts the build down', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    const stdin = process.stdin as NodeJS.ReadStream & {
      isTTY?: boolean
      on: typeof process.stdin.on
      pause: () => void
      resume: () => void
      setRawMode: (value: boolean) => void
    }
    const originalIsTTY = stdin.isTTY
    const originalOn = stdin.on
    const originalPause = stdin.pause
    const originalResume = stdin.resume
    const originalSetRawMode = stdin.setRawMode
    let dataHandler: ((data: Buffer) => Promise<void>) | undefined
    let sigintHandler: (() => Promise<void>) | undefined
    let resolveDataHandler: ((handler: (data: Buffer) => Promise<void>) => void) | undefined
    const dataHandlerReady = new Promise<(data: Buffer) => Promise<void>>(resolve => {
      resolveDataHandler = resolve
    })

    Object.defineProperty(stdin, 'isTTY', {configurable: true, value: true})
    stdin.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'data') {
        dataHandler = handler as (data: Buffer) => Promise<void>
        resolveDataHandler?.(dataHandler)
      }
      return stdin
    }) as never
    stdin.pause = vi.fn()
    stdin.resume = vi.fn()
    stdin.setRawMode = vi.fn()

    const onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
      if (event === 'SIGINT') {
        sigintHandler = handler
      }
      return process
    }) as never)

    try {
      const builder: Builder = {
        build: vi.fn().mockResolvedValue({
          cached: false,
          durationMs: 20,
          success: true,
        }),
        buildWithCodegen: vi.fn(),
        watch: vi.fn().mockResolvedValue({stop}),
      }
      const command = new Build([], {} as never)
      vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
        flags: {codegen: false, force: false, json: false, watch: true},
      } as never)
      vi.spyOn(command as unknown as {createBuilder: () => Builder}, 'createBuilder').mockReturnValue(builder)
      vi.spyOn(command as unknown as {createHooks: () => unknown}, 'createHooks').mockReturnValue({emit: vi.fn()} as never)
      vi.spyOn(command as unknown as {createRunner: () => ProcessRunner}, 'createRunner').mockReturnValue(createRunner())
      vi.spyOn(command as unknown as {createSdk: () => DamlSdk}, 'createSdk').mockReturnValue(createSdk())
      vi.spyOn(command as unknown as {getProjectDir: () => string}, 'getProjectDir').mockReturnValue('/repo')

      const resultPromise = captureOutput(() => command.run())
      await (await dataHandlerReady)(Buffer.from('x'))
      expect(stop).not.toHaveBeenCalled()
      await sigintHandler?.()

      const result = await resultPromise
      expect(result.error).toBeUndefined()
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(stdin, 'isTTY', {configurable: true, value: originalIsTTY})
      stdin.on = originalOn
      stdin.pause = originalPause
      stdin.resume = originalResume
      stdin.setRawMode = originalSetRawMode
    }
  })

  it('rethrows unexpected build failures', async () => {
    class TestBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockRejectedValue(new Error('boom')),
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

    await expect(TestBuild.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
  })

  it('reports cached single-build results without a DAR path', async () => {
    class TestBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            cached: true,
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

    const result = await captureOutput(() => TestBuild.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      cached: true,
      darPath: undefined,
      durationMs: 12,
    })
  })

  it('defaults missing cached values to false for successful single builds', async () => {
    class TestBuild extends Build {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn().mockResolvedValue({
            darPath: undefined,
            durationMs: 18,
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

    const result = await captureOutput(() => TestBuild.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      cached: false,
      darPath: undefined,
      durationMs: 18,
    })
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

  it('rethrows unexpected clean failures', async () => {
    class TestClean extends Clean {
      protected override createCleaner(): Cleaner {
        return {
          clean: vi.fn().mockRejectedValue(new Error('boom')),
        }
      }
    }

    await expect(TestClean.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
  })

  it('executes clean through the instance run path', async () => {
    const clean = vi.fn().mockResolvedValue({
      durationMs: 15,
      removed: ['.daml'],
      skipped: [],
    })

    const command = new Clean([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      flags: {all: false, force: true, json: false},
    } as never)
    vi.spyOn(command as unknown as {createCleaner: (json: boolean, out: unknown) => Cleaner}, 'createCleaner')
      .mockReturnValue({clean})

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeUndefined()
    expect(clean).toHaveBeenCalledWith({
      all: false,
      force: true,
      projectDir: process.cwd(),
    })
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

  it('serializes test runner failures through CantonctlError', async () => {
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
          run: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.TEST_EXECUTION_FAILED, {
            suggestion: 'Inspect the daml script output.',
          })),
        }
      }
    }

    const result = await captureOutput(() => TestCommand.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.TEST_EXECUTION_FAILED,
      suggestion: 'Inspect the daml script output.',
    }))
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
    expect(result.stdout).toContain('Creating companion-ready project: demo-app')
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

  it('rethrows unexpected init failures', async () => {
    class TestInit extends Init {
      protected override scaffoldProject(): never {
        throw new Error('boom')
      }
    }

    await expect(TestInit.run(['demo-app', '--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
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

  it('acknowledges local-only auth profiles in human mode without persisting credentials', async () => {
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

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run([
      'local',
      '--experimental',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(storeToken).not.toHaveBeenCalled()
    expect(result.stdout).toContain('No credential persisted for local')
    expect(result.stdout).toContain('Acknowledged localnet-unsafe-hmac for local')
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

  it('fails when no token is provided for remote auth profiles', async () => {
    class TestAuthLogin extends AuthLogin {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createReadlineInterface() {
        return {
          close: vi.fn(),
          question: vi.fn((_message: string, callback: (value: string) => void) => {
            callback('')
          }),
        } as never
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run([
      'devnet',
      '--experimental',
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.DEPLOY_AUTH_FAILED,
    }))
  })

  it('prompts for JWT tokens and uses the JSON API port when a remote network omits url', async () => {
    const storeToken = vi.fn()
    const getVersion = vi.fn().mockResolvedValue({version: '3.4.11'})
    const createLedgerClientSpy = vi.fn().mockReturnValue({getVersion})
    const question = vi.fn((_message: string, callback: (value: string) => void) => {
      callback('prompt-token')
    })

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

      protected override createLedgerClient(options: {baseUrl: string; token: string}) {
        return createLedgerClientSpy(options)
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          networks: {
            ...createConfig().networks,
            ops: {'json-api-port': 7676, auth: 'jwt', type: 'remote'},
          },
        }
      }

      protected override createReadlineInterface() {
        return {
          close: vi.fn(),
          question,
        } as never
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run(['ops', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(question).toHaveBeenCalledWith('Enter JWT token: ', expect.any(Function))
    expect(createLedgerClientSpy).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:7676',
      token: 'prompt-token',
    })
    expect(storeToken).toHaveBeenCalledWith('ops', 'prompt-token', {mode: 'env-or-keychain-jwt'})
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

  it('accepts an explicit auth mode override for login', async () => {
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
      '--mode',
      'bearer-token',
      '--token',
      'jwt-token',
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(storeToken).toHaveBeenCalledWith('devnet', 'jwt-token', {mode: 'bearer-token'})

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      mode: 'bearer-token',
      network: 'devnet',
      persisted: true,
      source: 'keychain',
    })
    expect(json.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Operator override'),
    ]))
  })

  it('rethrows unexpected auth login failures', async () => {
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
          store: vi.fn().mockRejectedValue(new Error('boom')),
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

    await expect(TestAuthLogin.run([
      'devnet',
      '--experimental',
      '--json',
      '--token',
      'jwt-token',
    ], {root: CLI_ROOT})).rejects.toThrow('boom')
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

  it('executes auth logout through the instance run path', async () => {
    const remove = vi.fn().mockResolvedValue(true)

    const command = new AuthLogout([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({
      args: {network: 'devnet'},
      flags: {json: false},
    } as never)
    vi.spyOn(command as unknown as {createBackend: () => Promise<{backend: KeychainBackend}>}, 'createBackend')
      .mockResolvedValue({backend: createKeychainBackend()})
    vi.spyOn(
      command as unknown as {
        createCredentialStore: (backend: KeychainBackend) => ReturnType<AuthLogout['createCredentialStore']>
      },
      'createCredentialStore',
    ).mockReturnValue({
      list: vi.fn(),
      remove,
      resolve: vi.fn(),
      resolveRecord: vi.fn(),
      retrieve: vi.fn(),
      retrieveRecord: vi.fn(),
      store: vi.fn(),
    })

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeUndefined()
    expect(remove).toHaveBeenCalledWith('devnet')
  })

  it('serializes auth logout failures through CantonctlError', async () => {
    class TestAuthLogout extends AuthLogout {
      protected override async createBackend() {
        return {backend: createKeychainBackend()}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
            suggestion: 'Run auth login first.',
          })),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }
    }

    const result = await captureOutput(() => TestAuthLogout.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_NOT_FOUND,
      suggestion: 'Run auth login first.',
    }))
  })

  it('rethrows unexpected auth logout failures', async () => {
    class TestAuthLogout extends AuthLogout {
      protected override async createBackend() {
        return {backend: createKeychainBackend()}
      }

      protected override createCredentialStore() {
        return {
          list: vi.fn(),
          remove: vi.fn().mockRejectedValue(new Error('boom')),
          resolve: vi.fn(),
          resolveRecord: vi.fn(),
          retrieve: vi.fn(),
          retrieveRecord: vi.fn(),
          store: vi.fn(),
        }
      }
    }

    await expect(TestAuthLogout.run(['devnet', '--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
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

  it('reports generated and env-backed localnet auth sources distinctly', async () => {
    const records = new Map<string, ResolvedCredential | null>([
      ['devnet', null],
      ['local', {source: 'env', token: 'jwt'}],
    ])

    class TestAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createKeychainBackend(), isKeychain: false}
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
    expect(json.data).toEqual(expect.objectContaining({
      networks: expect.arrayContaining([
        expect.objectContaining({
          authenticated: true,
          network: 'local',
          source: 'env',
        }),
      ]),
    }))
  })

  it('reports stored localnet credentials using the backend source', async () => {
    const records = new Map<string, ResolvedCredential | null>([
      ['devnet', null],
      ['local', {
        mode: 'localnet-unsafe-hmac',
        source: 'stored',
        storedAt: '2026-04-02T20:00:00Z',
        token: 'jwt',
      }],
    ])

    class TestAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createKeychainBackend(), isKeychain: false}
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
    expect(json.data).toEqual(expect.objectContaining({
      networks: expect.arrayContaining([
        expect.objectContaining({
          authenticated: true,
          network: 'local',
          source: 'memory',
        }),
      ]),
    }))
  })

  it('renders env-backed and unauthenticated auth status rows in human mode', async () => {
    const records = new Map<string, ResolvedCredential | null>([
      ['devnet', {source: 'env', token: 'jwt'}],
      ['local', null],
      ['ops', null],
    ])

    class TestAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {backend: createKeychainBackend(), isKeychain: false}
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
        return {
          ...createConfig(),
          networks: {
            ...createConfig().networks,
            ops: {auth: 'jwt', type: 'remote', url: 'https://ops.example.com'},
          },
        }
      }
    }

    const result = await captureOutput(() => TestAuthStatus.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('devnet')
    expect(result.stdout).toContain('env')
    expect(result.stdout).toContain('ops')
    expect(result.stdout).toContain('no')
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

  it('executes auth status through the instance run path', async () => {
    const resolveRecord = vi.fn<(network: string) => Promise<ResolvedCredential | null>>(async (network: string) => (
      network === 'devnet'
        ? {mode: 'oidc-client-credentials', source: 'stored', storedAt: '2026-04-02T20:00:00Z', token: 'jwt'}
        : null
    ))

    const command = new AuthStatus([], {} as never)
    vi.spyOn(command as unknown as {parse: () => Promise<unknown>}, 'parse').mockResolvedValue({flags: {json: false}} as never)
    vi.spyOn(
      command as unknown as {createBackend: () => Promise<{backend: KeychainBackend; isKeychain: boolean}>},
      'createBackend',
    ).mockResolvedValue({backend: createKeychainBackend(), isKeychain: true})
    vi.spyOn(
      command as unknown as {
        createCredentialStore: (backend: KeychainBackend) => ReturnType<AuthStatus['createCredentialStore']>
      },
      'createCredentialStore',
    ).mockReturnValue({
      list: vi.fn(),
      remove: vi.fn(),
      resolve: vi.fn(),
      resolveRecord,
      retrieve: vi.fn(),
      retrieveRecord: vi.fn(),
      store: vi.fn(),
    })
    vi.spyOn(command as unknown as {loadCommandConfig: () => Promise<CantonctlConfig>}, 'loadCommandConfig')
      .mockResolvedValue(createConfig())

    const result = await captureOutput(() => command.run())
    expect(result.error).toBeUndefined()
    expect(resolveRecord).toHaveBeenCalledWith('devnet')
    expect(resolveRecord).toHaveBeenCalledWith('local')
  })

  it('serializes auth status failures through CantonctlError', async () => {
    class TestAuthStatus extends AuthStatus {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {
          suggestion: 'Create cantonctl.yaml before checking auth status.',
        })
      }
    }

    const result = await captureOutput(() => TestAuthStatus.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_NOT_FOUND,
      suggestion: 'Create cantonctl.yaml before checking auth status.',
    }))
  })

  it('rethrows unexpected auth status failures', async () => {
    class TestAuthStatus extends AuthStatus {
      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        throw new Error('boom')
      }
    }

    await expect(TestAuthStatus.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
  })
})
