import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {ResolvedAuthProfile} from '../lib/auth-profile.js'
import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {OutputWriter} from '../lib/output.js'
import type {
  ExperimentalValidatorContext,
} from './validator/experimental/base.js'
import {ExperimentalValidatorCommand} from './validator/experimental/base.js'
import ValidatorExperimentalExternalPartyGenerate from './validator/experimental/external-party-generate.js'
import ValidatorExperimentalExternalPartySubmit from './validator/experimental/external-party-submit.js'
import ValidatorExperimentalOffboardUser from './validator/experimental/offboard-user.js'
import ValidatorExperimentalRegisterUser from './validator/experimental/register-user.js'
import ValidatorExperimentalSetupPreapproval from './validator/experimental/setup-preapproval.js'

const CLI_ROOT = process.cwd()

afterEach(() => {
  vi.restoreAllMocks()
})

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

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function createContext(): ExperimentalValidatorContext {
  return {
    adapter: {
      createExternalPartySetupProposal: async () => ({contract_id: 'proposal-1'}),
      generateExternalPartyTopology: async () => ({
        party_id: 'Alice::1220',
        topology_txs: [{hash: 'hash-1', topology_tx: 'tx-1'}],
      }),
      metadata: {
        baseUrl: 'https://validator.example.com',
        service: 'validator',
        upstream: [],
        upstreamSourceIds: ['splice-validator-internal-openapi'],
        warnings: ['adapter-warning'],
      },
      offboardUser: async () => undefined,
      onboardUser: async () => ({party_id: 'Alice::1220'}),
      requestJson: async () => ({}) as never,
      requestOptionalJson: async () => null,
      submitExternalPartyTopology: async () => ({party_id: 'Alice::1220'}),
    },
    authProfile: {
      description: 'OIDC client credentials',
      envVarName: 'CANTONCTL_JWT_DEVNET',
      experimental: false,
      mode: 'oidc-client-credentials',
      network: 'devnet',
      profileName: 'splice-devnet',
      requiresExplicitExperimental: true,
      warnings: ['profile-warning'],
    } satisfies ResolvedAuthProfile,
    config: createConfig(),
    network: 'devnet',
    token: 'jwt-token',
    validatorUrl: 'https://validator.example.com',
    warnings: ['profile-warning'],
  }
}

class TestExperimentalBase extends ExperimentalValidatorCommand {
  public async run(): Promise<void> {}

  public async callResolveExperimentalContext(options: {
    network: string
    token?: string
    validatorUrl?: string
  }) {
    return this.resolveExperimentalContext(options)
  }

  public callRequireExperimentalOptIn(enabled: boolean, commandPath: string) {
    this.requireExperimentalOptIn(enabled, commandPath)
  }

  protected override async loadCommandConfig(): Promise<CantonctlConfig> {
    return createConfig()
  }
}

