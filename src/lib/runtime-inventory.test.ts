import {describe, expect, it} from 'vitest'

import type {CantonctlConfig} from './config.js'
import {inspectProfile, summarizeProfileServices} from './compat.js'
import type {LocalnetStatusResult} from './localnet.js'
import {summarizeProfileCapabilities} from './control-plane.js'
import {
  createLocalnetWorkspaceInventory,
  createMultiNodeStatusInventory,
  createProfileStatusInventory,
  createSingleNodeStatusInventory,
  summarizeStatusInventory,
} from './runtime-inventory.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networkProfiles: {
      devnet: 'splice-devnet',
      docker: 'multi',
      local: 'sandbox',
    },
    networks: {
      devnet: {type: 'remote', url: 'https://devnet-ledger.example.com'},
      docker: {type: 'docker'},
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
    profiles: {
      multi: {
        experimental: false,
        kind: 'canton-multi',
        name: 'multi',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {'json-api-port': 7576, port: 5002},
        },
      },
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
          scanProxy: {url: 'https://scan-proxy.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createLocalnetStatusResult(selectedProfile: 'app-provider' | 'app-user' | 'sv' = 'sv'): LocalnetStatusResult {
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
  const selected = profiles[selectedProfile]

  return {
    containers: [],
    health: {
      validatorReadyz: {
        body: 'ready',
        healthy: true,
        status: 200,
        url: selected.health.validatorReadyz,
      },
    },
    profiles,
    selectedProfile,
    services: {
      ledger: {url: selected.urls.ledger},
      scan: 'scan' in selected.urls && selected.urls.scan ? {url: selected.urls.scan} : undefined,
      validator: {url: selected.urls.validator},
      wallet: {url: selected.urls.wallet},
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
        ledger: selected.urls.ledger,
        scan: 'scan' in selected.urls && selected.urls.scan ? selected.urls.scan : '',
        validator: selected.urls.validator,
        wallet: selected.urls.wallet,
      },
    },
  }
}

