import * as path from 'node:path'

import {describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import {createOutput} from '../lib/output.js'
import type {KeychainBackend} from '../lib/credential-store.js'
import AuthLogin from './auth/login.js'
import AuthLogout from './auth/logout.js'
import AuthStatus from './auth/status.js'
import Build from './build.js'
import CodegenSync from './codegen/sync.js'
import Deploy from './deploy.js'
import Dev from './dev.js'
import Doctor from './doctor.js'
import Init from './init.js'
import LocalnetDown from './localnet/down.js'
import LocalnetStatus from './localnet/status.js'
import LocalnetUp from './localnet/up.js'
import ProfilesImportLocalnet from './profiles/import-localnet.js'
import Readiness from './readiness.js'
import Status from './status.js'
import Test from './test.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networks: {
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
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
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createBackend(): KeychainBackend {
  return {
    deletePassword: async () => false,
    findCredentials: async () => [],
    getPassword: async () => null,
    setPassword: async () => undefined,
  }
}

describe('command wiring', () => {
  it('wires core build, test, and init factories', () => {
    class BuildHarness extends Build {
      public expose() {
        const runner = this.createRunner()
        const sdk = this.createSdk(runner)
        const hooks = this.createHooks()
        return {
          builder: this.createBuilder({hooks, sdk}),
          hooks,
          projectDir: this.getProjectDir(),
          runner,
          sdk,
          watcher: this.createWatcher(),
        }
      }
    }

    class TestHarness extends Test {
      public expose() {
        const runner = this.createRunner()
        const sdk = this.createSdk(runner)
        const hooks = this.createHooks()
        return {
          hooks,
          projectDir: this.getProjectDir(),
          runner,
          sdk,
          testRunner: this.createTestRunner({hooks, sdk}),
        }
      }
    }

    class InitHarness extends Init {
      public expose() {
        return {
          projectDir: this.resolveProjectDir('demo'),
        }
      }
    }

    expect(new BuildHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      builder: expect.objectContaining({build: expect.any(Function)}),
      hooks: expect.objectContaining({emit: expect.any(Function)}),
      projectDir: process.cwd(),
      runner: expect.objectContaining({run: expect.any(Function)}),
      sdk: expect.objectContaining({build: expect.any(Function)}),
      watcher: expect.any(Function),
    }))
    expect(new TestHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      hooks: expect.objectContaining({emit: expect.any(Function)}),
      projectDir: process.cwd(),
      testRunner: expect.objectContaining({run: expect.any(Function)}),
    }))
    expect(new InitHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      projectDir: expect.stringContaining('demo'),
    }))
  })

  it('wires auth command factories', async () => {
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())

    class LoginHarness extends AuthLogin {
      public async expose() {
        const prompt = this.createReadlineInterface({input: process.stdin, output: process.stderr})
        prompt.close()
        return {
          backend: await this.createBackend(),
          client: this.createLedgerClient({baseUrl: 'https://ledger.example.com', token: 'jwt'}),
          config: await this.loadCommandConfig(),
          store: this.createCredentialStore(createBackend()),
        }
      }
    }

    class LogoutHarness extends AuthLogout {
      public async expose() {
        return {
          backend: await this.createBackend(),
          store: this.createCredentialStore(createBackend()),
        }
      }
    }

    class StatusHarness extends AuthStatus {
      public async expose() {
        return {
          backend: await this.createBackend(),
          config: await this.loadCommandConfig(),
          store: this.createCredentialStore(createBackend()),
        }
      }
    }

    expect(await new LoginHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      backend: expect.objectContaining({backend: expect.any(Object), isKeychain: expect.any(Boolean)}),
      client: expect.objectContaining({getVersion: expect.any(Function)}),
      config: createConfig(),
      store: expect.objectContaining({store: expect.any(Function)}),
    }))
    expect(await new LogoutHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      backend: expect.objectContaining({backend: expect.any(Object)}),
      store: expect.objectContaining({remove: expect.any(Function)}),
    }))
    expect(await new StatusHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      backend: expect.objectContaining({backend: expect.any(Object), isKeychain: expect.any(Boolean)}),
      config: createConfig(),
      store: expect.objectContaining({resolveRecord: expect.any(Function)}),
    }))
    expect(loadConfigSpy).toHaveBeenCalledTimes(2)
  })

  it('wires control-plane command factories', async () => {
    class DeployHarness extends Deploy {
      public expose() {
        const runner = this.createRunner()
        const sdk = this.createSdk(runner)
        const hooks = this.createHooks()
        const builder = this.createBuilder({hooks, sdk})
        return {
          builder,
          deployer: this.createDeployer({
            builder,
            config: createConfig(),
            hooks,
            output: createOutput({json: true}),
          }),
          topology: this.detectProjectTopology(this.getProjectDir()),
        }
      }
    }

    class DevHarness extends Dev {
      public expose() {
        const runner = this.createRunner()
        const sdk = this.createSdk(runner)
        return {
          docker: this.createDockerManager(createOutput({json: true}), runner),
          fullServer: this.createFullServer({
            cantonImage: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
            config: createConfig(),
            docker: this.createDockerManager(createOutput({json: true}), runner),
            output: createOutput({json: true}),
            sdk,
          }),
          portCheck: this.isManagedPortInUse(65530),
          sandboxServer: this.createSandboxServer({config: createConfig(), output: createOutput({json: true}), sdk}),
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

    class ProfilesImportLocalnetHarness extends ProfilesImportLocalnet {
      public expose() {
        return this.createDetector()
      }
    }

    class CodegenSyncHarness extends CodegenSync {
      public expose() {
        return {
          cwd: this.getCommandCwd(),
          runner: this.createRunner(),
        }
      }
    }

    class DoctorHarness extends Doctor {
      public expose() {
        return {
          runner: this.createRunner(),
          summary: this.resolveProfileSummary(createConfig(), 'sandbox'),
        }
      }
    }

    class ReadinessHarness extends Readiness {
      public expose() {
        return this.createRunner()
      }
    }

    class StatusHarness extends Status {
      public expose() {
        return {
          client: this.createStatusLedgerClient('https://ledger.example.com', 'jwt'),
        }
      }
    }

    const deploy = new DeployHarness([], {} as never).expose()
    expect(deploy.builder).toEqual(expect.objectContaining({build: expect.any(Function)}))
    expect(deploy.deployer).toEqual(expect.objectContaining({deploy: expect.any(Function)}))
    await expect(deploy.topology).resolves.toBeNull()

    const dev = new DevHarness([], {} as never).expose()
    expect(dev.docker).toEqual(expect.objectContaining({composeUp: expect.any(Function)}))
    expect(dev.fullServer).toEqual(expect.objectContaining({start: expect.any(Function)}))
    expect(dev.sandboxServer).toEqual(expect.objectContaining({start: expect.any(Function)}))
    await expect(dev.portCheck).resolves.toBe(false)

    expect(new LocalnetUpHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      up: expect.any(Function),
    }))
    expect(new LocalnetStatusHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      status: expect.any(Function),
    }))
    expect(new LocalnetDownHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      down: expect.any(Function),
    }))
    const localnetDetector = new ProfilesImportLocalnetHarness([], {} as never).expose()
    expect(localnetDetector).toEqual(expect.objectContaining({
      detect: expect.any(Function),
    }))
    await expect(localnetDetector.detect(path.resolve(process.cwd(), 'test/fixtures/localnet-workspace/quickstart')))
      .resolves.toEqual(expect.objectContaining({
        root: path.resolve(process.cwd(), 'test/fixtures/localnet-workspace/quickstart'),
      }))

    expect(new DoctorHarness([], {} as never).expose()).toEqual({
      runner: expect.objectContaining({run: expect.any(Function)}),
      summary: {experimental: false, kind: 'sandbox', name: 'sandbox'},
    })
    expect(new ReadinessHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      run: expect.any(Function),
    }))
    expect(new StatusHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      client: expect.objectContaining({getVersion: expect.any(Function)}),
    }))
    expect(new CodegenSyncHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      cwd: process.cwd(),
      runner: expect.objectContaining({run: expect.any(Function)}),
    }))
  })
})
