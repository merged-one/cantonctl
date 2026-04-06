import {describe, expect, it} from 'vitest'

import type {CantonctlConfig} from './config.js'
import type {ServiceName} from './config-profile.js'
import {inspectProfile} from './compat.js'
import {createControlPlaneDriftReport, renderControlPlaneDriftReport} from './control-plane-drift.js'
import {
  createLocalnetWorkspaceInventory,
  createProfileStatusInventory,
  createSingleNodeStatusInventory,
  type RuntimeInventory,
  type RuntimeInventoryCapability,
  type RuntimeInventoryService,
} from './runtime-inventory.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networkProfiles: {
      devnet: 'splice-devnet',
      local: 'sandbox',
    },
    networks: {
      devnet: {auth: 'jwt', type: 'remote'},
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
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
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {issuer: 'https://login.example.com', kind: 'oidc'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.3.0'},
    version: 1,
  }
}

function createRuntime(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    auth: {
      app: {
        envVarName: 'CANTONCTL_JWT_DEVNET',
        required: true,
      },
      mode: 'env-or-keychain-jwt',
      operator: {
        envVarName: 'CANTONCTL_OPERATOR_TOKEN_DEVNET',
        prerequisites: ['Store an operator credential explicitly before remote mutations.'],
        required: true,
      },
    },
    compatibility: {
      failed: 0,
      passed: 2,
      warned: 0,
    },
    credential: {
      source: 'stored',
    },
    networkName: 'devnet',
    operatorCredential: {
      source: 'stored',
    },
    profile: createConfig().profiles!['splice-devnet'],
    ...overrides,
  }
}

function createLocalnetInventory(healthy: boolean) {
  const profiles = {
    'app-provider': {
      health: {validatorReadyz: 'http://127.0.0.1:3903/api/validator/readyz'},
      name: 'app-provider' as const,
      urls: {
        ledger: 'http://canton.localhost:3000/v2',
        validator: 'http://wallet.localhost:3000/api/validator',
        wallet: 'http://wallet.localhost:3000',
      },
    },
    'app-user': {
      health: {validatorReadyz: 'http://127.0.0.1:2903/api/validator/readyz'},
      name: 'app-user' as const,
      urls: {
        ledger: 'http://canton.localhost:2000/v2',
        validator: 'http://wallet.localhost:2000/api/validator',
        wallet: 'http://wallet.localhost:2000',
      },
    },
    sv: {
      health: {validatorReadyz: 'http://127.0.0.1:4903/api/validator/readyz'},
      name: 'sv' as const,
      urls: {
        ledger: 'http://canton.localhost:4000/v2',
        scan: 'http://scan.localhost:4000/api/scan',
        validator: 'http://wallet.localhost:4000/api/validator',
        wallet: 'http://wallet.localhost:4000',
      },
    },
  }

  return createLocalnetWorkspaceInventory({
    containers: [],
    health: {
      validatorReadyz: {
        body: healthy ? 'ready' : 'starting',
        healthy,
        status: healthy ? 200 : 503,
        url: 'http://127.0.0.1:4903/api/validator/readyz',
      },
    },
    profiles,
    selectedProfile: 'sv',
    services: {
      ledger: {url: 'http://canton.localhost:4000/v2'},
      scan: {url: 'http://scan.localhost:4000/api/scan'},
      validator: {url: 'http://wallet.localhost:4000/api/validator'},
      wallet: {url: 'http://wallet.localhost:4000'},
    },
    workspace: {
      composeFilePath: '/workspace/compose.yaml',
      configDir: '/workspace/config',
      env: {SPLICE_VERSION: '0.5.3'},
      envFilePaths: ['/workspace/.env'],
      localnetDir: '/workspace/docker/modules/localnet',
      makeTargets: {down: 'stop', status: 'status', up: 'start'},
      makefilePath: '/workspace/Makefile',
      profiles,
      root: '/workspace',
      services: {
        ledger: 'http://canton.localhost:4000/v2',
        scan: 'http://scan.localhost:4000/api/scan',
        validator: 'http://wallet.localhost:4000/api/validator',
        wallet: 'http://wallet.localhost:4000',
      },
    },
  })
}