describe('runtime inventory', () => {
  it('summarizes remote profile capabilities, health, and warnings', () => {
    const inspection = inspectProfile(createConfig(), 'splice-devnet')
    const inventory = createProfileStatusInventory({inspection})

    expect(inventory).toEqual(expect.objectContaining({
      mode: 'profile',
      profile: expect.objectContaining({
        kind: 'remote-validator',
        name: 'splice-devnet',
        resolvedFrom: 'argument',
      }),
      schemaVersion: 1,
    }))
    expect(inventory.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'ledger',
        runtimeProvenance: 'declared',
        status: 'configured',
      }),
      expect.objectContaining({
        name: 'scanProxy',
        warnings: [expect.objectContaining({code: 'experimental-surface'})],
      }),
      expect.objectContaining({
        name: 'validator',
        warnings: [expect.objectContaining({code: 'operator-surface'})],
      }),
    ]))
    expect(inventory.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'service',
        managementEligibility: 'plan-only',
        name: 'validator',
        provenance: 'declared',
      }),
      expect.objectContaining({
        endpoint: undefined,
        health: expect.objectContaining({status: 'not-applicable'}),
        kind: 'sdk',
        name: 'wallet-integration',
        provenance: 'declared',
      }),
    ]))
    expect(summarizeStatusInventory(inventory.services)).toEqual({
      configuredServices: 6,
      healthyServices: 0,
      unreachableServices: 0,
    })
  })

  it('marks observed remote profile ledgers as declared when a URL is configured', () => {
    const inspection = inspectProfile(createConfig(), 'splice-devnet')
    const inventory = createProfileStatusInventory({
      inspection,
      ledger: {
        endpoint: 'https://ledger.example.com',
        healthy: true,
        parties: [],
        version: '3.4.11',
      },
    })

    expect(inventory.services.find(service => service.name === 'ledger')).toEqual(expect.objectContaining({
      runtimeProvenance: 'declared',
      status: 'healthy',
    }))
  })

  it('marks observed local profile ledgers as derived-local-default when no URL is declared', () => {
    const inspection = inspectProfile(createConfig(), 'sandbox')
    const inventory = createProfileStatusInventory({
      inspection,
      ledger: {
        endpoint: 'http://localhost:7575',
        healthy: true,
        parties: [],
        version: '3.4.11',
      },
    })

    expect(inventory.services.find(service => service.name === 'ledger')).toEqual(expect.objectContaining({
      runtimeProvenance: 'derived-local-default',
      status: 'healthy',
    }))
  })

  it('records remote discovery drift when the observed endpoint differs from the resolved profile', () => {
    const inspection = inspectProfile(createConfig(), 'splice-devnet')
    const inventory = createSingleNodeStatusInventory({
      inspection,
      ledger: {
        endpoint: 'https://devnet-ledger.example.com',
        healthy: true,
        parties: [],
        version: '3.4.11',
      },
      networkName: 'devnet',
      networkType: 'remote',
    })

    expect(inventory.mode).toBe('single-node')
    expect(inventory.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        drift: [expect.objectContaining({code: 'endpoint-mismatch'})],
        name: 'ledger',
        runtimeProvenance: 'remote-discovery',
        status: 'healthy',
      }),
    ]))
    expect(inventory.drift).toEqual([
      expect.objectContaining({
        capability: 'ledger',
        code: 'endpoint-mismatch',
        expected: 'https://ledger.example.com',
        observed: 'https://devnet-ledger.example.com',
      }),
    ])
  })

  it('records a profile-kind mismatch when a remote profile is pointed at a sandbox runtime', () => {
    const inventory = createSingleNodeStatusInventory({
      inspection: inspectProfile(createConfig(), 'splice-devnet'),
      ledger: {
        endpoint: 'http://localhost:7575',
        healthy: true,
        parties: [],
        version: '3.4.11',
      },
      networkName: 'local',
      networkType: 'sandbox',
    })

    expect(inventory.drift).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'profile-kind-mismatch',
        expected: 'remote-validator',
        observed: 'sandbox',
      }),
    ]))
  })

  it('keeps remote sv profiles drift-free on remote targets and honors legacy-network provenance', () => {
    const legacyProfile = {
      definitionSource: 'legacy-network' as const,
      experimental: false,
      kind: 'remote-sv-network' as const,
      name: 'svnet',
      services: {
        ledger: {url: 'https://sv-ledger.example.com'},
        scan: {url: 'https://scan.example.com'},
      },
    }
    const inventory = createSingleNodeStatusInventory({
      inspection: {
        capabilities: summarizeProfileCapabilities(legacyProfile),
        profile: legacyProfile,
        resolvedFrom: 'argument',
        services: summarizeProfileServices(legacyProfile),
      },
      ledger: {
        endpoint: 'https://sv-ledger.example.com',
        healthy: true,
        parties: [],
        version: '3.4.11',
      },
      networkName: 'svnet',
      networkType: 'remote',
    })

    expect(inventory.drift).toEqual([])
    expect(inventory.services.find(service => service.name === 'ledger')).toEqual(expect.objectContaining({
      runtimeProvenance: 'remote-discovery',
      status: 'healthy',
    }))
  })

  it('keeps legacy-network provenance for local single-node inventories', () => {
    const legacyProfile = {
      definitionSource: 'legacy-network' as const,
      experimental: false,
      kind: 'sandbox' as const,
      name: 'local',
      services: {
        ledger: {'json-api-port': 7575, port: 5001},
      },
    }
    const inventory = createSingleNodeStatusInventory({
      inspection: {
        capabilities: summarizeProfileCapabilities(legacyProfile),
        profile: legacyProfile,
        resolvedFrom: 'argument',
        services: summarizeProfileServices(legacyProfile),
      },
      ledger: {
        endpoint: 'http://localhost:7575',
        healthy: true,
        parties: [],
        version: '3.4.11',
      },
      networkName: 'local',
      networkType: 'sandbox',
    })

    expect(inventory.services.find(service => service.name === 'ledger')).toEqual(expect.objectContaining({
      runtimeProvenance: 'legacy-network',
      status: 'healthy',
    }))
  })

  it('flags generated-topology drift when the inferred profile kind is not canton-multi', () => {
    const inspection = inspectProfile(createConfig(), 'sandbox')
    const inventory = createMultiNodeStatusInventory({
      inspection,
      networkName: 'local',
      nodes: [
        {healthy: true, name: 'participant1', parties: [], port: 7575, version: '3.4.11'},
        {healthy: false, name: 'participant2', parties: [], port: 7576},
      ],
    })

    expect(inventory.mode).toBe('multi-node')
    expect(inventory.drift).toEqual([expect.objectContaining({
      code: 'profile-kind-mismatch',
      expected: 'sandbox',
      observed: 'generated-topology',
    })])
    expect(inventory.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'ledger',
        runtimeProvenance: 'generated-topology',
        status: 'unreachable',
      }),
    ]))
  })

  it('keeps matching single-node sandbox and docker inventories drift-free', () => {
    const sandboxInventory = createSingleNodeStatusInventory({
      inspection: inspectProfile(createConfig(), 'sandbox'),
      ledger: {
        endpoint: 'http://localhost:7575',
        healthy: true,
        parties: [],
        version: '3.4.11',
      },
      networkName: 'local',
      networkType: 'sandbox',
    })
    const dockerInventory = createSingleNodeStatusInventory({
      inspection: inspectProfile(createConfig(), 'multi'),
      ledger: {
        endpoint: 'http://localhost:7576',
        healthy: true,
        parties: [],
        version: '3.4.11',
      },
      networkName: 'docker',
      networkType: 'docker',
    })
    const multiNodeInventory = createMultiNodeStatusInventory({
      inspection: inspectProfile(createConfig(), 'multi'),
      networkName: 'docker',
      nodes: [{healthy: true, name: 'participant1', parties: [], port: 7576, version: '3.4.11'}],
    })

    expect(sandboxInventory.drift).toEqual([])
    expect(dockerInventory.drift).toEqual([])
    expect(multiNodeInventory.drift).toEqual([])
  })

  it('falls back to a default multi-node ledger endpoint when no nodes are discovered', () => {
    const inventory = createMultiNodeStatusInventory({
      networkName: 'local',
      nodes: [],
    })

    expect(inventory.services).toEqual([
      expect.objectContaining({
        endpoint: 'http://localhost:7575',
        name: 'ledger',
        runtimeProvenance: 'generated-topology',
      }),
    ])
  })

  it('builds localnet-workspace inventory with apply-capable localnet lifecycle metadata', () => {
    const inventory = createLocalnetWorkspaceInventory(createLocalnetStatusResult())

    expect(inventory).toEqual(expect.objectContaining({
      mode: 'localnet-workspace',
      profile: expect.objectContaining({
        kind: 'splice-localnet',
        name: 'sv',
        resolvedFrom: 'localnet-workspace',
      }),
      workspace: '/workspace',
    }))
    expect(inventory.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        health: expect.objectContaining({status: 'healthy'}),
        name: 'localnet',
        runtimeProvenance: 'localnet-workspace',
      }),
      expect.objectContaining({
        endpoint: 'http://wallet.localhost:4000/api/validator',
        health: expect.objectContaining({status: 'healthy'}),
        name: 'validator',
        runtimeProvenance: 'localnet-workspace',
      }),
    ]))
    expect(inventory.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'service',
        managementEligibility: 'apply-capable',
        name: 'localnet',
        provenance: 'localnet-workspace',
      }),
      expect.objectContaining({
        kind: 'sdk',
        name: 'wallet-integration',
        provenance: 'localnet-workspace',
      }),
    ]))
  })

  it('omits scan inventory for workspace profiles that do not expose it', () => {
    const inventory = createLocalnetWorkspaceInventory(createLocalnetStatusResult('app-user'))

    expect(inventory.services.find(service => service.name === 'scan')).toBeUndefined()
    expect(inventory.capabilities.find(capability => capability.name === 'scan')).toBeUndefined()
  })
})
