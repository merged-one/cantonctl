import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {PassThrough} from 'node:stream'
import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as builderModule from '../lib/builder.js'
import * as completerModule from '../lib/repl/completer.js'
import * as configModule from '../lib/config.js'
import * as damlModule from '../lib/daml.js'
import * as deployerModule from '../lib/deployer.js'
import * as devServerFullModule from '../lib/dev-server-full.js'
import * as devServerModule from '../lib/dev-server.js'
import * as dockerModule from '../lib/docker.js'
import * as executorModule from '../lib/repl/executor.js'
import * as jwtModule from '../lib/jwt.js'
import * as ledgerClientModule from '../lib/ledger-client.js'
import * as processRunnerModule from '../lib/process-runner.js'
import * as runtimeSupportModule from '../lib/runtime-support.js'
import * as topologyModule from '../lib/topology.js'
import * as serveModule from '../lib/serve.js'
import * as testRunnerModule from '../lib/test-runner.js'
import type {ResolvedCredential} from '../lib/credential-store.js'
import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {OutputWriter} from '../lib/output.js'
import type {StableSplice} from '../lib/splice-public.js'
import AuthLogin from './auth/login.js'
import AuthLogout from './auth/logout.js'
import AuthStatus from './auth/status.js'
import Build from './build.js'
import Clean from './clean.js'
import CodegenSync from './codegen/sync.js'
import Console from './console.js'
import Deploy from './deploy.js'
import Dev from './dev.js'
import Init from './init.js'
import LocalnetDown from './localnet/down.js'
import LocalnetStatus from './localnet/status.js'
import LocalnetUp from './localnet/up.js'
import Playground from './playground.js'
import Serve from './serve.js'
import {StableSurfaceCommand} from './stable-surface-command.js'
import Test from './test.js'

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

      public callLoadCommandConfig() {
        return this.loadCommandConfig()
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
      public callLoadCommandConfig() {
        return this.loadCommandConfig()
      }

      public callCreateStableSplice() {
        return this.createStableSplice()
      }

      public async run(): Promise<void> {}
    }

    const harness = new Harness([], {} as never)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    await expect(harness.callMaybeLoadProfileContext({needsProfile: false})).resolves.toBeUndefined()
    await expect(harness.callMaybeLoadProfileContext({needsProfile: false, profileName: 'splice-devnet'}))
      .resolves.toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    await expect(harness.callMaybeLoadProfileContext({needsProfile: true, profileName: 'splice-devnet'}))
      .resolves.toEqual(expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}))
    await expect(harness.callMaybeLoadProfileContext({needsProfile: true}))
      .resolves.toEqual(expect.objectContaining({kind: 'sandbox', name: 'sandbox'}))
    await expect(harness.callLoadCommandConfig()).resolves.toEqual(createConfig())
    expect(harness.callOutputFor(true)).toEqual(expect.objectContaining({result: expect.any(Function)}))
    expect(() => harness.callHandleCommandError(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND), out))
      .toThrow()
    expect(() => harness.callHandleCommandError(new Error('boom'), out)).toThrow('boom')
    expect(out.result).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))
    await expect(new BaseHarness([], {} as never).callLoadCommandConfig()).resolves.toEqual(createConfig())
    expect(new BaseHarness([], {} as never).callCreateStableSplice()).toEqual(expect.objectContaining({
      listScanUpdates: expect.any(Function),
      transferToken: expect.any(Function),
    }))
    loadConfigSpy.mockRestore()
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

  it('covers auth command helper factories and config loading', async () => {
    const config = createConfig()
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)

    class LoginHarness extends AuthLogin {
      public callCreateBackend() {
        return this.createBackend()
      }

      public callCreateReadlineInterface() {
        return this.createReadlineInterface({
          input: new PassThrough(),
          output: new PassThrough(),
        })
      }

      public callLoadCommandConfig() {
        return this.loadCommandConfig()
      }
    }

    class LogoutHarness extends AuthLogout {
      public callCreateBackend() {
        return this.createBackend()
      }
    }

    class StatusHarness extends AuthStatus {
      public callCreateBackend() {
        return this.createBackend()
      }

      public callLoadCommandConfig() {
        return this.loadCommandConfig()
      }
    }

    try {
      const loginBackend = await new LoginHarness([], {} as never).callCreateBackend()
      expect(loginBackend).toEqual(expect.objectContaining({
        backend: expect.any(Object),
        isKeychain: expect.any(Boolean),
      }))

      const logoutBackend = await new LogoutHarness([], {} as never).callCreateBackend()
      expect(logoutBackend).toEqual(expect.objectContaining({
        backend: expect.any(Object),
      }))

      const statusBackend = await new StatusHarness([], {} as never).callCreateBackend()
      expect(statusBackend).toEqual(expect.objectContaining({
        backend: expect.any(Object),
        isKeychain: expect.any(Boolean),
      }))

      const rl = new LoginHarness([], {} as never).callCreateReadlineInterface()
      expect(rl.question).toEqual(expect.any(Function))
      rl.close()

      await expect(new LoginHarness([], {} as never).callLoadCommandConfig()).resolves.toBe(config)
      await expect(new StatusHarness([], {} as never).callLoadCommandConfig()).resolves.toBe(config)
      expect(loadConfigSpy).toHaveBeenCalledTimes(2)
    } finally {
      loadConfigSpy.mockRestore()
    }
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

  it('covers dev helper shutdown on ctrl-c input', async () => {
    class Harness extends Dev {
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
      setRawMode: (value: boolean) => void
    }
    const originalIsTTY = stdin.isTTY
    const originalOn = stdin.on
    const originalSetRawMode = stdin.setRawMode
    let dataHandler: ((data: Buffer) => Promise<void>) | undefined

    Object.defineProperty(stdin, 'isTTY', {configurable: true, value: true})
    stdin.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'data') {
        dataHandler = handler as (data: Buffer) => Promise<void>
      }
      return stdin
    }) as never
    stdin.setRawMode = vi.fn()

    try {
      let resolveShutdown: (() => void) | undefined
      const shutdownPromise = new Promise<void>((resolve) => { resolveShutdown = resolve })
      const shutdown = vi.fn(async () => {
        resolveShutdown?.()
      })

      const waitPromise = new Harness([], {} as never).callWaitForShutdown(false, shutdown, shutdownPromise)
      await dataHandler?.(Buffer.from('\u0003'))
      await waitPromise

      expect(shutdown).toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(stdin, 'isTTY', {configurable: true, value: originalIsTTY})
      stdin.on = originalOn
      stdin.setRawMode = originalSetRawMode
    }
  })

  it('covers dev helper non-quit input without triggering shutdown', async () => {
    class Harness extends Dev {
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
      setRawMode: (value: boolean) => void
    }
    const originalIsTTY = stdin.isTTY
    const originalOn = stdin.on
    const originalSetRawMode = stdin.setRawMode
    let dataHandler: ((data: Buffer) => Promise<void>) | undefined

    Object.defineProperty(stdin, 'isTTY', {configurable: true, value: true})
    stdin.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'data') {
        dataHandler = handler as (data: Buffer) => Promise<void>
      }
      return stdin
    }) as never
    stdin.setRawMode = vi.fn()

    try {
      let resolveShutdown: (() => void) | undefined
      const shutdownPromise = new Promise<void>((resolve) => { resolveShutdown = resolve })
      const shutdown = vi.fn(async () => {
        resolveShutdown?.()
      })

      const waitPromise = new Harness([], {} as never).callWaitForShutdown(false, shutdown, shutdownPromise)
      await dataHandler?.(Buffer.from('x'))
      expect(shutdown).not.toHaveBeenCalled()
      resolveShutdown?.()
      await waitPromise
    } finally {
      Object.defineProperty(stdin, 'isTTY', {configurable: true, value: originalIsTTY})
      stdin.on = originalOn
      stdin.setRawMode = originalSetRawMode
    }
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

  it('covers runtime command factory helpers and environment lookups', async () => {
    const config = createConfig()
    const output = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      result: vi.fn(),
      spinner: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    } as unknown as OutputWriter
    const runner = {run: vi.fn(), spawn: vi.fn(), which: vi.fn()} as never
    const sdk = {build: vi.fn(), codegen: vi.fn(), detectCommand: vi.fn(), getVersion: vi.fn(), startSandbox: vi.fn(), test: vi.fn()} as never
    const docker = {checkAvailable: vi.fn(), composeDown: vi.fn(), composeLogs: vi.fn(), composePs: vi.fn(), composeUp: vi.fn(), ensureImage: vi.fn(), isDockerAvailable: vi.fn()} as never
    const sandboxServer = {start: vi.fn(), stop: vi.fn()} as never
    const fullServer = {start: vi.fn(), stop: vi.fn()} as never
    const builder = {build: vi.fn(), buildWithCodegen: vi.fn(), watch: vi.fn()} as never
    const mockDeployer = {deploy: vi.fn()} as never
    const testRunner = {run: vi.fn()} as never
    const serveServer = {broadcast: vi.fn(), start: vi.fn(), stop: vi.fn()} as never

    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)
    const createRunnerSpy = vi.spyOn(processRunnerModule, 'createProcessRunner').mockReturnValue(runner)
    const createSdkSpy = vi.spyOn(damlModule, 'createDamlSdk').mockReturnValue(sdk)
    const createDockerManagerSpy = vi.spyOn(dockerModule, 'createDockerManager').mockReturnValue(docker)
    const createSandboxServerSpy = vi.spyOn(devServerModule, 'createDevServer').mockReturnValue(sandboxServer)
    const createFullServerSpy = vi.spyOn(devServerFullModule, 'createFullDevServer').mockReturnValue(fullServer)
    const createBuilderSpy = vi.spyOn(builderModule, 'createBuilder').mockReturnValue(builder)
    const createServeServerSpy = vi.spyOn(serveModule, 'createServeServer').mockReturnValue(serveServer)
    const createTestRunnerSpy = vi.spyOn(testRunnerModule, 'createTestRunner').mockReturnValue(testRunner)
    const portSpy = vi.spyOn(runtimeSupportModule, 'isTcpPortInUse').mockResolvedValue(true)
    const openBrowserSpy = vi.spyOn(runtimeSupportModule, 'openBrowserUrl').mockImplementation(() => undefined)

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-helper-'))
    tempDirs.push(tempDir)
    const tempFile = path.join(tempDir, 'artifact.dar')
    await fs.writeFile(tempFile, 'dar', 'utf8')

    class DevHarness extends Dev {
      public callCreateDockerManager(out: OutputWriter, processRunner: ReturnType<typeof processRunnerModule.createProcessRunner>) {
        return this.createDockerManager(out, processRunner)
      }

      public callCreateFullServer() {
        return this.createFullServer({
          cantonImage: 'ghcr.io/example/canton:test',
          config,
          docker,
          output,
          sdk,
        })
      }

      public callCreateRunner() {
        return this.createRunner()
      }

      public callCreateSandboxServer() {
        return this.createSandboxServer({config, output, sdk})
      }

      public callCreateSdk(processRunner: ReturnType<typeof processRunnerModule.createProcessRunner>) {
        return this.createSdk(processRunner)
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public callIsManagedPortInUse(port: number) {
        return this.isManagedPortInUse(port)
      }

      public callLoadProjectConfig() {
        return this.loadProjectConfig()
      }
    }

    class ServeHarness extends Serve {
      public callCreateManagedSandboxServer() {
        return this.createManagedSandboxServer({config, output, sdk})
      }

      public callCreateRunner() {
        return this.createRunner()
      }

      public callCreateSdk(processRunner: ReturnType<typeof processRunnerModule.createProcessRunner>) {
        return this.createSdk(processRunner)
      }

      public callCreateServeBuilder(commandSdk: ReturnType<typeof damlModule.createDamlSdk>) {
        return this.createServeBuilder(commandSdk)
      }

      public callCreateServeServer(commandBuilder: ReturnType<typeof builderModule.createBuilder>) {
        return this.createServeServer({builder: commandBuilder, output, testRunner})
      }

      public callCreateServeTestRunner(commandSdk: ReturnType<typeof damlModule.createDamlSdk>) {
        return this.createServeTestRunner(commandSdk)
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public callIsServePortInUse(port: number) {
        return this.isServePortInUse(port)
      }

      public callLoadProjectConfig() {
        return this.loadProjectConfig()
      }
    }

    class PlaygroundHarness extends Playground {
      public callCreateDockerManager(out: OutputWriter, processRunner: ReturnType<typeof processRunnerModule.createProcessRunner>) {
        return this.createDockerManager(out, processRunner)
      }

      public callCreateFullServer() {
        return this.createFullServer({
          cantonImage: 'ghcr.io/example/canton:test',
          config,
          docker,
          output,
          sdk,
        })
      }

      public callCreateRunner() {
        return this.createRunner()
      }

      public callCreateSandboxServer() {
        return this.createSandboxServer({config, output, sdk})
      }

      public callCreateSdk(processRunner: ReturnType<typeof processRunnerModule.createProcessRunner>) {
        return this.createSdk(processRunner)
      }

      public callCreateServeBuilder(commandSdk: ReturnType<typeof damlModule.createDamlSdk>) {
        return this.createServeBuilder(commandSdk)
      }

      public callCreateServeServer(commandBuilder: ReturnType<typeof builderModule.createBuilder>) {
        return this.createServeServer({builder: commandBuilder, output, testRunner})
      }

      public callCreateServeTestRunner(commandSdk: ReturnType<typeof damlModule.createDamlSdk>) {
        return this.createServeTestRunner(commandSdk)
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public callIsPlaygroundPortInUse(port: number) {
        return this.isPlaygroundPortInUse(port)
      }

      public callLoadProjectConfig() {
        return this.loadProjectConfig()
      }

      public callOpenBrowser(url: string) {
        this.openBrowser(url)
      }

      public callResolveStaticDir() {
        return this.resolveStaticDir()
      }
    }

    const dev = new DevHarness([], {} as never)
    const serve = new ServeHarness([], {} as never)
    const playground = new PlaygroundHarness([], {} as never)

    expect(dev.callCreateDockerManager(output, runner)).toBe(docker)
    expect(dev.callCreateFullServer()).toBe(fullServer)
    expect(dev.callCreateRunner()).toBe(runner)
    expect(dev.callCreateSandboxServer()).toBe(sandboxServer)
    expect(dev.callCreateSdk(runner)).toBe(sdk)
    expect(dev.callGetProjectDir()).toBe(process.cwd())
    await expect(dev.callIsManagedPortInUse(4000)).resolves.toBe(true)
    await expect(dev.callLoadProjectConfig()).resolves.toBe(config)

    expect(serve.callCreateManagedSandboxServer()).toBe(sandboxServer)
    expect(serve.callCreateRunner()).toBe(runner)
    expect(serve.callCreateSdk(runner)).toBe(sdk)
    expect(serve.callCreateServeBuilder(sdk)).toBe(builder)
    expect(serve.callCreateServeServer(builder)).toBe(serveServer)
    expect(serve.callCreateServeTestRunner(sdk)).toBe(testRunner)
    expect(serve.callGetProjectDir()).toBe(process.cwd())
    await expect(serve.callIsServePortInUse(4001)).resolves.toBe(true)
    await expect(serve.callLoadProjectConfig()).resolves.toBe(config)

    expect(playground.callCreateDockerManager(output, runner)).toBe(docker)
    expect(playground.callCreateFullServer()).toBe(fullServer)
    expect(playground.callCreateRunner()).toBe(runner)
    expect(playground.callCreateSandboxServer()).toBe(sandboxServer)
    expect(playground.callCreateSdk(runner)).toBe(sdk)
    expect(playground.callCreateServeBuilder(sdk)).toBe(builder)
    expect(playground.callCreateServeServer(builder)).toBe(serveServer)
    expect(playground.callCreateServeTestRunner(sdk)).toBe(testRunner)
    expect(playground.callGetProjectDir()).toBe(process.cwd())
    await expect(playground.callIsPlaygroundPortInUse(4002)).resolves.toBe(true)
    await expect(playground.callLoadProjectConfig()).resolves.toBe(config)
    playground.callOpenBrowser('http://localhost:4000')
    expect(playground.callResolveStaticDir()).toSatisfy((value) => value === undefined || value.includes('playground'))

    const devFullServerDeps = createFullServerSpy.mock.calls[0]![0]
    await devFullServerDeps.build('/repo')
    await expect(devFullServerDeps.readFile(tempFile)).resolves.toBeInstanceOf(Buffer)
    await devFullServerDeps.mkdir(path.join(tempDir, 'nested'))
    await devFullServerDeps.writeFile(path.join(tempDir, 'generated.txt'), 'value')
    await devFullServerDeps.watch(tempDir, {ignoreInitial: true}).close()
    await devFullServerDeps.rmdir(path.join(tempDir, 'nested'))

    const devSandboxDeps = createSandboxServerSpy.mock.calls[0]![0]
    await expect(devSandboxDeps.readFile(tempFile)).resolves.toBeInstanceOf(Buffer)
    await expect(devSandboxDeps.isPortInUse!(4003)).resolves.toBe(true)
    await devSandboxDeps.watch(tempDir, {ignoreInitial: true}).close()

    const serveSandboxDeps = createSandboxServerSpy.mock.calls[1]![0]
    await expect(serveSandboxDeps.readFile(tempFile)).resolves.toBeInstanceOf(Buffer)
    await expect(serveSandboxDeps.isPortInUse!(4004)).resolves.toBe(true)
    await serveSandboxDeps.watch(tempDir, {ignoreInitial: true}).close()

    const serveBuilderDeps = createBuilderSpy.mock.calls[0]![0]
    await expect(serveBuilderDeps.getDamlSourceMtime(path.join(tempDir, 'daml'))).resolves.toBe(0)
    await expect(serveBuilderDeps.getFileMtime(tempFile)).resolves.toBeNull()

    const playgroundFullServerDeps = createFullServerSpy.mock.calls[1]![0]
    await playgroundFullServerDeps.build('/repo')
    await expect(playgroundFullServerDeps.readFile(tempFile)).resolves.toBeInstanceOf(Buffer)
    await playgroundFullServerDeps.mkdir(path.join(tempDir, 'nested-2'))
    await playgroundFullServerDeps.writeFile(path.join(tempDir, 'generated-2.txt'), 'value')
    await playgroundFullServerDeps.watch(tempDir, {ignoreInitial: true}).close()
    await playgroundFullServerDeps.rmdir(path.join(tempDir, 'nested-2'))

    const playgroundSandboxDeps = createSandboxServerSpy.mock.calls[2]![0]
    await expect(playgroundSandboxDeps.readFile(tempFile)).resolves.toBeInstanceOf(Buffer)
    await expect(playgroundSandboxDeps.isPortInUse!(4005)).resolves.toBe(true)
    await playgroundSandboxDeps.watch(tempDir, {ignoreInitial: true}).close()

    const playgroundBuilderDeps = createBuilderSpy.mock.calls[1]![0]
    await expect(playgroundBuilderDeps.getDamlSourceMtime(path.join(tempDir, 'daml'))).resolves.toBe(0)
    await expect(playgroundBuilderDeps.getFileMtime(tempFile)).resolves.toBeNull()

    expect(createRunnerSpy).toHaveBeenCalledTimes(3)
    expect(createSdkSpy).toHaveBeenCalledTimes(3)
    expect(createDockerManagerSpy).toHaveBeenCalledTimes(2)
    expect(createSandboxServerSpy).toHaveBeenCalledTimes(3)
    expect(createFullServerSpy).toHaveBeenCalledTimes(2)
    expect(createBuilderSpy).toHaveBeenCalledTimes(2)
    expect(createServeServerSpy).toHaveBeenCalledTimes(2)
    expect(createTestRunnerSpy).toHaveBeenCalledTimes(2)
    expect(loadConfigSpy).toHaveBeenCalledTimes(3)
    expect(portSpy).toHaveBeenCalledTimes(6)
    expect(openBrowserSpy).toHaveBeenCalledWith('http://localhost:4000')
  })

  it('covers dev helper shutdown paths for ctrl-c and non-interactive json mode', async () => {
    class Harness extends Dev {
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
    const originalResume = stdin.resume
    const originalSetRawMode = stdin.setRawMode
    let dataHandler: ((data: Buffer) => Promise<void>) | undefined
    const resume = vi.fn()
    const setRawMode = vi.fn()
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((..._args: Parameters<typeof process.on>) => process) as never)

    try {
      Object.defineProperty(stdin, 'isTTY', {configurable: true, value: true})
      stdin.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'data') {
          dataHandler = handler as (data: Buffer) => Promise<void>
        }
        return stdin
      }) as never
      stdin.resume = resume
      stdin.setRawMode = setRawMode

      let resolveInteractiveShutdown: (() => void) | undefined
      const interactiveShutdownPromise = new Promise<void>((resolve) => { resolveInteractiveShutdown = resolve })
      const interactiveShutdown = vi.fn(async () => {
        resolveInteractiveShutdown?.()
      })

      const interactiveWait = new Harness([], {} as never).callWaitForShutdown(
        false,
        interactiveShutdown,
        interactiveShutdownPromise,
      )
      await dataHandler?.(Buffer.from('\u0003'))
      await interactiveWait

      const jsonShutdown = vi.fn(async () => undefined)
      await new Harness([], {} as never).callWaitForShutdown(true, jsonShutdown, Promise.resolve())

      expect(interactiveShutdown).toHaveBeenCalledTimes(1)
      expect(jsonShutdown).not.toHaveBeenCalled()
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
      expect(resume).toHaveBeenCalledTimes(1)
      expect(setRawMode).toHaveBeenCalledWith(true)
    } finally {
      Object.defineProperty(stdin, 'isTTY', {configurable: true, value: originalIsTTY})
      stdin.on = originalOn
      stdin.resume = originalResume
      stdin.setRawMode = originalSetRawMode
    }
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

  it('covers build, clean, console, init, and test default helper delegates', async () => {
    const config = createConfig()
    const output = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      result: vi.fn(),
      spinner: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    } as unknown as OutputWriter
    const runner = {run: vi.fn(), spawn: vi.fn(), which: vi.fn()} as never
    const sdk = {build: vi.fn(), codegen: vi.fn(), detectCommand: vi.fn(), getVersion: vi.fn(), startSandbox: vi.fn(), test: vi.fn()} as never
    const builder = {build: vi.fn(), buildWithCodegen: vi.fn(), watch: vi.fn()} as never
    const mockDeployer = {deploy: vi.fn()} as never
    const testRunner = {run: vi.fn()} as never
    const completer = {complete: vi.fn().mockReturnValue([[], ''])} as never
    const executor = {execute: vi.fn()} as never
    const client = {
      allocateParty: vi.fn(),
      getActiveContracts: vi.fn(),
      getLedgerEnd: vi.fn(),
      getParties: vi.fn(),
      getVersion: vi.fn(),
      submitAndWait: vi.fn(),
      uploadDar: vi.fn(),
    } as never
    const topology = {
      bootstrapScript: '',
      cantonConf: '',
      dockerCompose: '',
      participants: [{
        name: 'participant1',
        parties: ['Alice'],
        ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865},
      }],
      synchronizer: {admin: 10001, publicApi: 10002},
    }
    const createBuilderSpy = vi.spyOn(builderModule, 'createBuilder').mockReturnValue(builder)
    const createRunnerSpy = vi.spyOn(processRunnerModule, 'createProcessRunner').mockReturnValue(runner)
    const createSdkSpy = vi.spyOn(damlModule, 'createDamlSdk').mockReturnValue(sdk)
    const createDeployerSpy = vi.spyOn(deployerModule, 'createDeployer').mockReturnValue(mockDeployer)
    const createTestRunnerSpy = vi.spyOn(testRunnerModule, 'createTestRunner').mockReturnValue(testRunner)
    const createCompleterSpy = vi.spyOn(completerModule, 'createCompleter').mockReturnValue(completer)
    const createExecutorSpy = vi.spyOn(executorModule, 'createExecutor').mockReturnValue(executor)
    const createLedgerClientSpy = vi.spyOn(ledgerClientModule, 'createLedgerClient').mockReturnValue(client)
    const createSandboxTokenSpy = vi.spyOn(jwtModule, 'createSandboxToken').mockResolvedValue('sandbox-token')
    const detectTopologySpy = vi.spyOn(topologyModule, 'detectTopology').mockResolvedValue(topology)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'init-helper-'))
    tempDirs.push(tempDir)

    class BuildHarness extends Build {
      public callCreateBuilder() {
        return this.createBuilder({hooks: {emit: vi.fn()} as never, sdk})
      }

      public callCreateHooks() {
        return this.createHooks()
      }

      public callCreateRunner() {
        return this.createRunner()
      }

      public callCreateSdk(commandRunner: ReturnType<typeof processRunnerModule.createProcessRunner>) {
        return this.createSdk(commandRunner)
      }

      public callCreateWatcher() {
        return this.createWatcher()
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }
    }

    class CleanHarness extends Clean {
      public callCreateCleaner() {
        return this.createCleaner(true, output)
      }

      public callCreateReadlineInterface() {
        return this.createReadlineInterface({
          input: new PassThrough(),
          output: new PassThrough(),
        })
      }
    }

    class ConsoleHarness extends Console {
      public callCreateCompleter() {
        return this.createCompleter({partyNames: ['Alice']})
      }

      public callCreateExecutor() {
        return this.createExecutor({client, defaultParty: 'Alice', output})
      }

      public callCreateLedgerClient() {
        return this.createLedgerClient({baseUrl: 'https://ledger.example.com', token: 'jwt'})
      }

      public callCreateReadlineInterface() {
        return this.createReadlineInterface({
          input: new PassThrough(),
          output: new PassThrough(),
        })
      }

      public callCreateSandboxToken() {
        return this.createSandboxToken({
          actAs: ['Alice'],
          admin: true,
          applicationId: 'cantonctl',
          readAs: ['Alice'],
        })
      }

      public callDetectProjectTopology() {
        return this.detectProjectTopology('/repo')
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public callLoadProjectConfig() {
        return this.loadProjectConfig()
      }
    }

    class DeployHarness extends Deploy {
      public callCreateBuilder() {
        return this.createBuilder({hooks: {emit: vi.fn()} as never, sdk})
      }

      public callCreateDeployer() {
        return this.createDeployer({
          builder,
          config,
          hooks: {emit: vi.fn()} as never,
          output,
        })
      }

      public callCreateHooks() {
        return this.createHooks()
      }

      public callCreateRunner() {
        return this.createRunner()
      }

      public callCreateSdk(commandRunner: ReturnType<typeof processRunnerModule.createProcessRunner>) {
        return this.createSdk(commandRunner)
      }

      public callDetectProjectTopology() {
        return this.detectProjectTopology('/repo')
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public callLoadProjectConfig() {
        return this.loadProjectConfig()
      }
    }

    class InitHarness extends Init {
      public callLoadInteractivePrompts() {
        return this.loadInteractivePrompts()
      }

      public async callScaffoldFromUrl() {
        const projectDir = path.join(tempDir, 'community-app')
        return this.scaffoldFromUrl({
          dir: projectDir,
          runner: {
            run: vi.fn().mockImplementation(async (_cmd: string, _args: string[], options: {timeout?: number}) => {
              await fs.mkdir(projectDir, {recursive: true})
              await fs.writeFile(path.join(projectDir, 'cantonctl-template.yaml'), 'name: community\n', 'utf8')
              return {exitCode: 0, stderr: '', stdout: '', ...options}
            }),
            spawn: vi.fn(),
            which: vi.fn(),
          } as never,
          url: 'https://github.com/example/community-template',
        })
      }
    }

    class TestHarness extends Test {
      public callCreateHooks() {
        return this.createHooks()
      }

      public callCreateRunner() {
        return this.createRunner()
      }

      public callCreateSdk(commandRunner: ReturnType<typeof processRunnerModule.createProcessRunner>) {
        return this.createSdk(commandRunner)
      }

      public callCreateTestRunner() {
        return this.createTestRunner({hooks: {emit: vi.fn()} as never, sdk})
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }
    }

    const buildHarness = new BuildHarness([], {} as never)
    const buildWatcher = buildHarness.callCreateWatcher()
    const damlDir = path.join(tempDir, 'daml')
    await fs.mkdir(damlDir, {recursive: true})
    expect(buildHarness.callCreateBuilder()).toBe(builder)
    expect(buildHarness.callCreateHooks()).toEqual(expect.objectContaining({emit: expect.any(Function)}))
    expect(buildHarness.callCreateRunner()).toBe(runner)
    expect(buildHarness.callCreateSdk(runner)).toBe(sdk)
    expect(buildHarness.callGetProjectDir()).toBe(process.cwd())
    const fileWatcher = buildWatcher(damlDir, {ignoreInitial: true})
    expect(fileWatcher).toEqual(expect.objectContaining({close: expect.any(Function)}))
    await fileWatcher.close()

    const cleanHarness = new CleanHarness([], {} as never)
    const cleaner = cleanHarness.callCreateCleaner()
    const cleanProjectDir = path.join(tempDir, 'clean-json')
    await fs.mkdir(path.join(cleanProjectDir, '.daml'), {recursive: true})
    await fs.writeFile(path.join(cleanProjectDir, '.daml', 'artifact.txt'), 'artifact', 'utf8')
    const cleanResult = await cleaner.clean({all: false, force: false, projectDir: cleanProjectDir})
    expect(cleanResult.removed).toContain('.daml')
    const cleanRl = cleanHarness.callCreateReadlineInterface()
    cleanRl.close()

    const consoleHarness = new ConsoleHarness([], {} as never)
    expect(consoleHarness.callCreateCompleter()).toBe(completer)
    expect(consoleHarness.callCreateExecutor()).toBe(executor)
    expect(consoleHarness.callCreateLedgerClient()).toBe(client)
    expect(await consoleHarness.callCreateSandboxToken()).toBe('sandbox-token')
    expect(await consoleHarness.callDetectProjectTopology()).toEqual(topology)
    expect(await consoleHarness.callLoadProjectConfig()).toBe(config)
    expect(consoleHarness.callGetProjectDir()).toBe(process.cwd())
    const consoleRl = consoleHarness.callCreateReadlineInterface()
    consoleRl.close()

    const deployHarness = new DeployHarness([], {} as never)
    expect(deployHarness.callCreateBuilder()).toBe(builder)
    expect(deployHarness.callCreateDeployer()).toBe(mockDeployer)
    expect(deployHarness.callCreateHooks()).toEqual(expect.objectContaining({emit: expect.any(Function)}))
    expect(deployHarness.callCreateRunner()).toBe(runner)
    expect(deployHarness.callCreateSdk(runner)).toBe(sdk)
    expect(await deployHarness.callDetectProjectTopology()).toEqual(topology)
    expect(deployHarness.callGetProjectDir()).toBe(process.cwd())
    expect(await deployHarness.callLoadProjectConfig()).toBe(config)

    const initHarness = new InitHarness([], {} as never)
    const prompts = await initHarness.callLoadInteractivePrompts()
    expect(prompts).toEqual(expect.objectContaining({
      input: expect.any(Function),
      select: expect.any(Function),
    }))
    await expect(initHarness.callScaffoldFromUrl()).resolves.toBeUndefined()

    const testHarness = new TestHarness([], {} as never)
    expect(testHarness.callCreateHooks()).toEqual(expect.objectContaining({emit: expect.any(Function)}))
    expect(testHarness.callCreateRunner()).toBe(runner)
    expect(testHarness.callCreateSdk(runner)).toBe(sdk)
    expect(testHarness.callCreateTestRunner()).toBe(testRunner)
    expect(testHarness.callGetProjectDir()).toBe(process.cwd())

    expect(createBuilderSpy).toHaveBeenCalled()
    expect(createRunnerSpy).toHaveBeenCalled()
    expect(createSdkSpy).toHaveBeenCalled()
    expect(createDeployerSpy).toHaveBeenCalled()
    expect(createTestRunnerSpy).toHaveBeenCalled()
    expect(createCompleterSpy).toHaveBeenCalled()
    expect(createExecutorSpy).toHaveBeenCalled()
    expect(createLedgerClientSpy).toHaveBeenCalledWith({
      baseUrl: 'https://ledger.example.com',
      token: 'jwt',
    })
    expect(createSandboxTokenSpy).toHaveBeenCalled()
    expect(detectTopologySpy).toHaveBeenCalledWith('/repo')
    expect(loadConfigSpy).toHaveBeenCalled()

    const deployerDeps = createDeployerSpy.mock.calls[0]?.[0]
    expect(deployerDeps).toEqual(expect.objectContaining({
      builder,
      config,
      createLedgerClient: expect.any(Function),
      createToken: expect.any(Function),
      fs: expect.objectContaining({readFile: expect.any(Function)}),
      output,
    }))
    const deployerFile = path.join(tempDir, 'deploy-artifact.bin')
    await fs.writeFile(deployerFile, 'artifact', 'utf8')
    await expect(deployerDeps?.fs.readFile(deployerFile)).resolves.toBeInstanceOf(Uint8Array)
  })
})
