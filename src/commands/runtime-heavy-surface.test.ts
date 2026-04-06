import * as fs from 'node:fs'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import type {Builder} from '../lib/builder.js'
import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import type {DamlSdk} from '../lib/daml.js'
import * as deployerModule from '../lib/deployer.js'
import * as devServerModule from '../lib/dev-server.js'
import type {DevServer} from '../lib/dev-server.js'
import * as fullDevServerModule from '../lib/dev-server-full.js'
import type {FullDevServer} from '../lib/dev-server-full.js'
import type {Deployer} from '../lib/deployer.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import * as runtimeSupportModule from '../lib/runtime-support.js'
import * as topologyModule from '../lib/topology.js'
import type {GeneratedTopology} from '../lib/topology.js'
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

  it('handles multi-node and remote deploy paths and default helpers', async () => {
    const deploy = vi
      .fn()
      .mockResolvedValueOnce({
        darPath: '/repo/.daml/dist/demo.dar',
        dryRun: false,
        durationMs: 10,
        mainPackageId: undefined,
        network: 'local',
        success: true,
      })
      .mockResolvedValueOnce({
        darPath: '/repo/.daml/dist/demo.dar',
        dryRun: false,
        durationMs: 12,
        mainPackageId: 'pkg-2',
        network: 'local',
        success: true,
      })

    class MultiNodeDeploy extends Deploy {
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

      protected override async detectProjectTopology(): Promise<GeneratedTopology> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [
            {name: 'participant-a', parties: ['Alice'], ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865}},
            {name: 'participant-b', parties: ['Bob'], ports: {admin: 2002, jsonApi: 7576, ledgerApi: 6866}},
          ],
          synchronizer: {admin: 10001, publicApi: 10002},
        }
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    class HandledDeployError extends Deploy {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'add config'})
      }
    }

    class RemoteDeploy extends Deploy {
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
            durationMs: 9,
            mainPackageId: 'pkg-remote',
            network: 'devnet',
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

      protected override async detectProjectTopology(): Promise<GeneratedTopology> {
        throw new Error('should not inspect local topology')
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          networks: {
            ...createConfig().networks,
            devnet: {type: 'remote', url: 'https://ledger.example.com'},
          },
        }
      }
    }

    class DeployHarness extends Deploy {
      public callCreateDeployer(deps: Parameters<Deploy['createDeployer']>[0]) {
        return this.createDeployer(deps)
      }

      public async callDetectProjectTopology(projectDir: string) {
        return this.detectProjectTopology(projectDir)
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public async callLoadProjectConfig() {
        return this.loadProjectConfig()
      }

      public async run(): Promise<void> {}
    }

    const result = await captureOutput(() => MultiNodeDeploy.run(['local', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        dryRun: false,
        mode: 'multi-node',
        network: 'local',
        participants: [
          {mainPackageId: null, participant: 'participant-a', port: 7575},
          {mainPackageId: 'pkg-2', participant: 'participant-b', port: 7576},
        ],
      },
      success: true,
    }))

    const handled = await captureOutput(() => HandledDeployError.run(['local', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    const remote = await captureOutput(() => RemoteDeploy.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(remote.error).toBeUndefined()
    expect(parseJson(remote.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({network: 'devnet'}),
      success: true,
    }))

    let capturedDeps: Parameters<typeof deployerModule.createDeployer>[0] | undefined
    vi.spyOn(deployerModule, 'createDeployer').mockImplementation((deps) => {
      capturedDeps = deps
      return {deploy: vi.fn()} as never
    })
    const detectTopologySpy = vi.spyOn(topologyModule, 'detectTopology').mockResolvedValue(null)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())

    const harness = new DeployHarness([], {} as never)
    harness.callCreateDeployer({
      builder: {
        build: vi.fn(),
        buildWithCodegen: vi.fn(),
        watch: vi.fn(),
      },
      config: createConfig(),
      hooks: {emit: vi.fn()} as never,
      output: {result: vi.fn()} as never,
    })

    const helperDir = fs.mkdtempSync(path.join(tmpdir(), 'cantonctl-deploy-helper-'))
    const helperFile = path.join(helperDir, 'file.txt')
    fs.writeFileSync(helperFile, 'deploy-helper', 'utf8')

    try {
      await expect(capturedDeps?.fs.readFile(helperFile)).resolves.toEqual(Buffer.from('deploy-helper'))
      await expect(harness.callDetectProjectTopology('/repo')).resolves.toBeNull()
      expect(harness.callGetProjectDir()).toBe(process.cwd())
      await expect(harness.callLoadProjectConfig()).resolves.toEqual(createConfig())
      expect(detectTopologySpy).toHaveBeenCalledWith('/repo')
      expect(loadConfigSpy).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(helperDir, {force: true, recursive: true})
    }
  })

  it('covers dev net mode, shutdown cleanup, and default helpers', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn().mockResolvedValue(undefined)

    class NetDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createFullServer(): FullDevServer {
        return {start, stop}
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const errorStop = vi.fn().mockResolvedValue(undefined)
    class HandledDevError extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createFullServer(): FullDevServer {
        return {
          start: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.DOCKER_NOT_AVAILABLE, {suggestion: 'start docker'})),
          stop: errorStop,
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const sandboxShutdownStop = vi.fn().mockResolvedValue(undefined)
    class ShutdownSandboxDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          stop: sandboxShutdownStop,
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(
        _json: boolean,
        shutdown: () => Promise<void>,
      ): Promise<void> {
        await shutdown()
        await shutdown()
      }
    }

    const netShutdownStop = vi.fn().mockResolvedValue(undefined)
    class ShutdownNetDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createFullServer(): FullDevServer {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          stop: netShutdownStop,
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(
        _json: boolean,
        shutdown: () => Promise<void>,
      ): Promise<void> {
        await shutdown()
      }
    }

    class JsonDefaultsNetDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createFullServer(): FullDevServer {
        return {start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined)}
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    class JsonDefaultsSandboxDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined)}
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    class UnexpectedDevError extends Dev {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('dev boom')
      }
    }

    class DevHarness extends Dev {
      public callCleanupInteractiveInput(json: boolean) {
        return this.cleanupInteractiveInput(json)
      }

      public callCreateFullServer(deps: Parameters<Dev['createFullServer']>[0]) {
        return this.createFullServer(deps)
      }

      public callCreateSandboxServer(deps: Parameters<Dev['createSandboxServer']>[0]) {
        return this.createSandboxServer(deps)
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public callIsManagedPortInUse(port: number) {
        return this.isManagedPortInUse(port)
      }

      public async callLoadProjectConfig() {
        return this.loadProjectConfig()
      }

      public async callWaitForShutdown(
        json: boolean,
        shutdown: () => Promise<void>,
        shutdownPromise: Promise<void>,
      ) {
        return this.waitForShutdown(json, shutdown, shutdownPromise)
      }

      public async run(): Promise<void> {}
    }

    const net = await captureOutput(() => NetDev.run([
      '--net',
      '--base-port',
      '21000',
      '--topology',
      'demo',
      '--json',
    ], {root: CLI_ROOT}))
    expect(net.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      basePort: 21000,
      projectDir: process.cwd(),
      topologyName: 'demo',
    }))
    expect(parseJson(net.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'net',
        parties: ['Alice'],
        status: 'running',
        topology: 'demo',
      },
      success: true,
    }))

    const handled = await captureOutput(() => HandledDevError.run(['--net', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(errorStop).toHaveBeenCalledTimes(1)
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.DOCKER_NOT_AVAILABLE}),
      success: false,
    }))

    const sandboxShutdown = await captureOutput(() => ShutdownSandboxDev.run([], {root: CLI_ROOT}))
    expect(sandboxShutdown.error).toBeUndefined()
    expect(sandboxShutdownStop).toHaveBeenCalledTimes(1)

    const netShutdown = await captureOutput(() => ShutdownNetDev.run(['--net'], {root: CLI_ROOT}))
    expect(netShutdown.error).toBeUndefined()
    expect(netShutdownStop).toHaveBeenCalledTimes(1)

    const jsonDefaultsNet = await captureOutput(() => JsonDefaultsNetDev.run(['--net', '--json'], {root: CLI_ROOT}))
    expect(jsonDefaultsNet.error).toBeUndefined()
    expect(jsonDefaultsNet.stdout).toContain('"parties":[]')
    expect(jsonDefaultsNet.stdout).toContain('"topology":"default"')

    const jsonDefaultsSandbox = await captureOutput(() => JsonDefaultsSandboxDev.run(['--json'], {root: CLI_ROOT}))
    expect(jsonDefaultsSandbox.error).toBeUndefined()
    expect(jsonDefaultsSandbox.stdout).toContain('"parties":[]')

    await expect(UnexpectedDevError.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('dev boom')

    let capturedFullDeps: Parameters<typeof fullDevServerModule.createFullDevServer>[0] | undefined
    let capturedSandboxDeps: Parameters<typeof devServerModule.createDevServer>[0] | undefined
    vi.spyOn(fullDevServerModule, 'createFullDevServer').mockImplementation((deps) => {
      capturedFullDeps = deps
      return {start: vi.fn(), stop: vi.fn()} as never
    })
    vi.spyOn(devServerModule, 'createDevServer').mockImplementation((deps) => {
      capturedSandboxDeps = deps
      return {start: vi.fn(), stop: vi.fn()} as never
    })
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const portSpy = vi.spyOn(runtimeSupportModule, 'isTcpPortInUse').mockResolvedValue(true)

    const harness = new DevHarness([], {} as never)
    const sdk = createSdk()
    const docker = {composeDown: vi.fn(), composePs: vi.fn(), composeUp: vi.fn()} as never
    harness.callCreateFullServer({
      cantonImage: 'image',
      config: createConfig(),
      docker,
      output: {result: vi.fn()} as never,
      sdk,
    })
    harness.callCreateSandboxServer({
      config: createConfig(),
      output: {result: vi.fn()} as never,
      sdk,
    })

    const helperDir = fs.mkdtempSync(path.join(tmpdir(), 'cantonctl-dev-helper-'))
    const helperFile = path.join(helperDir, 'helper.txt')
    const helperDir2 = path.join(helperDir, 'nested')
    fs.mkdirSync(helperDir2)

    try {
      await capturedFullDeps?.build('/repo')
      await capturedFullDeps?.mkdir(helperDir2)
      await capturedFullDeps?.writeFile(helperFile, 'hello')
      await expect(capturedFullDeps?.readFile(helperFile)).resolves.toEqual(Buffer.from('hello'))
      await capturedFullDeps?.rmdir(helperDir2)
      const fullWatcher = capturedFullDeps?.watch(helperDir, {})

      expect(capturedSandboxDeps?.isPortInUse).toBeDefined()
      await expect(capturedSandboxDeps!.isPortInUse!(7575)).resolves.toBe(true)
      await expect(capturedSandboxDeps?.readFile(helperFile)).resolves.toEqual(Buffer.from('hello'))
      const sandboxWatcher = capturedSandboxDeps?.watch(helperDir, {})

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

      try {
        let resolveShutdownPromise: (() => void) | null = null
        const shutdownPromise = new Promise<void>((resolve) => {
          resolveShutdownPromise = resolve
        })
        const shutdown = vi.fn().mockImplementation(async () => {
          resolveShutdownPromise?.()
        })

        await harness.callWaitForShutdown(false, shutdown, shutdownPromise)
        expect(setRawMode).toHaveBeenCalledWith(true)
        expect(resume).toHaveBeenCalledTimes(1)

        harness.callCleanupInteractiveInput(false)
        expect(setRawMode).toHaveBeenCalledWith(false)
        expect(pause).toHaveBeenCalledTimes(1)
      } finally {
        restoreStdinTty()
        ;(process.stdin as {setRawMode?: (value: boolean) => void}).setRawMode = originalSetRawMode
        process.stdin.resume = originalResume
        process.stdin.pause = originalPause
        process.stdin.on = originalOn
      }

      await expect(
        harness.callWaitForShutdown(true, vi.fn(), Promise.resolve()),
      ).resolves.toBeUndefined()

      expect(harness.callGetProjectDir()).toBe(process.cwd())
      await expect(harness.callIsManagedPortInUse(7575)).resolves.toBe(true)
      await expect(harness.callLoadProjectConfig()).resolves.toEqual(createConfig())
      await fullWatcher?.close()
      await sandboxWatcher?.close()
      expect(loadConfigSpy).toHaveBeenCalledTimes(1)
      expect(portSpy).toHaveBeenCalledWith(7575)
    } finally {
      fs.rmSync(helperDir, {force: true, recursive: true})
    }
  })
})
