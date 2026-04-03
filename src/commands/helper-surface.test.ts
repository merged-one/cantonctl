import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import type {ResolvedCredential} from '../lib/credential-store.js'
import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {OutputWriter} from '../lib/output.js'
import type {StableSplice} from '../lib/splice-public.js'
import AuthLogin from './auth/login.js'
import AuthStatus from './auth/status.js'
import Clean from './clean.js'
import CodegenSync from './codegen/sync.js'
import Dev from './dev.js'
import Init from './init.js'
import LocalnetDown from './localnet/down.js'
import LocalnetStatus from './localnet/status.js'
import LocalnetUp from './localnet/up.js'
import Playground from './playground.js'
import Serve from './serve.js'
import {StableSurfaceCommand} from './stable-surface-command.js'

const CLI_ROOT = process.cwd()

const tempDirs: string[] = []

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

function createPromptInterface(answer: string) {
  return {
    close: vi.fn(),
    question: vi.fn((_message: string, callback: (value: string) => void) => {
      callback(answer)
    }),
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, {force: true, recursive: true})
  }
})

describe('command helper coverage', () => {
  it('covers StableSurfaceCommand helper methods', async () => {
    const out = {result: vi.fn()} as unknown as OutputWriter

    class Harness extends StableSurfaceCommand {
      public async callMaybeLoadProfileContext(options: {needsProfile: boolean; profileName?: string}) {
        return this.maybeLoadProfileContext(options)
      }

      public callHandleCommandError(error: unknown, writer: OutputWriter): never {
        return this.handleCommandError(error, writer)
      }

      public callOutputFor(json: boolean) {
        return this.outputFor(json)
      }

      public async run(): Promise<void> {}

      protected override createStableSplice(): StableSplice {
        return {listScanUpdates: vi.fn()} as unknown as StableSplice
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    class BaseHarness extends StableSurfaceCommand {
      public callCreateStableSplice() {
        return this.createStableSplice()
      }

      public async run(): Promise<void> {}
    }

    const harness = new Harness([], {} as never)
    await expect(harness.callMaybeLoadProfileContext({needsProfile: false})).resolves.toBeUndefined()
    await expect(harness.callMaybeLoadProfileContext({needsProfile: false, profileName: 'splice-devnet'}))
      .resolves.toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    await expect(harness.callMaybeLoadProfileContext({needsProfile: true, profileName: 'splice-devnet'}))
      .resolves.toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    await expect(harness.callMaybeLoadProfileContext({needsProfile: true}))
      .resolves.toEqual(expect.objectContaining({kind: 'sandbox', name: 'sandbox'}))
    expect(harness.callOutputFor(true)).toEqual(expect.objectContaining({result: expect.any(Function)}))
    expect(() => harness.callHandleCommandError(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND), out))
      .toThrow()
    expect(() => harness.callHandleCommandError(new Error('boom'), out)).toThrow('boom')
    expect(out.result).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))
    expect(new BaseHarness([], {} as never).callCreateStableSplice()).toEqual(expect.objectContaining({
      listScanUpdates: expect.any(Function),
      transferToken: expect.any(Function),
    }))
  })

  it('covers Clean prompt confirmation through the default cleaner factory', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clean-command-'))
    tempDirs.push(projectDir)
    await fs.mkdir(path.join(projectDir, '.daml'), {recursive: true})
    await fs.writeFile(path.join(projectDir, '.daml', 'artifact.txt'), 'artifact', 'utf8')

    class Harness extends Clean {
      public exposeCleaner() {
        return this.createCleaner(false, {
          error: vi.fn(),
          info: vi.fn(),
          log: vi.fn(),
          result: vi.fn(),
          spinner: vi.fn(),
          success: vi.fn(),
          table: vi.fn(),
          warn: vi.fn(),
        } as unknown as OutputWriter)
      }

      protected override createReadlineInterface() {
        return createPromptInterface('y') as never
      }
    }

    const cleaner = new Harness([], {} as never).exposeCleaner()
    const result = await cleaner.clean({all: false, force: false, projectDir})

    expect(result.removed).toContain('.daml')
  })

  it('prompts for auth tokens and emits human-mode warnings when verification or persistence degrades', async () => {
    const store = vi.fn()

    class TestAuthLogin extends AuthLogin {
      protected override async createBackend() {
        return {
          backend: {
            deletePassword: async () => false,
            findCredentials: async () => [],
            getPassword: async () => null,
            setPassword: async () => undefined,
          },
          isKeychain: false,
        }
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
          getVersion: vi.fn().mockRejectedValue(new Error('offline')),
        } as never
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createReadlineInterface() {
        return createPromptInterface('prompt-token') as never
      }
    }

    const result = await captureOutput(() => TestAuthLogin.run([
      'devnet',
      '--experimental',
    ], {root: CLI_ROOT}))

    expect(result.error).toBeUndefined()
    expect(store).toHaveBeenCalledWith('devnet', 'prompt-token', {mode: 'oidc-client-credentials'})
    expect(result.stdout).toContain('Resolved auth profile for devnet: oidc-client-credentials')
    expect(result.stderr).toContain('Could not verify connectivity to devnet')
    expect(result.stderr).toContain('OS keychain unavailable')
  })

  it('renders auth status warnings when stored auth modes override inferred profiles', async () => {
    const records = new Map<string, ResolvedCredential | null>([
      ['devnet', {mode: 'bearer-token', source: 'stored', storedAt: '2026-04-02T20:00:00Z', token: 'jwt'}],
      ['local', null],
    ])

    class TestAuthStatus extends AuthStatus {
      protected override async createBackend() {
        return {
          backend: {
            deletePassword: async () => false,
            findCredentials: async () => [],
            getPassword: async () => null,
            setPassword: async () => undefined,
          },
          isKeychain: true,
        }
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

    const result = await captureOutput(() => TestAuthStatus.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('devnet')
    expect(result.stderr).toContain('Stored credential mode "bearer-token" overrides the inferred "oidc-client-credentials" profile.')
  })

  it('covers auth login default backend helper creation', async () => {
    class Harness extends AuthLogin {
      public callCreateBackend() {
        return this.createBackend()
      }
    }

    const result = await new Harness([], {} as never).callCreateBackend()
    expect(result).toEqual(expect.objectContaining({
      backend: expect.any(Object),
      isKeychain: expect.any(Boolean),
    }))
  })

  it('covers dev helper shutdown and cleanup paths in interactive mode', async () => {
    class Harness extends Dev {
      public callCleanupInteractiveInput(json: boolean) {
        this.cleanupInteractiveInput(json)
      }

      public callWaitForShutdown(
        json: boolean,
        shutdown: () => Promise<void>,
        shutdownPromise: Promise<void>,
      ) {
        return this.waitForShutdown(json, shutdown, shutdownPromise)
      }
    }

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
    const setRawMode = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn()
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((...args: Parameters<typeof process.on>) => process) as never)

    Object.defineProperty(stdin, 'isTTY', {configurable: true, value: true})
    stdin.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'data') {
        dataHandler = handler as (data: Buffer) => Promise<void>
      }
      return stdin
    }) as never
    stdin.pause = pause
    stdin.resume = resume
    stdin.setRawMode = setRawMode

    const harness = new Harness([], {} as never)
    let resolveShutdown: (() => void) | undefined
    const shutdownPromise = new Promise<void>((resolve) => { resolveShutdown = resolve })
    const shutdown = vi.fn(async () => {
      resolveShutdown?.()
    })

    const waitPromise = harness.callWaitForShutdown(false, shutdown, shutdownPromise)
    await dataHandler?.(Buffer.from('q'))
    await waitPromise
    harness.callCleanupInteractiveInput(false)

    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    expect(setRawMode).toHaveBeenCalledWith(true)
    expect(setRawMode).toHaveBeenCalledWith(false)
    expect(resume).toHaveBeenCalled()
    expect(pause).toHaveBeenCalled()

    Object.defineProperty(stdin, 'isTTY', {configurable: true, value: originalIsTTY})
    stdin.on = originalOn
    stdin.pause = originalPause
    stdin.resume = originalResume
    stdin.setRawMode = originalSetRawMode
  })

  it('covers serve and playground helper methods for project detection and signal shutdown', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-command-'))
    tempDirs.push(projectDir)
    await fs.writeFile(path.join(projectDir, 'cantonctl.yaml'), 'version: 1\nproject:\n  name: demo\n  sdk-version: "3.4.11"\n', 'utf8')

    class ServeHarness extends Serve {
      public callProjectExists(dir: string) {
        return this.projectExists(dir)
      }

      public callWaitForShutdown(shutdown: () => Promise<void>) {
        return this.waitForShutdown(shutdown)
      }
    }

    class PlaygroundHarness extends Playground {
      public callProjectExists(dir: string) {
        return this.projectExists(dir)
      }

      public callWaitForShutdown(shutdown: () => Promise<void>) {
        return this.waitForShutdown(shutdown)
      }
    }

    const handlers = new Map<string, () => Promise<void>>()
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler)
      return process
    }) as never)

    const serve = new ServeHarness([], {} as never)
    const playground = new PlaygroundHarness([], {} as never)
    const serveShutdown = vi.fn(async () => undefined)
    const playgroundShutdown = vi.fn(async () => undefined)

    const servePromise = serve.callWaitForShutdown(serveShutdown)
    await handlers.get('SIGINT')?.()
    await servePromise

    handlers.clear()
    const playgroundPromise = playground.callWaitForShutdown(playgroundShutdown)
    await handlers.get('SIGTERM')?.()
    await playgroundPromise

    expect(onSpy).toHaveBeenCalled()
    expect(serve.callProjectExists(projectDir)).toBe(true)
    expect(serve.callProjectExists(path.join(projectDir, 'missing'))).toBe(false)
    expect(playground.callProjectExists(projectDir)).toBe(true)
    expect(playground.callProjectExists(path.join(projectDir, 'missing'))).toBe(false)
  })

  it('covers init, codegen, and localnet factory helpers', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'init-command-'))
    tempDirs.push(projectDir)

    class InitHarness extends Init {
      public expose() {
        return {
          projectDir: this.resolveProjectDir('demo'),
          runner: this.createRunner(),
          scaffolded: this.scaffoldProject({
            dir: path.join(projectDir, 'demo'),
            name: 'demo',
            template: 'basic',
          }),
        }
      }
    }

    class CodegenHarness extends CodegenSync {
      public expose() {
        return {
          cwd: this.getCommandCwd(),
          runner: this.createRunner(),
        }
      }
    }

    class LocalnetUpHarness extends LocalnetUp {
      public expose() {
        return this.createLocalnet()
      }
    }

    class LocalnetStatusHarness extends LocalnetStatus {
      public expose() {
        return this.createLocalnet()
      }
    }

    class LocalnetDownHarness extends LocalnetDown {
      public expose() {
        return this.createLocalnet()
      }
    }

    const init = new InitHarness([], {} as never).expose()
    expect(init.projectDir).toContain('demo')
    expect(init.runner).toEqual(expect.objectContaining({run: expect.any(Function)}))
    expect(init.scaffolded).toEqual(expect.objectContaining({
      projectDir: path.join(projectDir, 'demo'),
      template: 'basic',
    }))

    expect(new CodegenHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      cwd: process.cwd(),
      runner: expect.objectContaining({run: expect.any(Function)}),
    }))
    expect(new LocalnetUpHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      down: expect.any(Function),
      status: expect.any(Function),
      up: expect.any(Function),
    }))
    expect(new LocalnetStatusHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      down: expect.any(Function),
      status: expect.any(Function),
      up: expect.any(Function),
    }))
    expect(new LocalnetDownHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      down: expect.any(Function),
      status: expect.any(Function),
      up: expect.any(Function),
    }))
  })
})
