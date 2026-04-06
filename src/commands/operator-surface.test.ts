import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {OutputWriter} from '../lib/output.js'
import type {ResolvedProfileRuntime} from '../lib/profile-runtime.js'
import type {ResolvedOperatorSurface} from '../lib/operator-surface.js'
import {OperatorSurfaceCommand} from './operator-surface-command.js'
import OperatorValidatorLicenses from './operator/validator/licenses.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    profiles: {
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createRuntime(): ResolvedProfileRuntime {
  return {
    auth: {
      operator: {
        description: 'operator',
        envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
        keychainAccount: 'operator:splice-devnet',
        localFallbackAllowed: false,
        prerequisites: [],
        required: true,
        scope: 'operator',
      },
      warnings: [],
    } as unknown as ResolvedProfileRuntime['auth'],
    capabilities: [],
    compatibility: {
      checks: [],
      failed: 0,
      passed: 0,
      profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'},
      services: [],
      warned: 0,
    },
    credential: {
      mode: 'env-or-keychain-jwt',
      network: 'splice-devnet',
      scope: 'app',
      source: 'stored',
      token: 'app-token',
    },
    inventory: {} as never,
    networkName: 'splice-devnet',
    operatorCredential: {
      mode: 'env-or-keychain-jwt',
      network: 'splice-devnet',
      scope: 'operator',
      source: 'stored',
      token: 'operator-token',
    },
    profile: {
      experimental: false,
      kind: 'remote-validator',
      name: 'splice-devnet',
      services: {
        ledger: {url: 'https://ledger.example.com'},
        scan: {url: 'https://scan.example.com'},
      },
    },
    profileContext: {
      experimental: false,
      kind: 'remote-validator',
      name: 'splice-devnet',
      services: {
        ledger: {url: 'https://ledger.example.com'},
        scan: {url: 'https://scan.example.com'},
      },
    },
    services: [
      {
        controlPlane: {
          endpointProvenance: 'declared',
          lifecycleOwner: 'official-remote-runtime',
          managementClass: 'read-only',
          mutationScope: 'observed',
          operatorSurface: false,
        },
        detail: 'Scan endpoint',
        endpoint: 'https://scan.example.com',
        name: 'scan',
        sourceIds: ['splice-scan-external-openapi'],
        stability: 'stable-external',
      },
    ],
  } as ResolvedProfileRuntime
}