function createManualService(options: {
  controlPlane?: Partial<RuntimeInventoryService['controlPlane']>
  detail?: string
  endpoint?: string
  healthDetail?: string
  healthStatus?: RuntimeInventoryService['health']['status']
  name: ServiceName
  stability?: RuntimeInventoryService['stability']
}): RuntimeInventoryService {
  const healthStatus = options.healthStatus ?? 'healthy'
  return {
    controlPlane: {
      endpointProvenance: 'declared',
      lifecycleOwner: 'official-remote-runtime',
      managementClass: 'read-only',
      mutationScope: 'observed',
      operatorSurface: false,
      ...options.controlPlane,
    },
    detail: options.detail ?? `${options.name} endpoint`,
    drift: [],
    endpoint: options.endpoint ?? `https://${options.name}.example.com`,
    health: {
      checked: true,
      detail: options.healthDetail ?? (healthStatus === 'unreachable' ? 'down' : 'healthy'),
      status: healthStatus,
    },
    name: options.name,
    runtimeProvenance: 'declared',
    sourceIds: [],
    stability: options.stability ?? 'stable-external',
    status: healthStatus === 'unreachable' ? 'unreachable' : 'healthy',
    warnings: [],
  }
}

function createManualCapability(operatorSurface: boolean): RuntimeInventoryCapability {
  return {
    controlPlane: {
      lifecycleOwner: 'external-sdk',
      managementClass: 'read-only',
      mutationScope: 'out-of-scope',
      operatorSurface,
    },
    detail: 'Wallet SDK ownership metadata.',
    drift: [],
    health: {
      checked: false,
      detail: 'Capability metadata only.',
      status: 'not-applicable',
    },
    kind: 'sdk',
    managementEligibility: 'read-only',
    name: 'wallet-integration',
    provenance: 'declared',
    sdkPackages: [],
    sourceIds: [],
    stability: 'public-sdk',
    warnings: [],
  }
}

function createManualInventory(options: {
  capabilities?: RuntimeInventoryCapability[]
  drift?: RuntimeInventory['drift']
  mode?: RuntimeInventory['mode']
  network?: string
  profile?: RuntimeInventory['profile']
  services?: RuntimeInventoryService[]
  workspace?: string
} = {}): RuntimeInventory {
  const capabilities = options.capabilities ?? []
  const services = options.services ?? []
  return {
    capabilities,
    drift: options.drift ?? [],
    mode: options.mode ?? 'profile',
    network: options.network,
    profile: options.profile,
    schemaVersion: 1,
    services,
    summary: {
      configuredCapabilities: capabilities.length,
      configuredServices: services.length,
      driftedCapabilities: capabilities.filter(capability => capability.drift.length > 0).length,
      healthyCapabilities: capabilities.filter(capability => capability.health.status === 'healthy').length,
      healthyServices: services.filter(service => service.status === 'healthy').length,
      unreachableCapabilities: capabilities.filter(capability => capability.health.status === 'unreachable').length,
      unreachableServices: services.filter(service => service.status === 'unreachable').length,
      warnedCapabilities: capabilities.filter(capability => capability.warnings.length > 0).length,
    },
    workspace: options.workspace,
  }
}

