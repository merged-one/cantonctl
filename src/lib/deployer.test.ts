import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from './config.js'
import {summarizeProfileCapabilities, summarizeServiceControlPlane} from './control-plane.js'
import {createDeployer, type DeployerDeps} from './deployer.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {LedgerClient} from './ledger-client.js'
import {createPluginHookManager} from './plugin-hooks.js'
import type {ResolvedProfileRuntime} from './profile-runtime.js'
import {createProfileStatusInventory} from './runtime-inventory.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networkProfiles: {
      devnet: 'splice-devnet',
      local: 'sandbox',
      multi: 'multi',
    },
    networks: {
      devnet: {auth: 'jwt', type: 'remote', url: 'https://ledger.devnet.example.com'},
      local: {auth: 'shared-secret', type: 'sandbox'},
      multi: {auth: 'shared-secret', type: 'docker'},
    },
    parties: [
      {name: 'Alice', role: 'operator'},
      {name: 'Bob', role: 'participant'},
    ],
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {'json-api-port': 7575, port: 5001},
        },
      },
      multi: {
        experimental: false,
        kind: 'canton-multi',
        name: 'multi',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {'json-api-port': 7575, port: 5001},
          localnet: {},
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {audience: 'https://wallet.example.com', issuer: 'https://login.example.com', kind: 'jwt'},
          ledger: {url: 'https://ledger.devnet.example.com'},
          scan: {url: 'https://scan.devnet.example.com'},
          validator: {url: 'https://validator.devnet.example.com'},
        },
      },
      'sv-network': {
        experimental: false,
        kind: 'remote-sv-network',
        name: 'sv-network',
        services: {
          scan: {url: 'https://scan.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createRuntime(options: {
  authEnvVarName: string
  authMode: string
  credentialSource: ResolvedProfileRuntime['credential']['source']
  networkName: string
  operatorCredentialSource?: ResolvedProfileRuntime['operatorCredential']['source']
  profile: ResolvedProfileRuntime['profile']
  token?: string
  operatorToken?: string
}): ResolvedProfileRuntime {
  const services = Object.entries(options.profile.services)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ({
      controlPlane: summarizeServiceControlPlane(options.profile, name as never),
      detail: `${name} endpoint`,
      endpoint: typeof value === 'object' && value && 'url' in value && typeof value.url === 'string'
        ? value.url
        : name === 'ledger'
          ? `http://localhost:${(value as {['json-api-port']?: number})['json-api-port'] ?? 7575}`
          : undefined,
      name: name as never,
      sourceIds: [],
      stability: 'config-only' as const,
    }))
  const capabilities = summarizeProfileCapabilities(options.profile)

  return {
    auth: {
      app: {
        description: '',
        envVarName: options.authEnvVarName,
        keychainAccount: options.networkName,
        localFallbackAllowed: options.credentialSource === 'fallback',
        prerequisites: [],
        required: options.credentialSource !== 'fallback',
        scope: 'app',
      },
      authKind: options.profile.services.auth?.kind ?? 'unspecified',
      description: '',
      envVarName: options.authEnvVarName,
      experimental: false,
      mode: options.authMode as never,
      network: options.networkName,
      operator: {
        description: '',
        envVarName: options.authEnvVarName.replace(/^CANTONCTL_JWT_/, 'CANTONCTL_OPERATOR_TOKEN_'),
        keychainAccount: `operator:${options.networkName}`,
        localFallbackAllowed: options.credentialSource === 'fallback',
        prerequisites: [],
        required: options.profile.kind === 'remote-validator' || options.profile.kind === 'remote-sv-network',
        scope: 'operator',
      },
      requiresExplicitExperimental: false,
      warnings: [],
    },
    capabilities,
    compatibility: {
      checks: [],
      failed: 0,
      passed: 1,
      profile: {
        experimental: options.profile.experimental,
        kind: options.profile.kind,
        name: options.profile.name,
      },
      services,
      warned: 0,
    },
    credential: {
      mode: options.authMode as never,
      network: options.networkName,
      scope: 'app',
      source: options.credentialSource,
      token: options.token,
    },
    inventory: createProfileStatusInventory({
      inspection: {
        capabilities,
        profile: options.profile,
        resolvedFrom: 'argument',
        services,
      },
    }),
    networkName: options.networkName,
    operatorCredential: {
      mode: options.authMode as never,
      network: options.networkName,
      scope: 'operator',
      source: options.operatorCredentialSource ?? options.credentialSource,
      token: options.operatorToken ?? options.token,
    },
    profile: options.profile,
    profileContext: {
      experimental: options.profile.experimental,
      kind: options.profile.kind,
      name: options.profile.name,
      services: options.profile.services,
    },
    services,
  }
}

