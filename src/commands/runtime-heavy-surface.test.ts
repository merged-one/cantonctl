import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import type {Builder} from '../lib/builder.js'
import type {CantonctlConfig} from '../lib/config.js'
import type {DamlSdk} from '../lib/daml.js'
import type {DevServer} from '../lib/dev-server.js'
import type {Deployer} from '../lib/deployer.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
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
})
