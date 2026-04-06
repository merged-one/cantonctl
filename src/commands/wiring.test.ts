import {describe, expect, it} from 'vitest'

import type {CantonctlConfig} from '../lib/config.js'
import {createOutput} from '../lib/output.js'
import type {KeychainBackend} from '../lib/credential-store.js'
import AuthLogin from './auth/login.js'
import AuthLogout from './auth/logout.js'
import AuthStatus from './auth/status.js'
import Build from './build.js'
import Deploy from './deploy.js'
import Dev from './dev.js'
import Doctor from './doctor.js'
import Init from './init.js'
import LocalnetDown from './localnet/down.js'
import LocalnetStatus from './localnet/status.js'
import LocalnetUp from './localnet/up.js'
import OperatorValidatorLicenses from './operator/validator/licenses.js'
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

  it('wires control-plane command factories', async () => {
    class DeployHarness extends Deploy {
      public expose() {
        const hooks = this.createHooks()
        return {
          deployer: this.createDeployer({
            config: createConfig(),
            hooks,
          }),
          hooks,
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

    class OperatorValidatorLicensesHarness extends OperatorValidatorLicenses {
      public expose() {
        return this.createValidatorLicensesOperator()
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
    expect(deploy.deployer).toEqual(expect.objectContaining({deploy: expect.any(Function)}))
    expect(deploy.hooks).toEqual(expect.objectContaining({emit: expect.any(Function)}))
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
    expect(new ProfilesImportLocalnetHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      detect: expect.any(Function),
    }))

    expect(new DoctorHarness([], {} as never).expose()).toEqual({
      runner: expect.objectContaining({run: expect.any(Function)}),
      summary: {experimental: false, kind: 'sandbox', name: 'sandbox'},
    })
    expect(new ReadinessHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      run: expect.any(Function),
    }))
    expect(new OperatorValidatorLicensesHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      list: expect.any(Function),
    }))
    expect(new StatusHarness([], {} as never).expose()).toEqual(expect.objectContaining({
      client: expect.objectContaining({getVersion: expect.any(Function)}),
    }))
  })
})