function createLedgerClient(): LedgerClient & {
  getVersion: ReturnType<typeof vi.fn>
  uploadDar: ReturnType<typeof vi.fn>
} {
  return {
    allocateParty: vi.fn(),
    getActiveContracts: vi.fn(),
    getLedgerEnd: vi.fn().mockResolvedValue({offset: 0}),
    getParties: vi.fn(),
    getVersion: vi.fn().mockResolvedValue({version: '3.4.11'}),
    submitAndWait: vi.fn(),
    uploadDar: vi.fn().mockResolvedValue({mainPackageId: 'pkg-abc123'}),
  }
}

function createRuntimeResolverFactory(runtime: ResolvedProfileRuntime) {
  return vi.fn((deps?: {createFallbackToken?: (config: CantonctlConfig) => Promise<string>}) => ({
    resolve: vi.fn().mockImplementation(async ({config}: {config: CantonctlConfig}) => {
      if (runtime.credential.source !== 'fallback') {
        return runtime
      }

      return {
        ...runtime,
        credential: {
          ...runtime.credential,
          token: runtime.credential.token ?? await deps?.createFallbackToken?.(config),
        },
        operatorCredential: {
          ...runtime.operatorCredential,
          token: runtime.operatorCredential.token ?? await deps?.createFallbackToken?.(config),
        },
      }
    }),
  }))
}

function createDeps(overrides: Partial<DeployerDeps> = {}) {
  const client = createLedgerClient()
  const deps: DeployerDeps = {
    config: createConfig(),
    createLedgerClient: vi.fn().mockReturnValue(client),
    createProfileRuntimeResolver: createRuntimeResolverFactory(createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_SANDBOX',
      authMode: 'bearer-token',
      credentialSource: 'fallback',
      networkName: 'local',
      profile: createConfig().profiles!.sandbox,
    })),
    createToken: vi.fn().mockResolvedValue('sandbox-token'),
    detectTopology: vi.fn().mockResolvedValue(null),
    findDarFile: vi.fn().mockResolvedValue('/project/.daml/dist/demo.dar'),
    fs: {readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))},
    ...overrides,
  }

  return {client, deps}
}