describe('experimental validator command base', () => {
  it('delegates config loading and rethrows unexpected command errors', async () => {
    const config = createConfig()
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(config)

    class DefaultExperimentalBase extends ExperimentalValidatorCommand {
      public async run(): Promise<void> {}

      public callHandleCommandError(error: unknown, out: OutputWriter): never {
        return this.handleCommandError(error, out)
      }

      public async callLoadCommandConfig(): Promise<CantonctlConfig> {
        return this.loadCommandConfig()
      }
    }

    try {
      const command = new DefaultExperimentalBase([], {} as never)
      await expect(command.callLoadCommandConfig()).resolves.toBe(config)
      expect(loadConfigSpy).toHaveBeenCalledTimes(1)
      expect(() => command.callHandleCommandError(new Error('boom'), {result: vi.fn()} as unknown as OutputWriter))
        .toThrow('boom')
    } finally {
      loadConfigSpy.mockRestore()
    }
  })

  it('resolves profile-backed validator context with an explicit token', async () => {
    const command = new TestExperimentalBase([], {} as never)

    const context = await command.callResolveExperimentalContext({
      network: 'devnet',
      token: 'jwt-token',
    })

    expect(context.network).toBe('devnet')
    expect(context.validatorUrl).toBe('https://validator.example.com')
    expect(context.token).toBe('jwt-token')
    expect(context.authProfile.mode).toBe('oidc-client-credentials')
    expect(context.warnings.join(' ')).toContain('operator-only')
    expect(context.adapter.metadata.warnings.join(' ')).toContain('operator-only')
  })

  it('fails when the targeted network does not expose a validator url', async () => {
    class MissingValidatorBase extends TestExperimentalBase {
      public override async run(): Promise<void> {}

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          profiles: {
            'splice-devnet': {
              ...createConfig().profiles!['splice-devnet'],
              services: {
                auth: {issuer: 'https://login.example.com', kind: 'oidc'},
                ledger: {url: 'https://ledger.example.com'},
              },
            },
          },
        }
      }
    }

    const command = new MissingValidatorBase([], {} as never)
    await expect(command.callResolveExperimentalContext({
      network: 'devnet',
      token: 'jwt-token',
    })).rejects.toMatchObject({code: ErrorCode.SERVICE_NOT_CONFIGURED})
  })

  it('fails when no operator token is available', async () => {
    const command = new TestExperimentalBase([], {} as never)

    await expect(command.callResolveExperimentalContext({
      network: 'local',
    })).rejects.toMatchObject({code: ErrorCode.DEPLOY_AUTH_FAILED})
  })

  it('suggests auth login when a non-localnet profile has no operator token', async () => {
    const command = new TestExperimentalBase([], {} as never)

    await expect(command.callResolveExperimentalContext({
      network: 'devnet',
    })).rejects.toMatchObject({
      code: ErrorCode.DEPLOY_AUTH_FAILED,
      suggestion: expect.stringContaining('cantonctl auth login devnet'),
    })
  })

  it('supports explicit validator urls for docker networks without mapped profiles', async () => {
    class OrphanLocalnetBase extends ExperimentalValidatorCommand {
      public async run(): Promise<void> {}

      public async callResolveExperimentalContext(options: {
        network: string
        token?: string
        validatorUrl?: string
      }) {
        return this.resolveExperimentalContext(options)
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return {
          networks: {
            orphan: {type: 'docker'},
          },
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }
    }

    const command = new OrphanLocalnetBase([], {} as never)
    const context = await command.callResolveExperimentalContext({
      network: 'orphan',
      token: 'jwt-token',
      validatorUrl: 'https://validator.orphan',
    })

    expect(context.authProfile.profileName).toBeUndefined()
    expect(context.authProfile.mode).toBe('localnet-unsafe-hmac')
    expect(context.validatorUrl).toBe('https://validator.orphan')
    expect(context.adapter.metadata.baseUrl).toBe('https://validator.orphan')
  })

  it('uses the localnet-unsafe-hmac suggestion when no token exists for an unmapped docker network', async () => {
    class OrphanLocalnetBase extends ExperimentalValidatorCommand {
      public async run(): Promise<void> {}

      public async callResolveExperimentalContext(options: {
        network: string
        token?: string
        validatorUrl?: string
      }) {
        return this.resolveExperimentalContext(options)
      }

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return {
          networks: {
            orphan: {type: 'docker'},
          },
          project: {name: 'demo', 'sdk-version': '3.4.11'},
          version: 1,
        }
      }
    }

    const command = new OrphanLocalnetBase([], {} as never)
    await expect(command.callResolveExperimentalContext({
      network: 'orphan',
      validatorUrl: 'https://validator.orphan',
    })).rejects.toMatchObject({
      code: ErrorCode.DEPLOY_AUTH_FAILED,
      suggestion: expect.stringContaining('localnet-unsafe-hmac'),
    })
  })

  it('requires explicit experimental confirmation', () => {
    const command = new TestExperimentalBase([], {} as never)
    expect(() => command.callRequireExperimentalOptIn(false, 'validator experimental register-user devnet'))
      .toThrowError(CantonctlError)
  })
})

