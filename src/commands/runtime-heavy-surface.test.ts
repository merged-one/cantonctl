import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import type {Builder} from '../lib/builder.js'
import type {Completer} from '../lib/repl/completer.js'
import type {Executor} from '../lib/repl/executor.js'
import type {CantonctlConfig} from '../lib/config.js'
import type {DamlSdk} from '../lib/daml.js'
import type {DevServer} from '../lib/dev-server.js'
import type {FullDevServer} from '../lib/dev-server-full.js'
import type {Deployer} from '../lib/deployer.js'
import type {DockerManager} from '../lib/docker.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {LedgerClient} from '../lib/ledger-client.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import type {ServeServer} from '../lib/serve.js'
import type {TestRunner} from '../lib/test-runner.js'
import type {GeneratedTopology} from '../lib/topology.js'
import Console from './console.js'
import Deploy from './deploy.js'
import Dev from './dev.js'
import Playground from './playground.js'
import Serve from './serve.js'

const CLI_ROOT = process.cwd()

afterEach(() => {
  vi.restoreAllMocks()
})

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networks: {
      devnet: {type: 'remote', url: 'https://ledger.example.com'},
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
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {issuer: 'https://login.example.com', kind: 'oidc'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com/api/validator'},
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

function createServeBuilder(): Builder {
  return {
    build: vi.fn(),
    buildWithCodegen: vi.fn(),
    watch: vi.fn(),
  }
}

function createServeTestRunner(): TestRunner {
  return {
    run: vi.fn(),
  }
}

function createSingleTopology(): GeneratedTopology {
  return {
    bootstrapScript: '',
    cantonConf: '',
    dockerCompose: '',
    participants: [{
      name: 'participant1',
      parties: ['Alice'],
      ports: {
        admin: 2001,
        jsonApi: 7575,
        ledgerApi: 6865,
      },
    }],
    synchronizer: {admin: 10001, publicApi: 10002},
  }
}

function createMultiTopology(): GeneratedTopology {
  return {
    bootstrapScript: '',
    cantonConf: '',
    dockerCompose: '',
    participants: [
      {
        name: 'participant1',
        parties: ['Alice'],
        ports: {
          admin: 2001,
          jsonApi: 7575,
          ledgerApi: 6865,
        },
      },
      {
        name: 'participant2',
        parties: ['Bob'],
        ports: {
          admin: 2002,
          jsonApi: 7576,
          ledgerApi: 6866,
        },
      },
    ],
    synchronizer: {admin: 10001, publicApi: 10002},
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function parseJsonLines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
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

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual({
      darPath: '/repo/.daml/dist/demo.dar',
      dryRun: false,
      mainPackageId: 'pkg-1',
      network: 'local',
    })
  })

  it('deploy renders single-node progress in human mode', async () => {
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
            dryRun: true,
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

    const result = await captureOutput(() => TestDeploy.run(['local', '--dry-run'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Deploying to local...')
    expect(result.stdout).toContain('"darPath": "/repo/.daml/dist/demo.dar"')
    expect(result.stdout).toContain('Done in 0.0s')
  })

  it('deploy emits multi-node results in json mode', async () => {
    class TestDeploy extends Deploy {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        }
      }

      protected override createDeployer(deps: {config: CantonctlConfig}): Deployer {
        return {
          deploy: vi.fn().mockImplementation(async () => ({
            darPath: '/repo/.daml/dist/demo.dar',
            dryRun: false,
            durationMs: 20,
            mainPackageId: String(deps.config.networks?.local?.['json-api-port']),
            network: 'local',
            success: true,
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

      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return createMultiTopology()
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

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      mode: 'multi-node',
      participants: [
        {mainPackageId: '7575', participant: 'participant1', port: 7575},
        {mainPackageId: '7576', participant: 'participant2', port: 7576},
      ],
    }))
  })

  it('deploy falls back to single-node mode when topology has no participants', async () => {
    const deploy = vi.fn().mockResolvedValue({
      darPath: '/repo/.daml/dist/demo.dar',
      dryRun: false,
      durationMs: 35,
      mainPackageId: 'pkg-1',
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

      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return {
          bootstrapScript: '',
          cantonConf: '',
          dockerCompose: '',
          participants: [],
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

    const result = await captureOutput(() => TestDeploy.run(['local', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(deploy).toHaveBeenCalledOnce()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      mainPackageId: 'pkg-1',
      network: 'local',
    }))
  })

  it('deploy bypasses topology detection for non-local networks', async () => {
    const detectProjectTopology = vi.fn()

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
            mainPackageId: 'pkg-devnet',
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

      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        detectProjectTopology()
        return createMultiTopology()
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDeploy.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(detectProjectTopology).not.toHaveBeenCalled()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      network: 'devnet',
      mainPackageId: 'pkg-devnet',
    }))
  })

  it('deploy renders multi-node progress in human mode', async () => {
    class TestDeploy extends Deploy {
      protected override createBuilder(): Builder {
        return {
          build: vi.fn(),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        }
      }

      protected override createDeployer(deps: {config: CantonctlConfig}): Deployer {
        return {
          deploy: vi.fn().mockResolvedValue({
            darPath: '/repo/.daml/dist/demo.dar',
            dryRun: true,
            durationMs: 20,
            mainPackageId: String(deps.config.networks?.local?.['json-api-port']),
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

      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return createMultiTopology()
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDeploy.run(['local', '--dry-run'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Deploying to local (multi-node: 2 participants)...')
    expect(result.stdout).toContain('Deploying to participant1 (port 7575)...')
    expect(result.stdout).toContain('"participant": "participant1"')
    expect(result.stdout).toContain('"dryRun": true')
  })

  it('serializes deploy failures through CantonctlError', async () => {
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
          deploy: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.DEPLOY_UPLOAD_FAILED, {
            suggestion: 'Retry against a reachable participant.',
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

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.DEPLOY_UPLOAD_FAILED,
      suggestion: 'Retry against a reachable participant.',
    }))
  })

  it('dev emits sandbox status in json mode', async () => {
    const start = vi.fn().mockResolvedValue(undefined)

    class TestDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start,
          stop: vi.fn(),
        }
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
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

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      jsonApiPort: 7575,
      mode: 'sandbox',
      parties: ['Alice'],
      port: 5001,
      status: 'running',
    }))
  })

  it('dev stops the managed sandbox when startup fails', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)

    class TestDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE)),
          stop,
        }
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDev.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(stop).toHaveBeenCalled()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.SANDBOX_PORT_IN_USE,
    }))
  })

  it('dev renders sandbox startup in human mode', async () => {
    const start = vi.fn().mockResolvedValue(undefined)

    class TestDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start,
          stop: vi.fn(),
        }
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestDev.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      jsonApiPort: 7575,
      port: 5001,
      projectDir: process.cwd(),
    }))
    expect(result.stdout).not.toContain('"success"')
  })

  it('dev emits full-topology status in json mode', async () => {
    const start = vi.fn().mockResolvedValue(undefined)

    class TestDev extends Dev {
      protected override createDockerManager(): DockerManager {
        return {
          composeDown: vi.fn(),
          composePs: vi.fn(),
          composeUp: vi.fn(),
          ensureImage: vi.fn(),
          isDockerAvailable: vi.fn(),
        } as never
      }

      protected override createFullServer(): FullDevServer {
        return {
          start,
          stop: vi.fn(),
        }
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

    const result = await captureOutput(() => TestDev.run(['--json', '--full'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      basePort: 10000,
      projectDir: process.cwd(),
    }))

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      mode: 'full',
      parties: ['Alice'],
      status: 'running',
    }))
  })

  it('dev emits sandbox stop events when shutdown is requested', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn().mockResolvedValue(undefined)

    class TestDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start,
          stop,
        }
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override async waitForShutdown(
        _json: boolean,
        shutdown: () => Promise<void>,
        _shutdownPromise: Promise<void>,
      ): Promise<void> {
        await shutdown()
      }
    }

    const result = await captureOutput(() => TestDev.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalled()
    expect(stop).toHaveBeenCalled()

    const lines = parseJsonLines(result.stdout)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({mode: 'sandbox', status: 'running'}),
      success: true,
    }))
    expect(lines[1]).toEqual({
      data: {status: 'stopped'},
      success: true,
    })
  })

  it('dev emits full-topology stop events when shutdown is requested', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn().mockResolvedValue(undefined)

    class TestDev extends Dev {
      protected override createDockerManager(): DockerManager {
        return {
          composeDown: vi.fn(),
          composePs: vi.fn(),
          composeUp: vi.fn(),
          ensureImage: vi.fn(),
          isDockerAvailable: vi.fn(),
        } as never
      }

      protected override createFullServer(): FullDevServer {
        return {
          start,
          stop,
        }
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

      protected override async waitForShutdown(
        _json: boolean,
        shutdown: () => Promise<void>,
        _shutdownPromise: Promise<void>,
      ): Promise<void> {
        await shutdown()
      }
    }

    const result = await captureOutput(() => TestDev.run(['--json', '--full'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalled()
    expect(stop).toHaveBeenCalled()

    const lines = parseJsonLines(result.stdout)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({mode: 'full', status: 'running'}),
      success: true,
    }))
    expect(lines[1]).toEqual({
      data: {status: 'stopped'},
      success: true,
    })
  })

  it('serve emits connection metadata in json mode', async () => {
    const start = vi.fn().mockResolvedValue(undefined)

    class TestServe extends Serve {
      protected override createManagedSandboxServer(): DevServer {
        return {
          start: vi.fn(),
          stop: vi.fn(),
        }
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createServeBuilder(): Builder {
        return createServeBuilder()
      }

      protected override createServeServer(): ServeServer {
        return {
          broadcast: vi.fn(),
          start,
          stop: vi.fn(),
        }
      }

      protected override createServeTestRunner(): TestRunner {
        return createServeTestRunner()
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async isServePortInUse(): Promise<boolean> {
        return false
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override projectExists(): boolean {
        return true
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestServe.run(['--json', '--no-sandbox'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      ledgerUrl: 'http://localhost:7575',
      port: 4000,
      profileName: 'sandbox',
      projectDir: '/repo',
    }))

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      ledgerUrl: 'http://localhost:7575',
      port: 4000,
      profile: expect.objectContaining({kind: 'sandbox', name: 'sandbox'}),
      projectDir: '/repo',
      protocol: 'canton-ide-protocol/v1',
      websocket: 'ws://localhost:4000',
    }))
  })

  it('serve fails fast when the project directory is not a cantonctl project', async () => {
    class TestServe extends Serve {
      protected override projectExists(): boolean {
        return false
      }
    }

    const result = await captureOutput(() => TestServe.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.error).toMatchObject({code: ErrorCode.CONFIG_NOT_FOUND})
  })

  it('serve fails before startup when the requested port is already occupied', async () => {
    class TestServe extends Serve {
      protected override async isServePortInUse(): Promise<boolean> {
        return true
      }

      protected override projectExists(): boolean {
        return true
      }
    }

    const result = await captureOutput(() => TestServe.run(['--json', '--port', '4100'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.error).toMatchObject({code: ErrorCode.SANDBOX_PORT_IN_USE})
  })

  it('serve starts a managed sandbox and prints connection info in human mode', async () => {
    const sandboxStart = vi.fn().mockResolvedValue(undefined)
    const serverStart = vi.fn().mockResolvedValue(undefined)

    class TestServe extends Serve {
      protected override createManagedSandboxServer(): DevServer {
        return {
          start: sandboxStart,
          stop: vi.fn(),
        }
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createServeBuilder(): Builder {
        return createServeBuilder()
      }

      protected override createServeServer(): ServeServer {
        return {
          broadcast: vi.fn(),
          start: serverStart,
          stop: vi.fn(),
        }
      }

      protected override createServeTestRunner(): TestRunner {
        return createServeTestRunner()
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async isServePortInUse(): Promise<boolean> {
        return false
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override projectExists(): boolean {
        return true
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestServe.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(sandboxStart).toHaveBeenCalledWith(expect.objectContaining({
      jsonApiPort: 7575,
      port: 5001,
      projectDir: '/repo',
    }))
    expect(serverStart).toHaveBeenCalledWith(expect.objectContaining({
      ledgerUrl: 'http://localhost:7575',
      port: 4000,
      projectDir: '/repo',
    }))
    expect(result.stdout).toContain('API:         http://localhost:4000/api')
    expect(result.stdout).toContain('Connect any IDE client to this server.')
  })

  it('playground renders browser endpoints without opening the browser', async () => {
    const start = vi.fn().mockResolvedValue(undefined)

    class TestPlayground extends Playground {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start: vi.fn(),
          stop: vi.fn(),
        }
      }

      protected override createServeBuilder(): Builder {
        return createServeBuilder()
      }

      protected override createServeServer(): ServeServer {
        return {
          broadcast: vi.fn(),
          start,
          stop: vi.fn(),
        }
      }

      protected override createServeTestRunner(): TestRunner {
        return createServeTestRunner()
      }

      protected override async isPlaygroundPortInUse(): Promise<boolean> {
        return false
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override openBrowser(): void {
        throw new Error('should not open browser in test')
      }

      protected override projectExists(): boolean {
        return true
      }

      protected override resolveStaticDir(): string | undefined {
        return '/repo/playground/dist'
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestPlayground.run(['--no-open'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      port: 4000,
      projectDir: process.cwd(),
      staticDir: '/repo/playground/dist',
    }))
    expect(result.stdout).toContain('Playground:  http://localhost:4000')
    expect(result.stdout).toContain('API:         http://localhost:4000/api')
  })

  it('playground opens the browser when the UI bundle exists', async () => {
    const openBrowser = vi.fn()

    class TestPlayground extends Playground {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start: vi.fn(),
          stop: vi.fn(),
        }
      }

      protected override createServeBuilder(): Builder {
        return createServeBuilder()
      }

      protected override createServeServer(): ServeServer {
        return {
          broadcast: vi.fn(),
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn(),
        }
      }

      protected override createServeTestRunner(): TestRunner {
        return createServeTestRunner()
      }

      protected override async isPlaygroundPortInUse(): Promise<boolean> {
        return false
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override openBrowser(url: string): void {
        openBrowser(url)
      }

      protected override projectExists(): boolean {
        return true
      }

      protected override resolveStaticDir(): string | undefined {
        return '/repo/playground/dist'
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestPlayground.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(openBrowser).toHaveBeenCalledWith('http://localhost:4000')
  })

  it('playground starts the full runtime and warns when the UI bundle is missing', async () => {
    const fullStart = vi.fn().mockResolvedValue(undefined)
    const openBrowser = vi.fn()

    class TestPlayground extends Playground {
      protected override createDockerManager(): DockerManager {
        return {
          composeDown: vi.fn(),
          composePs: vi.fn(),
          composeUp: vi.fn(),
          ensureImage: vi.fn(),
          isDockerAvailable: vi.fn(),
        } as never
      }

      protected override createFullServer(): FullDevServer {
        return {
          start: fullStart,
          stop: vi.fn(),
        }
      }

      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createServeBuilder(): Builder {
        return createServeBuilder()
      }

      protected override createServeServer(): ServeServer {
        return {
          broadcast: vi.fn(),
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn(),
        }
      }

      protected override createServeTestRunner(): TestRunner {
        return createServeTestRunner()
      }

      protected override async isPlaygroundPortInUse(): Promise<boolean> {
        return false
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override openBrowser(url: string): void {
        openBrowser(url)
      }

      protected override projectExists(): boolean {
        return true
      }

      protected override resolveStaticDir(): string | undefined {
        return undefined
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestPlayground.run(['--full', '--no-open'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(fullStart).toHaveBeenCalledWith(expect.objectContaining({
      basePort: 10000,
      projectDir: process.cwd(),
    }))
    expect(openBrowser).not.toHaveBeenCalled()
    expect(result.stderr).toContain('Playground UI not found')
    expect(result.stdout).toContain('Press Ctrl+C to stop')
  })

  it('playground fails fast when the workspace is not a cantonctl project', async () => {
    class TestPlayground extends Playground {
      protected override projectExists(): boolean {
        return false
      }
    }

    const result = await captureOutput(() => TestPlayground.run([], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.error).toMatchObject({code: ErrorCode.CONFIG_NOT_FOUND})
  })

  it('playground fails before startup when the requested port is already occupied', async () => {
    class TestPlayground extends Playground {
      protected override async isPlaygroundPortInUse(): Promise<boolean> {
        return true
      }

      protected override projectExists(): boolean {
        return true
      }
    }

    const result = await captureOutput(() => TestPlayground.run(['--port', '4100'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.error).toMatchObject({code: ErrorCode.SANDBOX_PORT_IN_USE})
  })

  it('console attaches to the selected network and runs a single REPL iteration', async () => {
    const execute = vi.fn().mockResolvedValue(false)
    const prompt = vi.fn()
    const close = vi.fn()

    class TestConsole extends Console {
      protected override createCompleter(): Completer {
        return {
          complete: vi.fn().mockReturnValue([[], '']),
        }
      }

      protected override createExecutor(): Executor {
        return {
          execute,
        }
      }

      protected override createLedgerClient(): LedgerClient {
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(),
          getVersion: vi.fn(),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override createReadlineInterface() {
        return {
          [Symbol.asyncIterator]: async function* () {
            yield 'exit'
          },
          close,
          prompt,
        } as never
      }

      protected override async createSandboxToken(): Promise<string> {
        return 'sandbox-token'
      }

      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return null
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestConsole.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalled()
    expect(result.stdout).toContain('Canton Console (cantonctl)')
    expect(result.stdout).toContain('Connected to local at http://localhost:7575')
  })

  it('console fails when a requested participant is not part of the topology', async () => {
    class TestConsole extends Console {
      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return createMultiTopology()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestConsole.run(['--participant', 'missing'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(result.stderr).toContain('Participant "missing" not found')
  })

  it('console routes through a multi-node participant when requested', async () => {
    const execute = vi.fn().mockResolvedValue(false)

    class TestConsole extends Console {
      protected override createCompleter(): Completer {
        return {
          complete: vi.fn().mockReturnValue([[], '']),
        }
      }

      protected override createExecutor(options: any): Executor {
        expect(options.client).toBeDefined()
        return {execute}
      }

      protected override createLedgerClient(options: {baseUrl: string; token: string}): LedgerClient {
        expect(options.baseUrl).toBe('http://localhost:7576')
        expect(options.token).toBe('sandbox-token')
        return {
          allocateParty: vi.fn(),
          getActiveContracts: vi.fn(),
          getLedgerEnd: vi.fn(),
          getParties: vi.fn(),
          getVersion: vi.fn(),
          submitAndWait: vi.fn(),
          uploadDar: vi.fn(),
        } as never
      }

      protected override createReadlineInterface() {
        return {
          [Symbol.asyncIterator]: async function* () {
            yield 'exit'
          },
          close: vi.fn(),
          prompt: vi.fn(),
        } as never
      }

      protected override async createSandboxToken(): Promise<string> {
        return 'sandbox-token'
      }

      protected override async detectProjectTopology(): Promise<GeneratedTopology | null> {
        return createMultiTopology()
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestConsole.run(['--participant', 'participant2'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.stdout).toContain('Connected to local → participant2 at http://localhost:7576')
  })
})
