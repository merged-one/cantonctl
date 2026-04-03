import {Readable, Writable} from 'node:stream'

import {describe, expect, it} from 'vitest'

import type {CantonctlConfig} from '../lib/config.js'
import {createOutput} from '../lib/output.js'
import type {KeychainBackend} from '../lib/credential-store.js'
import AuthLogin from './auth/login.js'
import AuthLogout from './auth/logout.js'
import AuthStatus from './auth/status.js'
import Build from './build.js'
import Clean from './clean.js'
import Console from './console.js'
import Deploy from './deploy.js'
import Dev from './dev.js'
import Doctor from './doctor.js'
import Init from './init.js'
import LocalnetDown from './localnet/down.js'
import LocalnetStatus from './localnet/status.js'
import LocalnetUp from './localnet/up.js'
import Playground from './playground.js'
import Serve from './serve.js'
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
  it('wires core command factories', () => {
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
        }
      }
    }

    class CleanHarness extends Clean {
      public expose() {
        return this.createCleaner(false, createOutput({json: true}))
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
          runner: this.createRunner(),
        }
      }
    }

    expect(new BuildHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      builder: expect.objectContaining({build: expect.any(Function)}),
      hooks: expect.objectContaining({emit: expect.any(Function)}),
      projectDir: process.cwd(),
      runner: expect.objectContaining({run: expect.any(Function)}),
      sdk: expect.objectContaining({build: expect.any(Function)}),
    }))
    expect(new CleanHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      clean: expect.any(Function),
    }))
    expect(new TestHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      hooks: expect.objectContaining({emit: expect.any(Function)}),
      projectDir: process.cwd(),
      testRunner: expect.objectContaining({run: expect.any(Function)}),
    }))
    expect(new InitHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      projectDir: expect.stringContaining('demo'),
      runner: expect.objectContaining({run: expect.any(Function)}),
    }))
  })

  it('wires auth command factories', () => {
    class LoginHarness extends AuthLogin {
      public expose() {
        return {
          client: this.createLedgerClient({baseUrl: 'https://ledger.example.com', token: 'jwt'}),
          store: this.createCredentialStore(createBackend()),
        }
      }
    }

    class LogoutHarness extends AuthLogout {
      public expose() {
        return this.createCredentialStore(createBackend())
      }
    }

    class StatusHarness extends AuthStatus {
      public expose() {
        return this.createCredentialStore(createBackend())
      }
    }

    expect(new LoginHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      client: expect.objectContaining({getVersion: expect.any(Function)}),
      store: expect.objectContaining({store: expect.any(Function)}),
    }))
    expect(new LogoutHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      remove: expect.any(Function),
    }))
    expect(new StatusHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      resolveRecord: expect.any(Function),
    }))
  })

  it('wires runtime orchestration command factories', async () => {
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

    class ServeHarness extends Serve {
      public expose() {
        const runner = this.createRunner()
        const sdk = this.createSdk(runner)
        const builder = this.createServeBuilder(sdk)
        const testRunner = this.createServeTestRunner(sdk)
        return {
          portCheck: this.isServePortInUse(65531),
          projectDir: this.getProjectDir(),
          projectExists: this.projectExists(this.getProjectDir()),
          sandboxServer: this.createManagedSandboxServer({config: createConfig(), output: createOutput({json: true}), sdk}),
          server: this.createServeServer({builder, output: createOutput({json: true}), testRunner}),
          testRunner,
        }
      }
    }

    class PlaygroundHarness extends Playground {
      public expose() {
        const runner = this.createRunner()
        const sdk = this.createSdk(runner)
        const builder = this.createServeBuilder(sdk)
        const testRunner = this.createServeTestRunner(sdk)
        return {
          docker: this.createDockerManager(createOutput({json: true}), runner),
          fullServer: this.createFullServer({
            cantonImage: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
            config: createConfig(),
            docker: this.createDockerManager(createOutput({json: true}), runner),
            output: createOutput({json: true}),
            sdk,
          }),
          portCheck: this.isPlaygroundPortInUse(65532),
          sandboxServer: this.createSandboxServer({config: createConfig(), output: createOutput({json: true}), sdk}),
          server: this.createServeServer({builder, output: createOutput({json: true}), testRunner}),
          staticDir: this.resolveStaticDir(),
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

    const serve = new ServeHarness([], {} as never).expose()
    expect(serve.projectDir).toBe(process.cwd())
    expect(typeof serve.projectExists).toBe('boolean')
    expect(serve.sandboxServer).toEqual(expect.objectContaining({start: expect.any(Function)}))
    expect(serve.server).toEqual(expect.objectContaining({start: expect.any(Function)}))
    expect(serve.testRunner).toEqual(expect.objectContaining({run: expect.any(Function)}))
    await expect(serve.portCheck).resolves.toBe(false)

    const playground = new PlaygroundHarness([], {} as never).expose()
    expect(playground.docker).toEqual(expect.objectContaining({composeUp: expect.any(Function)}))
    expect(playground.fullServer).toEqual(expect.objectContaining({start: expect.any(Function)}))
    expect(playground.sandboxServer).toEqual(expect.objectContaining({start: expect.any(Function)}))
    expect(playground.server).toEqual(expect.objectContaining({start: expect.any(Function)}))
    expect(playground.staticDir === undefined || typeof playground.staticDir === 'string').toBe(true)
    await expect(playground.portCheck).resolves.toBe(false)
  })

  it('wires diagnostic and query command helpers', async () => {
    class DoctorHarness extends Doctor {
      public expose() {
        return {
          profile: this.resolveProfileSummary(createConfig(), 'sandbox'),
          runner: this.createRunner(),
        }
      }
    }

    class ConsoleHarness extends Console {
      public async expose() {
        const rl = this.createReadlineInterface({
          input: Readable.from([]),
          output: new Writable({write(_chunk, _enc, callback) { callback() }}),
        })
        rl.close()
        return {
          client: this.createLedgerClient({baseUrl: 'https://ledger.example.com', token: 'jwt'}),
          completer: this.createCompleter({partyNames: ['Alice']}),
          executor: this.createExecutor({
            client: this.createLedgerClient({baseUrl: 'https://ledger.example.com', token: 'jwt'}),
            defaultParty: 'Alice',
            output: createOutput({json: true}),
          }),
          token: await this.createSandboxToken({
            actAs: ['Alice'],
            admin: true,
            applicationId: 'cantonctl',
            readAs: ['Alice'],
          }),
        }
      }
    }

    class StatusHarness extends Status {
      public async expose() {
        return {
          client: this.createStatusLedgerClient('https://ledger.example.com', 'jwt'),
          token: await this.createStatusToken(createConfig()),
          topology: this.detectProjectTopology(process.cwd()),
        }
      }
    }

    expect(new DoctorHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      profile: expect.objectContaining({kind: 'sandbox', name: 'sandbox'}),
      runner: expect.objectContaining({run: expect.any(Function)}),
    }))

    const consoleHarness = await new ConsoleHarness([], {} as never).expose()
    expect(consoleHarness).toEqual(expect.objectContaining({
      client: expect.objectContaining({getVersion: expect.any(Function)}),
      completer: expect.objectContaining({complete: expect.any(Function)}),
      executor: expect.objectContaining({execute: expect.any(Function)}),
      token: expect.any(String),
    }))

    const statusHarness = await new StatusHarness([], {} as never).expose()
    expect(statusHarness.client).toEqual(expect.objectContaining({getVersion: expect.any(Function)}))
    expect(statusHarness.token).toEqual(expect.any(String))
    await expect(statusHarness.topology).resolves.toBeNull()
  })

  it('wires localnet wrapper factories', () => {
    class UpHarness extends LocalnetUp {
      public expose() {
        return this.createLocalnet()
      }
    }

    class StatusHarness extends LocalnetStatus {
      public expose() {
        return this.createLocalnet()
      }
    }

    class DownHarness extends LocalnetDown {
      public expose() {
        return this.createLocalnet()
      }
    }

    expect(new UpHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      down: expect.any(Function),
      status: expect.any(Function),
      up: expect.any(Function),
    }))
    expect(new StatusHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      down: expect.any(Function),
      status: expect.any(Function),
      up: expect.any(Function),
    }))
    expect(new DownHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      down: expect.any(Function),
      status: expect.any(Function),
      up: expect.any(Function),
    }))
  })
})
