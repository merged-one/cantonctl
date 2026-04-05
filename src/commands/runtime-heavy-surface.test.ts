import {captureOutput} from '@oclif/test'
import {mkdtempSync, rmSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

import type {Builder} from '../lib/builder.js'
import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import type {DamlSdk} from '../lib/daml.js'
import type {DevServer} from '../lib/dev-server.js'
import * as devServerModule from '../lib/dev-server.js'
import * as devServerFullModule from '../lib/dev-server-full.js'
import type {Deployer} from '../lib/deployer.js'
import * as deployerModule from '../lib/deployer.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import {createOutput} from '../lib/output.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import Deploy from './deploy.js'
import Dev from './dev.js'

const CLI_ROOT = process.cwd()

afterEach(() => {
  vi.restoreAllMocks()
})

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networks: {
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
    parties: [{name: 'Alice', role: 'operator'}],
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575},
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

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

describe('runtime-heavy command surface', () => {
  it('deploy emits single-node results in json mode', async () => {
    class TestDeploy extends Deploy {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        }
      }

      protected override createDeployer(): Deployer {
        return {
          deploy: vi.fn().mockResolvedValue({
            darPath: '/repo/.daml/dist/demo.dar',
            dryRun: false,
            durationMs: 35,
            mainPackageId: 'pkg-1',
            network: 'local',
            success: true,
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

      protected override async detectProjectTopology(): Promise<null> {
        return null
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDeploy.run(['local', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        darPath: '/repo/.daml/dist/demo.dar',
        dryRun: false,
        mainPackageId: 'pkg-1',
        network: 'local',
      },
      success: true,
    }))
  })

  it('starts sandbox-mode dev and emits json status', async () => {
    const start = vi.fn().mockResolvedValue(undefined)

    class TestDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start,
          stop: vi.fn().mockResolvedValue(undefined),
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestDev.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      jsonApiPort: 7575,
      port: 5001,
      projectDir: process.cwd(),
    }))
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        jsonApiPort: 7575,
        mode: 'sandbox',
        parties: ['Alice'],
        port: 5001,
        status: 'running',
      },
      success: true,
    }))
  })

  it('defaults sandbox json parties to an empty list when none are configured', async () => {
    class TestDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestDev.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        parties: [],
      }),
      success: true,
    }))
  })

  it('serializes dev validation failures', async () => {
    class TestDev extends Dev {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDev.run(['--json', '--topology', 'demo'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))
  })

  it('deploy emits multi-node results in json mode', async () => {
    const deploy = vi.fn()
      .mockResolvedValueOnce({
        darPath: '/repo/.daml/dist/demo-a.dar',
        dryRun: false,
        durationMs: 35,
        mainPackageId: null,
        network: 'local',
        success: true,
      })
      .mockResolvedValueOnce({
        darPath: '/repo/.daml/dist/demo-b.dar',
        dryRun: false,
        durationMs: 36,
        mainPackageId: 'pkg-2',
        network: 'local',
        success: true,
      })

    class TestDeploy extends Deploy {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        }
      }

      protected override createDeployer(): Deployer {
        return {deploy}
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

      protected override async detectProjectTopology() {
        return {
          participants: [
            {name: 'participant-a', ports: {jsonApi: 5011}},
            {name: 'participant-b', ports: {jsonApi: 5012}},
          ],
        } as never
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDeploy.run(['local', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        dryRun: false,
        mode: 'multi-node',
        network: 'local',
        participants: [
          {mainPackageId: null, participant: 'participant-a', port: 5011},
          {mainPackageId: 'pkg-2', participant: 'participant-b', port: 5012},
        ],
      },
      success: true,
    }))
  })

  it('serializes structured deploy failures', async () => {
    class TestDeploy extends Deploy {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        }
      }

      protected override createDeployer(): Deployer {
        return {
          deploy: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.DEPLOY_AUTH_FAILED, {
            suggestion: 'login first',
          })),
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

      protected override async detectProjectTopology(): Promise<null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDeploy.run(['local', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.DEPLOY_AUTH_FAILED,
        suggestion: 'login first',
      }),
      success: false,
    }))
  })

  it('skips topology detection for non-local deploy targets', async () => {
    const deploy = vi.fn().mockResolvedValue({
      darPath: '/repo/.daml/dist/demo.dar',
      dryRun: false,
      durationMs: 35,
      mainPackageId: 'pkg-remote',
      network: 'devnet',
      success: true,
    })
    const detectProjectTopology = vi.fn().mockResolvedValue({
      participants: [{name: 'participant-a', ports: {jsonApi: 5011}}],
    })

    class TestDeploy extends Deploy {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        }
      }

      protected override createDeployer(): Deployer {
        return {deploy}
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

      protected override async detectProjectTopology(): Promise<null> {
        return detectProjectTopology() as never
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDeploy.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(detectProjectTopology).not.toHaveBeenCalled()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        network: 'devnet',
      }),
      success: true,
    }))
  })

  it('starts net-mode dev and emits json status', async () => {
    const start = vi.fn().mockResolvedValue(undefined)

    class NetDev extends Dev {
      protected override createDockerManager() {
        return {
          composeDown: vi.fn(),
          composeUp: vi.fn(),
          findComposeFile: vi.fn(),
          isDockerAvailable: vi.fn(),
          runInContainer: vi.fn(),
          waitForHealth: vi.fn(),
        } as never
      }

      protected override createFullServer() {
        return {
          start,
          stop: vi.fn().mockResolvedValue(undefined),
        } as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => NetDev.run(['--net', '--json', '--topology', 'demo'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      basePort: undefined,
      cantonImage: undefined,
      projectDir: process.cwd(),
      topologyName: 'demo',
    }))
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'net',
        parties: ['Alice'],
        status: 'running',
        topology: 'demo',
      },
      success: true,
    }))
  })

  it('defaults net-mode json parties and topology when omitted', async () => {
    class NetDev extends Dev {
      protected override createDockerManager() {
        return {} as never
      }

      protected override createFullServer() {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
        } as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => NetDev.run(['--net', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'net',
        parties: [],
        status: 'running',
        topology: 'default',
      },
      success: true,
    }))
  })

  it('stops dev servers on structured and unexpected net-mode failures', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)

    class StructuredNetDev extends Dev {
      protected override createDockerManager() {
        return {} as never
      }

      protected override createFullServer() {
        return {
          start: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
            suggestion: 'fix topology',
          })),
          stop,
        } as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const structured = await captureOutput(() => StructuredNetDev.run(['--net', '--json'], {root: CLI_ROOT}))
    expect(structured.error).toBeDefined()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(parseJson(structured.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
        suggestion: 'fix topology',
      }),
      success: false,
    }))

    class UnexpectedNetDev extends Dev {
      protected override createDockerManager() {
        return {} as never
      }

      protected override createFullServer() {
        return {
          start: vi.fn().mockRejectedValue(new Error('net boom')),
          stop,
        } as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    await expect(UnexpectedNetDev.run(['--net', '--json'], {root: CLI_ROOT})).rejects.toThrow('net boom')
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('exercises deploy and dev default helper factories', async () => {
    let capturedDeployDeps: Parameters<typeof deployerModule.createDeployer>[0] | undefined
    let capturedFullServerDeps: Parameters<typeof devServerFullModule.createFullDevServer>[0] | undefined
    let capturedSandboxServerDeps: Parameters<typeof devServerModule.createDevServer>[0] | undefined

    vi.spyOn(deployerModule, 'createDeployer').mockImplementation((deps) => {
      capturedDeployDeps = deps
      return {deploy: vi.fn()} as never
    })
    vi.spyOn(devServerFullModule, 'createFullDevServer').mockImplementation((deps) => {
      capturedFullServerDeps = deps
      return {start: vi.fn(), stop: vi.fn()} as never
    })
    vi.spyOn(devServerModule, 'createDevServer').mockImplementation((deps) => {
      capturedSandboxServerDeps = deps
      return {start: vi.fn(), stop: vi.fn()} as never
    })
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())

    class Harness extends Deploy {
      public async exposeDeployHelpers() {
        const runner = this.createRunner()
        const sdk = this.createSdk(runner)
        const hooks = this.createHooks()
        const builder = this.createBuilder({hooks, sdk})
        this.createDeployer({
          builder,
          config: createConfig(),
          hooks,
          output: createOutput({json: true}),
        })
        return this.loadProjectConfig()
      }
    }

    class DevHarness extends Dev {
      public async exposeDevHelpers() {
        const out = createOutput({json: true})
        const runner = this.createRunner()
        const sdk = {
          build: vi.fn().mockResolvedValue(undefined),
          codegen: vi.fn(),
          detectCommand: vi.fn(),
          getVersion: vi.fn(),
          startSandbox: vi.fn(),
          test: vi.fn(),
        } as unknown as DamlSdk
        const docker = this.createDockerManager(out, runner)
        this.createFullServer({
          cantonImage: 'example-image',
          config: createConfig(),
          docker,
          output: out,
          sdk,
        })
        this.createSandboxServer({config: createConfig(), output: out, sdk})
        return this.loadProjectConfig()
      }

      public cleanup(json: boolean) {
        this.cleanupInteractiveInput(json)
      }

      public wait(json: boolean, shutdown: () => Promise<void>, shutdownPromise: Promise<void>) {
        return this.waitForShutdown(json, shutdown, shutdownPromise)
      }
    }

    expect(await new Harness([], {} as never).exposeDeployHelpers()).toEqual(createConfig())
    expect(await new DevHarness([], {} as never).exposeDevHelpers()).toEqual(createConfig())

    const tempRoot = mkdtempSync(join(tmpdir(), 'cantonctl-runtime-helpers-'))
    const darPath = join(tempRoot, 'demo.dar')
    const scratchDir = join(tempRoot, 'scratch')
    await fs.mkdir(scratchDir)
    await fs.writeFile(darPath, 'dar-bytes', 'utf8')

    try {
      expect(capturedDeployDeps).toBeDefined()
      await expect(capturedDeployDeps!.fs.readFile(darPath)).resolves.toBeInstanceOf(Uint8Array)

      expect(capturedFullServerDeps).toBeDefined()
      await capturedFullServerDeps!.build(tempRoot)
      const fullWatcher = capturedFullServerDeps!.watch(darPath, {ignoreInitial: true})
      await fullWatcher.close()
      await capturedFullServerDeps!.mkdir(join(tempRoot, 'created'))
      await capturedFullServerDeps!.writeFile(join(tempRoot, 'created', 'note.txt'), 'hello')
      await expect(capturedFullServerDeps!.readFile(darPath)).resolves.toBeInstanceOf(Uint8Array)
      await capturedFullServerDeps!.rmdir(join(tempRoot, 'created'))

      expect(capturedSandboxServerDeps).toBeDefined()
      const sandboxWatcher = capturedSandboxServerDeps!.watch(darPath, {ignoreInitial: true})
      await sandboxWatcher.close()
      await expect(capturedSandboxServerDeps!.readFile(darPath)).resolves.toBeInstanceOf(Uint8Array)
      await expect(capturedSandboxServerDeps!.isPortInUse(65530)).resolves.toBe(false)

      const harness = new DevHarness([], {} as never)
      let stdinHandler: ((data: Buffer) => Promise<void>) | undefined
      let resolveShutdown: (() => void) | undefined
      const shutdown = vi.fn().mockImplementation(async () => {
        resolveShutdown?.()
      })
      const shutdownPromise = new Promise<void>(resolve => { resolveShutdown = resolve })
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

      try {
        const waiting = harness.wait(false, shutdown, shutdownPromise)
        await stdinHandler?.(Buffer.from('x'))
        expect(shutdown).toHaveBeenCalledTimes(0)
        await stdinHandler?.(Buffer.from('\u0003'))
        await waiting
        harness.cleanup(false)
        expect(shutdown).toHaveBeenCalledTimes(1)
        expect(process.stdin.setRawMode).toHaveBeenNthCalledWith(1, true)
        expect(process.stdin.setRawMode).toHaveBeenNthCalledWith(2, false)
        expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
        expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))

        await expect(harness.wait(true, vi.fn(), Promise.resolve())).resolves.toBeUndefined()
      } finally {
        ;(process.stdin as typeof process.stdin & {isTTY: boolean}).isTTY = originalIsTTY
        process.stdin.setRawMode = originalSetRawMode
        process.stdin.resume = originalResume
        process.stdin.pause = originalPause
        process.stdin.on = originalOn
        processOnSpy.mockRestore()
      }
    } finally {
      rmSync(tempRoot, {force: true, recursive: true})
    }
  })

  it('runs sandbox dev interactively and executes the shutdown closure', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
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

    class InteractiveDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start,
          stop,
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    try {
      const running = captureOutput(() => InteractiveDev.run([], {root: CLI_ROOT}))
      while (!stdinHandler) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      await stdinHandler(Buffer.from('q'))
      await stdinHandler(Buffer.from('q'))
      const result = await running
      expect(result.error).toBeUndefined()
      expect(stop).toHaveBeenCalledTimes(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain('Shutting down...')
      expect(`${result.stdout}\n${result.stderr}`).toContain('Canton sandbox stopped')
      expect(result.stdout).toContain('"status": "stopped"')
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

  it('runs net-mode dev interactively and executes the net shutdown branch', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
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

    class InteractiveNetDev extends Dev {
      protected override createDockerManager() {
        return {} as never
      }

      protected override createFullServer() {
        return {
          start,
          stop,
        } as never
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    try {
      const running = captureOutput(() => InteractiveNetDev.run(['--net'], {root: CLI_ROOT}))
      while (!stdinHandler) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      await stdinHandler(Buffer.from('q'))
      const result = await running
      expect(result.error).toBeUndefined()
      expect(stop).toHaveBeenCalledTimes(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain('Local Canton net topology stopped')
    } finally {
      ;(process.stdin as typeof process.stdin & {isTTY: boolean}).isTTY = originalIsTTY
      process.stdin.setRawMode = originalSetRawMode
      process.stdin.resume = originalResume
      process.stdin.pause = originalPause
      process.stdin.on = originalOn
    }
  })

  it('rethrows unexpected deploy failures', async () => {
    class TestDeploy extends Deploy {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        }
      }

      protected override createDeployer(): Deployer {
        return {
          deploy: vi.fn().mockRejectedValue(new Error('boom')),
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

      protected override async detectProjectTopology(): Promise<null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    await expect(TestDeploy.run(['local', '--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
  })
})