function createSurface(): ResolvedOperatorSurface {
  return {
    commandPath: 'operator validator licenses',
    definition: {
      commandPath: 'operator validator licenses',
      description: 'Read approved validator licenses from the explicit Scan admin surface.',
      lifecycleOwners: ['official-remote-runtime'],
      managementClasses: ['read-only'],
      mutationScopes: ['observed'],
      profileKinds: ['remote-validator', 'remote-sv-network'],
      service: 'scan',
      sourceIds: ['splice-scan-external-openapi'],
      stabilities: ['stable-external'],
    },
    endpoint: 'https://scan.example.com',
    runtime: createRuntime(),
    service: createRuntime().services[0],
    surfaceId: 'validator-licenses',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('operator command surface', () => {
  it('covers OperatorSurfaceCommand helper methods', async () => {
    const out = {result: vi.fn()} as unknown as OutputWriter

    class Harness extends OperatorSurfaceCommand {
      public callHandleCommandError(error: unknown, writer: OutputWriter): never {
        return this.handleCommandError(error, writer)
      }

      public callLoadCommandConfig() {
        return this.loadCommandConfig()
      }

      public callLoadCommandRuntime(profileName: string) {
        return this.loadCommandRuntime(profileName)
      }

      public callOutputFor(json: boolean) {
        return this.outputFor(json)
      }

      public callResolveOperatorCommandSurface(profileName: string) {
        return this.resolveOperatorCommandSurface({profileName, surfaceId: 'validator-licenses'})
      }

      public async run(): Promise<void> {}

      protected override async loadCommandConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override createProfileRuntimeResolver() {
        return {
          resolve: vi.fn().mockResolvedValue(createRuntime()),
        }
      }
    }

    class BaseHarness extends OperatorSurfaceCommand {
      public callCreateProfileRuntimeResolver() {
        return this.createProfileRuntimeResolver()
      }

      public callLoadCommandConfig() {
        return this.loadCommandConfig()
      }

      public async run(): Promise<void> {}
    }

    const harness = new Harness([], {} as never)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    await expect(harness.callLoadCommandRuntime('splice-devnet')).resolves.toEqual(expect.objectContaining({
      networkName: 'splice-devnet',
    }))
    await expect(harness.callResolveOperatorCommandSurface('splice-devnet')).resolves.toEqual(expect.objectContaining({
      commandPath: 'operator validator licenses',
      endpoint: 'https://scan.example.com',
    }))
    await expect(harness.callLoadCommandConfig()).resolves.toEqual(createConfig())
    expect(harness.callOutputFor(true)).toEqual(expect.objectContaining({result: expect.any(Function)}))
    expect(() => harness.callHandleCommandError(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND), out)).toThrow()
    expect(() => harness.callHandleCommandError(new Error('boom'), out)).toThrow('boom')
    expect(out.result).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))
    await expect(new BaseHarness([], {} as never).callLoadCommandConfig()).resolves.toEqual(createConfig())
    expect(new BaseHarness([], {} as never).callCreateProfileRuntimeResolver()).toEqual(expect.objectContaining({
      resolve: expect.any(Function),
    }))
    loadConfigSpy.mockRestore()
  })

  it('exposes operator command metadata and json results', async () => {
    expect(OperatorValidatorLicenses.description).toContain('explicit operator Scan surface')
    expect(OperatorValidatorLicenses.flags.profile.required).toBe(true)

    class Harness extends OperatorValidatorLicenses {
      protected override createValidatorLicensesOperator() {
        return {
          list: vi.fn().mockResolvedValue({
            auth: {
              credentialSource: 'stored',
              envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
              required: true,
            },
            endpoint: 'https://scan.example.com',
            licenses: [{contractId: 'cid-1', createdAt: '2026-04-06T20:00:00Z', payload: {validator: 'AliceValidator'}, templateId: 'ValidatorLicense'}],
            profile: {kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet'},
            surface: {
              commandPath: 'operator validator licenses',
              lifecycleOwner: 'official-remote-runtime',
              managementClass: 'read-only',
              mutationScope: 'observed',
              service: 'scan',
              stability: 'stable-external',
              surfaceId: 'validator-licenses',
              upstreamSourceIds: ['splice-scan-external-openapi'],
            },
            warnings: ['operator-boundary'],
          }),
        }
      }

      protected override async resolveOperatorCommandSurface() {
        return createSurface()
      }
    }

    const result = await captureOutput(() => Harness.run(['--profile', 'splice-devnet', '--json'], {root: CLI_ROOT}))
    const json = parseJson(result.stdout)

    expect(result.error).toBeUndefined()
    expect(json).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        endpoint: 'https://scan.example.com',
        surface: expect.objectContaining({
          surfaceId: 'validator-licenses',
          upstreamSourceIds: ['splice-scan-external-openapi'],
        }),
      }),
      success: true,
      warnings: ['operator-boundary'],
    }))
  })

  it('renders human results and handles expected command failures', async () => {
    class SuccessHarness extends OperatorValidatorLicenses {
      protected override createValidatorLicensesOperator() {
        return {
          list: vi.fn().mockResolvedValue({
            auth: {
              credentialSource: 'stored',
              envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
              required: true,
            },
            endpoint: 'https://scan.example.com',
            licenses: [
              {contractId: 'cid-1', createdAt: '2026-04-06T20:00:00Z', payload: {validator: 'AliceValidator'}, templateId: 'ValidatorLicense'},
              {contractId: 'cid-2', createdAt: '2026-04-06T20:01:00Z', payload: {validator_party_id: 'BobValidator'}, templateId: 'ValidatorLicense'},
              {contractId: 'cid-3', createdAt: '2026-04-06T20:02:00Z', payload: {}, templateId: 'ValidatorLicense'},
              {},
            ],
            nextPageToken: 7,
            profile: {kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet'},
            surface: {
              commandPath: 'operator validator licenses',
              lifecycleOwner: 'official-remote-runtime',
              managementClass: 'read-only',
              mutationScope: 'observed',
              service: 'scan',
              stability: 'stable-external',
              surfaceId: 'validator-licenses',
              upstreamSourceIds: ['splice-scan-external-openapi'],
            },
            warnings: ['operator-warning'],
          }),
        }
      }

      protected override async resolveOperatorCommandSurface() {
        return createSurface()
      }
    }

    const success = await captureOutput(() => SuccessHarness.run(['--profile', 'splice-devnet'], {root: CLI_ROOT}))
    expect(success.stdout).toContain('Operator auth: stored')
    expect(success.stdout).toContain('cid-1')
    expect(success.stdout).toContain('BobValidator')
    expect(success.stdout).toContain('Next page token: 7')
    expect(success.stderr).toContain('operator-warning')

    class ErrorHarness extends OperatorValidatorLicenses {
      protected override async resolveOperatorCommandSurface(_: {
        profileName: string
        surfaceId: 'validator-licenses'
      }): Promise<ResolvedOperatorSurface> {
        throw new CantonctlError(ErrorCode.SERVICE_NOT_CONFIGURED, {
          suggestion: 'Use a remote profile.',
        })
      }
    }

    const handled = await captureOutput(() => ErrorHarness.run(['--profile', 'splice-devnet', '--json'], {root: CLI_ROOT}))
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.SERVICE_NOT_CONFIGURED}),
      success: false,
    }))
  })

  it('renders empty operator results without a next page token', async () => {
    class EmptyHarness extends OperatorValidatorLicenses {
      protected override createValidatorLicensesOperator() {
        return {
          list: vi.fn().mockResolvedValue({
            auth: {
              credentialSource: 'env',
              envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
              required: true,
            },
            endpoint: 'https://scan.example.com',
            licenses: [],
            profile: {kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet'},
            surface: {
              commandPath: 'operator validator licenses',
              lifecycleOwner: 'official-remote-runtime',
              managementClass: 'read-only',
              mutationScope: 'observed',
              service: 'scan',
              stability: 'stable-external',
              surfaceId: 'validator-licenses',
              upstreamSourceIds: ['splice-scan-external-openapi'],
            },
            warnings: [],
          }),
        }
      }

      protected override async resolveOperatorCommandSurface(_: {
        profileName: string
        surfaceId: 'validator-licenses'
      }): Promise<ResolvedOperatorSurface> {
        return createSurface()
      }
    }

    const result = await captureOutput(() => EmptyHarness.run(['--profile', 'splice-devnet'], {root: CLI_ROOT}))
    expect(result.stdout).toContain('No validator licenses returned.')
    expect(result.stdout).not.toContain('Next page token:')
  })

  it('rethrows unexpected operator command errors', async () => {
    class BoomHarness extends OperatorValidatorLicenses {
      protected override createValidatorLicensesOperator() {
        return {
          list: vi.fn().mockRejectedValue(new Error('boom')),
        }
      }

      protected override async resolveOperatorCommandSurface() {
        return createSurface()
      }
    }

    await expect(BoomHarness.run(['--profile', 'splice-devnet', '--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
  })
})