describe('experimental validator command surface', () => {
  it('emits generated external-party topology in json mode', async () => {
    class TestGenerate extends ValidatorExperimentalExternalPartyGenerate {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestGenerate.run([
      'devnet',
      '--experimental',
      '--json',
      '--party-hint',
      'alice',
      '--public-key',
      'deadbeef',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.warnings).toEqual(['profile-warning', 'adapter-warning'])
    expect(json.data).toEqual(expect.objectContaining({
      network: 'devnet',
      partyId: 'Alice::1220',
      topologyTxs: [{hash: 'hash-1', topology_tx: 'tx-1'}],
      validatorUrl: 'https://validator.example.com',
    }))
  })

  it('renders generated external-party topology in human mode', async () => {
    class TestGenerate extends ValidatorExperimentalExternalPartyGenerate {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestGenerate.run([
      'devnet',
      '--experimental',
      '--party-hint',
      'alice',
      '--public-key',
      'deadbeef',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Network: devnet')
    expect(result.stdout).toContain('Validator: https://validator.example.com')
    expect(result.stdout).toContain('Party ID: Alice::1220')
    expect(result.stdout).toContain('Topology transactions: 1')
    expect(result.stderr).toContain('profile-warning')
    expect(result.stderr).toContain('adapter-warning')
  })

  it('submits signed topology txs in json mode', async () => {
    class TestSubmit extends ValidatorExperimentalExternalPartySubmit {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestSubmit.run([
      'devnet',
      '--experimental',
      '--json',
      '--public-key',
      'deadbeef',
      '--signed-topology-tx',
      'tx-1:sig-1',
      '--signed-topology-tx',
      'tx-2:sig-2',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      network: 'devnet',
      partyId: 'Alice::1220',
      submitted: true,
    }))
  })

  it('renders submitted external-party topology in human mode', async () => {
    class TestSubmit extends ValidatorExperimentalExternalPartySubmit {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestSubmit.run([
      'devnet',
      '--experimental',
      '--public-key',
      'deadbeef',
      '--signed-topology-tx',
      'tx-1:sig-1',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Network: devnet')
    expect(result.stdout).toContain('Validator: https://validator.example.com')
    expect(result.stdout).toContain('Submitted topology for party: Alice::1220')
    expect(result.stderr).toContain('profile-warning')
    expect(result.stderr).toContain('adapter-warning')
  })

  it('rejects malformed signed topology tx values', async () => {
    class TestSubmit extends ValidatorExperimentalExternalPartySubmit {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestSubmit.run([
      'devnet',
      '--experimental',
      '--json',
      '--public-key',
      'deadbeef',
      '--signed-topology-tx',
      'malformed',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
    }))
  })

  it('rejects signed topology tx values missing either payload half', async () => {
    class TestSubmit extends ValidatorExperimentalExternalPartySubmit {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestSubmit.run([
      'devnet',
      '--experimental',
      '--json',
      '--public-key',
      'deadbeef',
      '--signed-topology-tx',
      'tx-1:',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.error).toEqual(expect.objectContaining({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: expect.stringContaining('must include both'),
    }))
  })

  it('registers users through the experimental adapter', async () => {
    class TestRegister extends ValidatorExperimentalRegisterUser {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestRegister.run([
      'devnet',
      '--experimental',
      '--json',
      '--name',
      'alice',
      '--party-id',
      'Alice::1220',
      '--create-party-if-missing',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      partyId: 'Alice::1220',
      user: 'alice',
    }))
  })

  it('registers users in human mode', async () => {
    class TestRegister extends ValidatorExperimentalRegisterUser {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestRegister.run([
      'devnet',
      '--experimental',
      '--name',
      'alice',
      '--party-id',
      'Alice::1220',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Network: devnet')
    expect(result.stdout).toContain('Validator: https://validator.example.com')
    expect(result.stdout).toContain('User: alice')
    expect(result.stdout).toContain('Party ID: Alice::1220')
    expect(result.stderr).toContain('profile-warning')
    expect(result.stderr).toContain('adapter-warning')
  })

  it('offboards users in human mode', async () => {
    class TestOffboard extends ValidatorExperimentalOffboardUser {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestOffboard.run([
      'devnet',
      '--experimental',
      '--username',
      'alice',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Network: devnet')
    expect(result.stdout).toContain('Offboarded user: alice')
    expect(result.stderr).toContain('profile-warning')
    expect(result.stderr).toContain('adapter-warning')
  })

  it('offboards users in json mode', async () => {
    class TestOffboard extends ValidatorExperimentalOffboardUser {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestOffboard.run([
      'devnet',
      '--experimental',
      '--json',
      '--username',
      'alice',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.warnings).toEqual(['profile-warning', 'adapter-warning'])
    expect(json.data).toEqual(expect.objectContaining({
      network: 'devnet',
      offboarded: true,
      user: 'alice',
      validatorUrl: 'https://validator.example.com',
    }))
  })

  it('emits setup-preapproval contracts in json mode', async () => {
    class TestSetupPreapproval extends ValidatorExperimentalSetupPreapproval {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestSetupPreapproval.run([
      'devnet',
      '--experimental',
      '--json',
      '--user-party-id',
      'Alice::1220',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      contractId: 'proposal-1',
      userPartyId: 'Alice::1220',
    }))
  })

  it('renders setup-preapproval contracts in human mode', async () => {
    class TestSetupPreapproval extends ValidatorExperimentalSetupPreapproval {
      protected override requireExperimentalOptIn(): void {}
      protected override async resolveExperimentalContext(): Promise<ExperimentalValidatorContext> {
        return createContext()
      }
    }

    const result = await captureOutput(() => TestSetupPreapproval.run([
      'devnet',
      '--experimental',
      '--user-party-id',
      'Alice::1220',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Network: devnet')
    expect(result.stdout).toContain('Validator: https://validator.example.com')
    expect(result.stdout).toContain('Setup proposal contract: proposal-1')
    expect(result.stderr).toContain('profile-warning')
    expect(result.stderr).toContain('adapter-warning')
  })
})