describe('createControlPlaneDriftReport', () => {
  it('plans a supported sandbox runtime reconcile for unreachable local ledgers', () => {
    const inventory = createSingleNodeStatusInventory({
      inspection: inspectProfile(createConfig(), 'sandbox'),
      ledger: {
        endpoint: 'http://localhost:7575',
        healthy: false,
        parties: [],
        version: '3.4.11',
      },
      networkName: 'local',
      networkType: 'sandbox',
    })

    const report = createControlPlaneDriftReport({inventory})

    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        boundary: expect.objectContaining({
          owner: 'cantonctl',
          resolution: 'supported-action',
        }),
        code: 'service-unreachable',
        severity: 'fail',
        target: 'ledger',
      }),
    ]))
    expect(report.reconcile.supportedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'start-sandbox-runtime',
        command: 'cantonctl dev',
        owner: 'cantonctl',
      }),
    ]))
  })

  it('surfaces auth and upstream line drift with explicit reconcile paths', () => {
    const inspection = inspectProfile(createConfig(), 'splice-devnet')
    const inventory = createProfileStatusInventory({inspection})

    const report = createControlPlaneDriftReport({
      inventory,
      runtime: createRuntime({
        compatibility: {
          failed: 1,
          passed: 1,
          warned: 0,
        },
        credential: {source: 'missing'},
        operatorCredential: {source: 'missing'},
      }) as never,
    })

    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'cantonctl', resolution: 'supported-action'}),
        code: 'auth-mismatch',
        target: 'app-auth',
      }),
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'cantonctl', resolution: 'supported-action'}),
        code: 'auth-mismatch',
        target: 'operator-auth',
      }),
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'official-stack', resolution: 'manual-runbook'}),
        code: 'upstream-line-mismatch',
        severity: 'fail',
      }),
    ]))
    expect(report.reconcile.supportedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({command: 'cantonctl auth login devnet', owner: 'cantonctl'}),
      expect.objectContaining({command: 'cantonctl auth login devnet --scope operator', owner: 'cantonctl'}),
    ]))
    expect(report.reconcile.runbook).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'align-upstream-line',
        owner: 'official-stack',
      }),
    ]))
  })

  it('turns validator runtime drift into an explicit operator runbook boundary', () => {
    const inspection = inspectProfile(createConfig(), 'splice-devnet')
    const inventory = createProfileStatusInventory({inspection})

    const report = createControlPlaneDriftReport({
      checks: [
        {
          category: 'health',
          detail: 'connect ECONNREFUSED',
          endpoint: 'https://validator.example.com/readyz',
          name: 'Validator readyz',
          status: 'warn',
        },
      ],
      inventory,
      runtime: createRuntime() as never,
    })

    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'service-unreachable',
        target: 'validator',
      }),
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'operator', resolution: 'manual-runbook'}),
        code: 'managed-surface-mismatch',
        target: 'validator',
      }),
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'operator', resolution: 'manual-runbook'}),
        code: 'operator-surface-unmanaged',
        target: 'validator',
      }),
    ]))
    expect(report.reconcile.runbook).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'operator-runbook-validator',
        owner: 'operator',
      }),
    ]))
  })

  it('plans a supported LocalNet workspace reconcile when validator health drifts', () => {
    const inventory = createLocalnetInventory(false)

    const report = createControlPlaneDriftReport({inventory})

    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'service-unreachable',
        target: 'validator',
      }),
    ]))
    expect(report.reconcile.supportedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'start-localnet-workspace',
        command: 'cantonctl localnet up --workspace /workspace --profile sv',
        owner: 'cantonctl',
      }),
    ]))
  })

  it('covers manual drift labels, localnet version drift, and render branches', () => {
    const manualInventory = {
      capabilities: [],
      drift: [],
      mode: 'profile' as const,
      profile: {
        experimental: false,
        kind: 'remote-validator' as const,
        name: 'manual-profile',
        resolvedFrom: 'argument' as const,
      },
      schemaVersion: 1 as const,
      services: [
        {
          controlPlane: {
            endpointProvenance: 'declared' as const,
            lifecycleOwner: 'official-remote-runtime' as const,
            managementClass: 'read-only' as const,
            mutationScope: 'observed' as const,
            operatorSurface: false,
          },
          detail: 'ANS endpoint',
          drift: [],
          endpoint: 'https://ans.example.com',
          health: {checked: true, detail: 'down', status: 'unreachable' as const},
          name: 'ans' as const,
          runtimeProvenance: 'declared' as const,
          sourceIds: ['splice-ans-external-openapi' as const],
          stability: 'stable-external' as const,
          status: 'unreachable' as const,
          warnings: [],
        },
        {
          controlPlane: {
            endpointProvenance: 'declared' as const,
            lifecycleOwner: 'official-remote-runtime' as const,
            managementClass: 'read-only' as const,
            mutationScope: 'observed' as const,
            operatorSurface: false,
          },
          detail: 'Scan proxy endpoint',
          drift: [],
          endpoint: 'https://scan-proxy.example.com',
          health: {checked: true, detail: 'down', status: 'unreachable' as const},
          name: 'scanProxy' as const,
          runtimeProvenance: 'declared' as const,
          sourceIds: ['splice-scan-proxy-openapi' as const],
          stability: 'experimental-internal' as const,
          status: 'unreachable' as const,
          warnings: [],
        },
        {
          controlPlane: {
            endpointProvenance: 'declared' as const,
            lifecycleOwner: 'official-remote-runtime' as const,
            managementClass: 'read-only' as const,
            mutationScope: 'observed' as const,
            operatorSurface: false,
          },
          detail: 'Token Standard endpoint',
          drift: [],
          endpoint: 'https://tokens.example.com',
          health: {checked: true, detail: 'down', status: 'unreachable' as const},
          name: 'tokenStandard' as const,
          runtimeProvenance: 'declared' as const,
          sourceIds: ['splice-token-metadata-openapi' as const],
          stability: 'stable-external' as const,
          status: 'unreachable' as const,
          warnings: [],
        },
      ],
      summary: {
        configuredCapabilities: 0,
        configuredServices: 3,
        driftedCapabilities: 0,
        healthyCapabilities: 0,
        healthyServices: 0,
        unreachableCapabilities: 0,
        unreachableServices: 3,
        warnedCapabilities: 0,
      },
    }

    const manualReport = createControlPlaneDriftReport({inventory: manualInventory})
    expect(manualReport.items).toEqual(expect.arrayContaining([
      expect.objectContaining({detail: 'ANS is unreachable at https://ans.example.com.'}),
      expect.objectContaining({detail: 'Scan proxy is unreachable at https://scan-proxy.example.com.'}),
      expect.objectContaining({detail: 'Token Standard is unreachable at https://tokens.example.com.'}),
    ]))

    const localnetVersionReport = createControlPlaneDriftReport({
      inventory: createLocalnetInventory(true),
      runtime: {
        ...createRuntime({
          compatibility: {failed: 0, passed: 2, warned: 0},
          profile: {
            experimental: false,
            kind: 'splice-localnet',
            name: 'sv',
            services: {
              ledger: {url: 'http://canton.localhost:4000/v2'},
              localnet: {distribution: 'splice-localnet'},
              scan: {url: 'http://scan.localhost:4000/api/scan'},
              validator: {url: 'http://wallet.localhost:4000/api/validator'},
            },
          },
        }),
        networkName: 'sv',
      } as never,
    })
    expect(localnetVersionReport.items).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'upstream-line-mismatch', target: 'localnet-version'}),
    ]))

    const out = {
      log: (..._args: unknown[]) => {},
      table: (..._args: unknown[]) => {},
    }
    renderControlPlaneDriftReport(out, {
      items: manualReport.items,
      reconcile: {
        runbook: [],
        summary: manualReport.summary,
        supportedActions: [],
      },
    })
    renderControlPlaneDriftReport(out, manualReport)
  })

  it('covers capability-owned drift, scan fallback boundaries, and skipped health checks', () => {
    const sdkInventory = createManualInventory({
      capabilities: [createManualCapability(false)],
      drift: [{
        capability: 'wallet-integration',
        code: 'profile-kind-mismatch',
        detail: 'The connected wallet SDK targets a different runtime line.',
        expected: 'remote-validator',
        observed: 'single-node',
        severity: 'warn',
      }],
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'sdk-profile',
        resolvedFrom: 'argument',
      },
    })

    const operatorSdkInventory = createManualInventory({
      capabilities: [createManualCapability(true)],
      drift: [{
        capability: 'wallet-integration',
        code: 'profile-kind-mismatch',
        detail: 'The connected wallet SDK requires an operator-owned surface.',
        expected: 'remote-validator',
        observed: 'single-node',
        severity: 'warn',
      }],
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'sdk-profile',
        resolvedFrom: 'argument',
      },
    })

    expect(createControlPlaneDriftReport({inventory: sdkInventory}).items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'official-stack', resolution: 'manual-runbook'}),
        code: 'profile-kind-mismatch',
        severity: 'warn',
        target: 'wallet-integration',
      }),
    ]))
    expect(createControlPlaneDriftReport({inventory: operatorSdkInventory}).items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'operator', resolution: 'manual-runbook'}),
        code: 'profile-kind-mismatch',
        target: 'wallet-integration',
      }),
    ]))

    const endpointMismatchReport = createControlPlaneDriftReport({
      inventory: createManualInventory({
        drift: [{
          capability: 'scan',
          code: 'endpoint-mismatch',
          detail: 'Configured Scan endpoint does not match the discovered runtime endpoint.',
          expected: 'https://configured.example.com',
          observed: 'https://observed.example.com',
          severity: 'warn',
        }],
        services: [createManualService({name: 'scan'})],
      }),
    })
    expect(endpointMismatchReport.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'endpoint-mismatch',
        severity: 'warn',
        target: 'scan',
      }),
    ]))

    const scanFallbackReport = createControlPlaneDriftReport({
      checks: [
        {
          category: 'scan',
          detail: 'Scan is required for the default preflight path.',
          name: 'Scan reachability',
          status: 'fail',
        },
        {
          category: 'scan',
          detail: 'connect ECONNREFUSED',
          name: 'Scan reachability',
          status: 'fail',
        },
      ],
      inventory: createManualInventory(),
    })

    expect(scanFallbackReport.items).toEqual([
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'official-stack', resolution: 'manual-runbook'}),
        code: 'service-missing',
        target: 'scan',
      }),
    ])

    const hiddenLedgerReport = createControlPlaneDriftReport({
      checks: [{
        category: 'health',
        detail: 'endpoint not exposed by this runtime',
        name: 'Ledger readyz',
        status: 'warn',
      }],
      inventory: createManualInventory({
        services: [createManualService({name: 'ledger'})],
      }),
    })

    expect(hiddenLedgerReport.items).toEqual([])
  })

  it('uses inventory fallbacks for auth actions and emits manual upstream runbooks where apply is out of scope', () => {
    const networkFallbackReport = createControlPlaneDriftReport({
      inventory: createManualInventory({network: 'fallback-net'}),
      runtime: createRuntime({
        credential: {source: 'missing'},
        networkName: undefined,
      }) as never,
    })
    expect(networkFallbackReport.reconcile.supportedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({command: 'cantonctl auth login fallback-net'}),
    ]))

    const profileFallbackReport = createControlPlaneDriftReport({
      inventory: createManualInventory({
        profile: {
          experimental: false,
          kind: 'remote-validator',
          name: 'fallback-profile',
          resolvedFrom: 'argument',
        },
      }),
      runtime: createRuntime({
        credential: {source: 'missing'},
        networkName: undefined,
      }) as never,
    })
    expect(profileFallbackReport.reconcile.supportedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({command: 'cantonctl auth login fallback-profile'}),
    ]))

    const unnamedAuthReport = createControlPlaneDriftReport({
      inventory: createManualInventory(),
      runtime: createRuntime({
        credential: {source: 'missing'},
        networkName: undefined,
      }) as never,
    })
    expect(unnamedAuthReport.reconcile.supportedActions).toEqual([])

    const manualServiceReport = createControlPlaneDriftReport({
      inventory: createManualInventory({
        profile: {
          experimental: false,
          kind: 'sandbox',
          name: 'sandbox',
          resolvedFrom: 'argument',
        },
        services: [
          createManualService({
            controlPlane: {
              lifecycleOwner: 'official-local-runtime',
            },
            healthStatus: 'unreachable',
            name: 'scan',
          }),
        ],
      }),
    })
    expect(manualServiceReport.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        boundary: expect.objectContaining({owner: 'cantonctl', resolution: 'manual-runbook'}),
        code: 'service-unreachable',
        target: 'scan',
      }),
    ]))
    expect(manualServiceReport.reconcile.runbook).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'official-runbook-scan',
        owner: 'cantonctl',
      }),
    ]))

    const missingScanReport = createControlPlaneDriftReport({
      checks: [{
        category: 'scan',
        detail: 'Scan is required for the default preflight path.',
        name: 'Scan reachability',
        status: 'fail',
      }],
      inventory: createManualInventory({
        profile: {
          experimental: false,
          kind: 'remote-validator',
          name: 'devnet',
          resolvedFrom: 'argument',
        },
        services: [createManualService({name: 'scan'})],
      }),
    })
    expect(missingScanReport.reconcile.runbook).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'official-runbook-scan',
        owner: 'official-stack',
      }),
    ]))
  })

  it('derives local reconcile actions from inventory modes and renders placeholder commands when needed', () => {
    const multiNodeReport = createControlPlaneDriftReport({
      inventory: createManualInventory({
        mode: 'multi-node',
        services: [
          createManualService({
            controlPlane: {
              lifecycleOwner: 'official-local-runtime',
              managementClass: 'apply-capable',
              mutationScope: 'managed',
            },
            healthStatus: 'unreachable',
            name: 'ledger',
          }),
        ],
      }),
    })
    expect(multiNodeReport.reconcile.supportedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'start-multi-node-runtime',
        command: 'cantonctl dev --net',
      }),
    ]))

    const localnetModeReport = createControlPlaneDriftReport({
      inventory: createManualInventory({
        mode: 'localnet-workspace',
        services: [
          createManualService({
            controlPlane: {
              lifecycleOwner: 'official-local-runtime',
              managementClass: 'apply-capable',
              mutationScope: 'managed',
            },
            healthStatus: 'unreachable',
            name: 'localnet',
          }),
        ],
        workspace: '/tmp/localnet',
      }),
    })
    expect(localnetModeReport.reconcile.supportedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'start-localnet-workspace',
        command: 'cantonctl localnet up --workspace /tmp/localnet',
      }),
    ]))

    const rows: Array<unknown[]> = []
    renderControlPlaneDriftReport({
      log: (..._args: unknown[]) => {},
      table: (..._args: unknown[]) => {
        rows.push(_args[1] as unknown[])
      },
    }, {
      items: [
        {
          boundary: {owner: 'cantonctl', resolution: 'supported-action'},
          code: 'service-unreachable',
          detail: 'Ledger is unreachable.',
          severity: 'fail',
          source: 'inventory',
          target: 'ledger',
        },
      ],
      reconcile: {
        runbook: [],
        summary: localnetModeReport.summary,
        supportedActions: [{
          code: 'custom-supported-action',
          detail: 'Rendered without a command.',
          owner: 'cantonctl',
          targets: ['ledger'],
          title: 'Custom action',
        }],
      },
    })

    expect(rows[1]).toEqual([
      ['Custom action', 'cantonctl', '-', 'Rendered without a command.'],
    ])
  })
})