describe('Deployer', () => {
  it('runs single-target apply against the resolved profile and records package metadata', async () => {
    const {client, deps} = createDeps()
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(deps.createToken).toHaveBeenCalledWith({
      actAs: ['Alice', 'Bob'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: ['Alice', 'Bob'],
    })
    expect(deps.findDarFile).toHaveBeenCalledWith('/project/.daml/dist')
    expect(deps.fs.readFile).toHaveBeenCalledWith('/project/.daml/dist/demo.dar')
    expect(deps.createLedgerClient).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:7575',
      token: 'sandbox-token',
    })
    expect(client.getVersion).toHaveBeenCalledWith(undefined)
    expect(client.uploadDar).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), undefined)
    expect(result).toMatchObject({
      artifact: {
        darPath: '/project/.daml/dist/demo.dar',
        sizeBytes: 3,
        source: 'auto-detected',
      },
      auth: {
        envVarName: 'CANTONCTL_OPERATOR_TOKEN_SANDBOX',
        mode: 'bearer-token',
        scope: 'operator',
        source: 'fallback',
      },
      fanOut: {
        mode: 'single-target',
        participantCount: 1,
        source: 'profile-ledger',
      },
      mode: 'apply',
      profile: {
        kind: 'sandbox',
        name: 'sandbox',
        network: 'local',
      },
      success: true,
    })
    expect(result.targets).toEqual([
      expect.objectContaining({
        baseUrl: 'http://localhost:7575',
        managementClass: 'apply-capable',
        packageId: 'pkg-abc123',
        status: 'completed',
      }),
    ])
    expect(result.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed', 'completed'])
  })

  it('uses legacy target aliases and produces a plan without touching the runtime', async () => {
    const remoteRuntime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
      authMode: 'env-or-keychain-jwt',
      credentialSource: 'stored',
      networkName: 'devnet',
      profile: createConfig().profiles!['splice-devnet'],
      token: 'stored-token',
    })
    const {deps} = createDeps({
      createProfileRuntimeResolver: createRuntimeResolverFactory(remoteRuntime),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      mode: 'plan',
      projectDir: '/project',
      target: 'devnet',
    })

    expect(deps.createLedgerClient).not.toHaveBeenCalled()
    expect(result.mode).toBe('plan')
    expect(result.requestedTarget).toBe('devnet')
    expect(result.profile).toEqual({
      kind: 'remote-validator',
      name: 'splice-devnet',
      network: 'devnet',
    })
    expect(result.targets).toEqual([
      expect.objectContaining({
        baseUrl: 'https://ledger.devnet.example.com',
        packageId: null,
        status: 'ready',
      }),
    ])
    expect(result.steps.map(step => step.status)).toEqual(['completed', 'ready', 'ready', 'ready'])
  })

  it('fans out dry-run deploys across detected local topology participants', async () => {
    const hooks = createPluginHookManager()
    const events: string[] = []
    hooks.register('beforeDeploy', async (context) => {
      events.push(`before:${String(context.target)}`)
    })
    hooks.register('afterDeploy', async () => {
      events.push('after')
    })

    const clientA = createLedgerClient()
    const clientB = createLedgerClient()
    const runtime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_MULTI',
      authMode: 'bearer-token',
      credentialSource: 'fallback',
      networkName: 'multi',
      profile: createConfig().profiles!.multi,
    })
    const {deps} = createDeps({
      createLedgerClient: vi.fn()
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB),
      createProfileRuntimeResolver: createRuntimeResolverFactory(runtime),
      detectTopology: vi.fn().mockResolvedValue({
        bootstrapScript: '',
        cantonConf: '',
        dockerCompose: '',
        participants: [
          {name: 'participant-a', parties: ['Alice'], ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865}},
          {name: 'participant-b', parties: ['Bob'], ports: {admin: 2002, jsonApi: 7576, ledgerApi: 6866}},
        ],
        synchronizer: {admin: 10001, publicApi: 10002},
      }),
      hooks,
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      dryRun: true,
      profileName: 'multi',
      projectDir: '/project',
    })

    expect(deps.createLedgerClient).toHaveBeenNthCalledWith(1, {
      baseUrl: 'http://localhost:7575',
      token: 'sandbox-token',
    })
    expect(deps.createLedgerClient).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://localhost:7576',
      token: 'sandbox-token',
    })
    expect(clientA.getVersion).toHaveBeenCalledTimes(1)
    expect(clientB.getVersion).toHaveBeenCalledTimes(1)
    expect(clientA.uploadDar).not.toHaveBeenCalled()
    expect(clientB.uploadDar).not.toHaveBeenCalled()
    expect(events).toEqual(['before:participant-a', 'before:participant-b'])
    expect(result.fanOut).toEqual({
      mode: 'fan-out',
      participantCount: 2,
      source: 'generated-topology',
    })
    expect(result.targets).toEqual([
      expect.objectContaining({label: 'participant-a', packageId: null, status: 'dry-run'}),
      expect.objectContaining({label: 'participant-b', packageId: null, status: 'dry-run'}),
    ])
  })

  it('blocks runtime mutation cleanly when remote credentials are missing', async () => {
    const runtime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
      authMode: 'env-or-keychain-jwt',
      credentialSource: 'missing',
      networkName: 'devnet',
      profile: createConfig().profiles!['splice-devnet'],
    })
    const {deps} = createDeps({
      createProfileRuntimeResolver: createRuntimeResolverFactory(runtime),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'splice-devnet',
      projectDir: '/project',
    })

    expect(deps.createLedgerClient).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.targets).toEqual([
      expect.objectContaining({
        packageId: null,
        status: 'blocked',
      }),
    ])
    expect(result.steps).toEqual([
      expect.objectContaining({id: 'resolve-dar', status: 'completed'}),
      expect.objectContaining({
        id: 'preflight-splice-devnet',
        preconditions: expect.arrayContaining([
          expect.objectContaining({code: 'credential-material', status: 'block'}),
        ]),
        status: 'blocked',
      }),
      expect.objectContaining({id: 'upload-splice-devnet', status: 'pending'}),
      expect.objectContaining({id: 'verify-splice-devnet', status: 'pending'}),
    ])
  })

  it('refuses profiles without a deployable ledger endpoint', async () => {
    const runtime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_SV',
      authMode: 'env-or-keychain-jwt',
      credentialSource: 'stored',
      networkName: 'sv-network',
      profile: createConfig().profiles!['sv-network'],
      token: 'stored-token',
    })
    const {deps} = createDeps({
      createProfileRuntimeResolver: createRuntimeResolverFactory(runtime),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      mode: 'plan',
      profileName: 'sv-network',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.targets).toEqual([
      expect.objectContaining({
        baseUrl: undefined,
        managementClass: 'read-only',
        status: 'blocked',
      }),
    ])
  })

  it('maps upload conflicts into package-exists failures inside the rollout result', async () => {
    const {client, deps} = createDeps()
    client.uploadDar.mockRejectedValue(
      new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED, {
        context: {status: 409},
        suggestion: 'Conflict',
      }),
    )
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.targets).toEqual([
      expect.objectContaining({
        packageId: null,
        status: 'failed',
      }),
    ])
    expect(result.steps).toEqual([
      expect.objectContaining({id: 'resolve-dar', status: 'completed'}),
      expect.objectContaining({id: 'preflight-sandbox', status: 'completed'}),
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCode.DEPLOY_PACKAGE_EXISTS,
          suggestion: 'A package with this name and version already exists. Increment the version in daml.yaml.',
        }),
        id: 'upload-sandbox',
        status: 'failed',
      }),
      expect.objectContaining({id: 'verify-sandbox', status: 'pending'}),
    ])
  })

  it('uses default runtime resolution, DAR detection, and cwd defaults when optional deps are omitted', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-deployer-defaults-'))
    const distDir = path.join(tempDir, '.daml/dist')
    fs.mkdirSync(distDir, {recursive: true})
    fs.writeFileSync(path.join(distDir, 'demo.dar'), Buffer.from([1, 2, 3]))

    const previousCwd = process.cwd()
    const createToken = vi.fn().mockResolvedValue('sandbox-token')

    try {
      process.chdir(tempDir)
      const client = createLedgerClient()
      const deployer = createDeployer({
        config: {
          ...createConfig(),
          parties: undefined,
        },
        createLedgerClient: vi.fn().mockReturnValue(client),
        createToken,
        fs: {readFile: (filePath: string) => fs.promises.readFile(filePath)},
      })

      const result = await deployer.deploy({mode: 'plan', target: 'multi'})

      expect(createToken).toHaveBeenCalledWith({
        actAs: ['admin'],
        admin: true,
        applicationId: 'cantonctl',
        readAs: [],
      })
      const resolvedDarPath = fs.realpathSync(path.join(distDir, 'demo.dar'))
      expect(result.artifact).toEqual(expect.objectContaining({
        darPath: resolvedDarPath,
        source: 'auto-detected',
      }))
      expect(result.requestedTarget).toBe('multi')
    } finally {
      process.chdir(previousCwd)
      fs.rmSync(tempDir, {force: true, recursive: true})
    }
  })

  it('passes through unresolved targets when no profile mapping exists', async () => {
    const runtime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_SANDBOX',
      authMode: 'bearer-token',
      credentialSource: 'fallback',
      networkName: 'local',
      profile: createConfig().profiles!.sandbox,
    })
    let resolvedProfileName: string | undefined
    const {deps} = createDeps({
      createProfileRuntimeResolver: vi.fn().mockReturnValue({
        resolve: vi.fn().mockImplementation(async ({profileName}: {profileName?: string}) => {
          resolvedProfileName = profileName
          return runtime
        }),
      }),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      mode: 'plan',
      projectDir: '/project',
      target: 'ad-hoc-target',
    })

    expect(resolvedProfileName).toBe('ad-hoc-target')
    expect(result.requestedTarget).toBe('ad-hoc-target')
  })

  it('maps unreachable local ledgers into deploy-network-unreachable guidance', async () => {
    const {client, deps} = createDeps()
    client.getVersion.mockRejectedValue(new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED, {
      suggestion: 'sandbox down',
    }))
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCode.DEPLOY_NETWORK_UNREACHABLE,
          suggestion: 'Cannot reach sandbox at http://localhost:7575. Start the local runtime before deploying.',
        }),
        id: 'preflight-sandbox',
        status: 'failed',
      }),
    ]))
  })

  it('maps unreachable remote ledgers into remote guidance', async () => {
    const remoteRuntime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
      authMode: 'env-or-keychain-jwt',
      credentialSource: 'stored',
      networkName: 'devnet',
      profile: createConfig().profiles!['splice-devnet'],
      token: 'stored-token',
    })
    const {client, deps} = createDeps({
      createProfileRuntimeResolver: createRuntimeResolverFactory(remoteRuntime),
    })
    client.getVersion.mockRejectedValue(new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED, {
      suggestion: 'remote down',
    }))
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'splice-devnet',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCode.DEPLOY_NETWORK_UNREACHABLE,
          suggestion: 'Cannot reach splice-devnet at https://ledger.devnet.example.com. Confirm the remote ledger endpoint and auth material.',
        }),
        id: 'preflight-splice-devnet',
        status: 'failed',
      }),
    ]))
  })

  it('surfaces unexpected preflight errors inside the rollout result', async () => {
    const {client, deps} = createDeps()
    client.getVersion.mockRejectedValue(new Error('preflight exploded'))
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({message: 'preflight exploded'}),
        id: 'preflight-sandbox',
        status: 'failed',
      }),
    ]))
  })

  it('preserves explicit deploy-upload-failed errors', async () => {
    const {client, deps} = createDeps()
    client.uploadDar.mockRejectedValue(new CantonctlError(ErrorCode.DEPLOY_UPLOAD_FAILED, {
      suggestion: 'inspect participant logs',
    }))
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCode.DEPLOY_UPLOAD_FAILED,
          suggestion: 'inspect participant logs',
        }),
        id: 'upload-sandbox',
        status: 'failed',
      }),
    ]))
  })

  it('surfaces unexpected upload errors inside the rollout result', async () => {
    const {client, deps} = createDeps()
    client.uploadDar.mockRejectedValue(new Error('upload exploded'))
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({message: 'upload exploded'}),
        id: 'upload-sandbox',
        status: 'failed',
      }),
    ]))
  })

  it('preserves non-conflict cantonctl upload errors inside the rollout result', async () => {
    const {client, deps} = createDeps()
    client.uploadDar.mockRejectedValue(new CantonctlError(ErrorCode.DEPLOY_AUTH_FAILED, {
      suggestion: 'refresh credentials',
    }))
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCode.DEPLOY_AUTH_FAILED,
          suggestion: 'refresh credentials',
        }),
        id: 'upload-sandbox',
        status: 'failed',
      }),
    ]))
  })

  it('fails verify when the ledger upload does not return a package id', async () => {
    const {client, deps} = createDeps()
    client.uploadDar.mockResolvedValue({mainPackageId: ''} as never)
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.targets).toEqual([
      expect.objectContaining({
        packageId: '',
        postDeployChecks: [{
          code: 'package-id-returned',
          detail: 'Ledger did not return a package ID for this upload.',
          status: 'fail',
        }],
        status: 'failed',
      }),
    ])
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({message: 'Ledger did not return a package ID for this upload.'}),
        id: 'verify-sandbox',
        status: 'failed',
      }),
    ]))
  })

  it('falls back to apply-capable fan-out metadata when runtime inventory lacks a ledger service entry', async () => {
    const runtime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_MULTI',
      authMode: 'bearer-token',
      credentialSource: 'fallback',
      networkName: 'multi',
      profile: createConfig().profiles!.multi,
    })
    const {deps} = createDeps({
      createProfileRuntimeResolver: createRuntimeResolverFactory({
        ...runtime,
        services: [],
      }),
      detectTopology: vi.fn().mockResolvedValue({
        bootstrapScript: '',
        cantonConf: '',
        dockerCompose: '',
        participants: [
          {name: 'participant-a', parties: ['Alice'], ports: {admin: 2001, jsonApi: 7575, ledgerApi: 6865}},
        ],
        synchronizer: {admin: 10001, publicApi: 10002},
      }),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      mode: 'plan',
      profileName: 'multi',
      projectDir: '/project',
    })

    expect(result.targets).toEqual([
      expect.objectContaining({
        endpointSource: 'generated-topology',
        managementClass: 'apply-capable',
      }),
    ])
  })

  it('records experimental and official-runtime-boundary warnings for splice-localnet deploy plans', async () => {
    const runtime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_LOCALNET',
      authMode: 'bearer-token',
      credentialSource: 'fallback',
      networkName: 'localnet',
      profile: {
        experimental: true,
        kind: 'splice-localnet',
        name: 'splice-localnet',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {'json-api-port': 7575, port: 5001},
          localnet: {distribution: 'splice-localnet', version: '0.5.3'},
          validator: {url: 'https://validator.local'},
        },
      },
    })
    const {deps} = createDeps({
      createProfileRuntimeResolver: createRuntimeResolverFactory(runtime),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      mode: 'plan',
      profileName: 'splice-localnet',
      projectDir: '/project',
    })

    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'preflight-splice-localnet',
        warnings: expect.arrayContaining([
          expect.objectContaining({code: 'experimental-target'}),
          expect.objectContaining({code: 'official-runtime-boundary'}),
        ]),
      }),
    ]))
  })

  it('records dry-run and apply hook boundaries separately', async () => {
    const hooks = createPluginHookManager()
    const events: string[] = []
    hooks.register('beforeDeploy', async () => { events.push('before') })
    hooks.register('afterDeploy', async () => { events.push('after') })

    const {deps} = createDeps({hooks})
    const deployer = createDeployer(deps)

    const dryRun = await deployer.deploy({
      dryRun: true,
      profileName: 'sandbox',
      projectDir: '/project',
    })
    const apply = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(dryRun.success).toBe(true)
    expect(apply.success).toBe(true)
    expect(events).toEqual(['before', 'before', 'after'])
  })

  it('surfaces missing DAR artifacts as failed artifact resolution', async () => {
    const {deps} = createDeps({
      findDarFile: vi.fn().mockResolvedValue(null),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      mode: 'plan',
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.artifact).toEqual({
      darPath: null,
      sizeBytes: undefined,
      source: 'auto-detected',
    })
    expect(result.steps).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({code: ErrorCode.BUILD_DAR_NOT_FOUND}),
        id: 'resolve-dar',
        status: 'failed',
      }),
      expect.objectContaining({id: 'preflight-sandbox', status: 'ready'}),
      expect.objectContaining({id: 'upload-sandbox', status: 'ready'}),
      expect.objectContaining({id: 'verify-sandbox', status: 'ready'}),
    ])
  })

  it('marks targets pending when apply cannot start after DAR resolution fails', async () => {
    const {deps} = createDeps({
      findDarFile: vi.fn().mockResolvedValue(null),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.targets).toEqual([
      expect.objectContaining({
        packageId: null,
        postDeployChecks: [],
        status: 'pending',
      }),
    ])
  })

  it('surfaces unreadable explicit DAR artifacts as failed artifact resolution', async () => {
    const {deps} = createDeps({
      fs: {readFile: vi.fn().mockRejectedValue(new Error('permission denied'))},
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      darPath: './dist/missing.dar',
      mode: 'plan',
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.artifact).toEqual({
      darPath: null,
      sizeBytes: undefined,
      source: 'explicit',
    })
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({code: ErrorCode.BUILD_DAR_NOT_FOUND}),
        id: 'resolve-dar',
        status: 'failed',
      }),
    ]))
  })

  it('surfaces non-error DAR read failures without a serialized cause', async () => {
    const {deps} = createDeps({
      fs: {readFile: vi.fn().mockRejectedValue('permission denied')},
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      darPath: './dist/missing.dar',
      mode: 'plan',
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(false)
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        error: expect.objectContaining({code: ErrorCode.BUILD_DAR_NOT_FOUND}),
        id: 'resolve-dar',
        status: 'failed',
      }),
    ]))
  })

  it('rethrows unexpected plan-time artifact resolution errors', async () => {
    const {deps} = createDeps({
      findDarFile: vi.fn().mockRejectedValue(new Error('dar lookup exploded')),
    })
    const deployer = createDeployer(deps)

    await expect(deployer.deploy({
      mode: 'plan',
      profileName: 'sandbox',
      projectDir: '/project',
    })).rejects.toThrow('dar lookup exploded')
  })

  it('rethrows invalid profile-resolution failures before building the operation', async () => {
    const {deps} = createDeps({
      createProfileRuntimeResolver: vi.fn().mockReturnValue({
        resolve: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_SCHEMA_VIOLATION, {
          suggestion: 'Choose a profile explicitly.',
        })),
      }),
    })
    const deployer = createDeployer(deps)

    await expect(deployer.deploy({projectDir: '/project'})).rejects.toMatchObject({
      code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
      suggestion: 'Choose a profile explicitly.',
    })
  })

  it('uses explicit DAR paths and local party overrides for fallback tokens', async () => {
    const {deps} = createDeps()
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      darPath: './dist/custom.dar',
      party: 'Charlie',
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(deps.findDarFile).not.toHaveBeenCalled()
    expect(deps.fs.readFile).toHaveBeenCalledWith('/project/dist/custom.dar')
    expect(deps.createToken).toHaveBeenCalledWith(expect.objectContaining({actAs: ['Charlie']}))
    expect(result.artifact).toEqual({
      darPath: '/project/dist/custom.dar',
      sizeBytes: 3,
      source: 'explicit',
    })
  })

  it('records explicit DAR details in plan mode', async () => {
    const {deps} = createDeps()
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      darPath: './dist/custom.dar',
      mode: 'plan',
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.success).toBe(true)
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'Using explicit DAR artifact /project/dist/custom.dar. Build and codegen remain owned by DPM.',
        id: 'resolve-dar',
        status: 'completed',
      }),
    ]))
  })

  it('defaults the ledger JSON API port to 7575 when the profile omits it', async () => {
    const runtime = createRuntime({
      authEnvVarName: 'CANTONCTL_JWT_SANDBOX',
      authMode: 'bearer-token',
      credentialSource: 'fallback',
      networkName: 'local',
      profile: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {port: 5001},
        },
      },
    })
    const {deps} = createDeps({
      createProfileRuntimeResolver: createRuntimeResolverFactory(runtime),
    })
    const deployer = createDeployer(deps)

    const result = await deployer.deploy({
      mode: 'plan',
      profileName: 'sandbox',
      projectDir: '/project',
    })

    expect(result.targets).toEqual([
      expect.objectContaining({baseUrl: 'http://localhost:7575'}),
    ])
  })
})
