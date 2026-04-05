import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../config.js'
import type {NormalizedProfile} from '../config-profile.js'
import {ErrorCode} from '../errors.js'
import {generateTopology} from '../topology.js'

import {
  buildEnvironmentPath,
  buildRemoteServiceMap,
  buildStorageKey,
  createUiController,
  deriveReadinessBadge,
  isLocalProfile,
  renderProfileYaml,
  resolveRequestedProfileName,
  shouldCheckLocalEndpoint,
  stripUndefined,
  toHealthSummary,
} from './controller.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networkProfiles: {
      devnet: 'splice-devnet',
      localnet: 'splice-localnet',
      svnet: 'sv-network',
    },
    networks: {
      devnet: {type: 'remote', url: 'https://ledger.example.com'},
      local: {
        'json-api-port': 7575,
        port: 5001,
        type: 'sandbox',
        url: 'http://localhost:7575',
      },
      localnet: {type: 'docker', url: 'http://canton.localhost:4000/v2'},
      svnet: {type: 'remote', url: 'https://sv-ledger.example.com'},
    },
    parties: [
      {name: 'Alice'},
      {name: 'Bob'},
    ],
    profiles: {
      'broken-localnet': {
        experimental: false,
        kind: 'splice-localnet',
        name: 'broken-localnet',
        services: {
          ledger: {url: 'http://canton.localhost:4100/v2'},
          localnet: {
            distribution: 'splice-localnet',
            'source-profile': 'sv',
            version: '0.5.3',
            workspace: '/broken-workspace',
          },
          scan: {url: 'http://scan.localhost:4100/api/scan'},
          validator: {url: 'http://wallet.localhost:4100/api/validator'},
        },
      },
      'canton-multi': {
        experimental: false,
        kind: 'canton-multi',
        name: 'canton-multi',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {url: 'http://localhost:10013'},
          localnet: {'base-port': 10000, distribution: 'canton-multi'},
        },
      },
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {
            'json-api-port': 7575,
            port: 5001,
            url: 'http://localhost:7575',
          },
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ans: {url: 'https://ans.example.com'},
          auth: {kind: 'oidc', url: 'https://auth.example.com'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://token.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      'splice-localnet': {
        experimental: false,
        kind: 'splice-localnet',
        name: 'splice-localnet',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {url: 'http://canton.localhost:4000/v2'},
          localnet: {
            distribution: 'splice-localnet',
            'source-profile': 'sv',
            version: '0.5.3',
            workspace: '/workspace',
          },
          scan: {url: 'http://scan.localhost:4000/api/scan'},
          tokenStandard: {url: 'http://scan.localhost:4000/api/token-standard'},
          validator: {url: 'http://wallet.localhost:4000/api/validator'},
        },
      },
      'sv-network': {
        experimental: false,
        kind: 'remote-sv-network',
        name: 'sv-network',
        services: {
          auth: {kind: 'oidc', url: 'https://sv-auth.example.com'},
          ledger: {url: 'https://sv-ledger.example.com'},
          scan: {url: 'https://sv-scan.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createFixture(options: {
  detectTopologyResult?: ReturnType<typeof generateTopology> | undefined
  findConfigPath?: string | undefined
} = {}) {
  const config = createConfig()
  const topology = generateTopology({
    cantonImage: 'ghcr.io/example/canton:0.5.3',
    config,
    projectName: config.project.name,
  })
  const ledgerStates = new Map<string, {
    parties?: Array<Record<string, unknown>>
    partiesError?: boolean
    version?: string
    versionError?: boolean
  }>([
    ['http://localhost:7575', {
      parties: [{displayName: 'Alice'}],
      version: '3.4.11',
    }],
    ['http://canton.localhost:4000/v2', {
      partiesError: true,
      version: '3.4.11',
    }],
    ['http://canton.localhost:4100/v2', {
      versionError: true,
    }],
    [`http://localhost:${topology.participants[0]?.ports.jsonApi ?? 10013}`, {
      parties: [{identifier: 'participant1-party'}],
      version: '3.4.11',
    }],
    [`http://localhost:${topology.participants[1]?.ports.jsonApi ?? 10023}`, {
      versionError: true,
    }],
  ])

  const createLedgerClient = vi.fn(({baseUrl, token}: {baseUrl: string; token: string}) => {
    expect(token).toEqual(expect.any(String))
    const state = ledgerStates.get(baseUrl) ?? {versionError: true}
    return {
      getParties: vi.fn(async () => {
        if (state.partiesError) {
          throw new Error('party lookup failed')
        }

        return {partyDetails: state.parties ?? []}
      }),
      getVersion: vi.fn(async () => {
        if (state.versionError) {
          throw new Error('ledger unreachable')
        }

        return {version: state.version}
      }),
    } as never
  })

  const createRuntimeResolver = vi.fn(() => ({
    resolve: vi.fn(async ({config: loadedConfig, profileName}: {config: CantonctlConfig; profileName?: string}) => {
      const resolvedProfile = loadedConfig.profiles?.[profileName ?? loadedConfig['default-profile'] ?? 'sandbox']
      if (!resolvedProfile) {
        throw new Error('Expected profile to exist')
      }

      const runtimeByProfile: Record<string, {
        authWarnings: string[]
        compatibilityFailed: number
        compatibilityWarned: number
        credentialSource: 'fallback' | 'missing' | 'stored'
        envVarName: string
        mode: 'bearer-token' | 'env-or-keychain-jwt'
        networkName: string
      }> = {
        'broken-localnet': {
          authWarnings: ['Using LocalNet fallback token.'],
          compatibilityFailed: 0,
          compatibilityWarned: 0,
          credentialSource: 'fallback',
          envVarName: 'CANTONCTL_JWT_LOCALNET',
          mode: 'bearer-token',
          networkName: 'broken-localnet',
        },
        'canton-multi': {
          authWarnings: ['Using local fallback token.'],
          compatibilityFailed: 0,
          compatibilityWarned: 1,
          credentialSource: 'fallback',
          envVarName: 'CANTONCTL_JWT_LOCAL',
          mode: 'bearer-token',
          networkName: 'local',
        },
        sandbox: {
          authWarnings: ['Using local fallback token.'],
          compatibilityFailed: 0,
          compatibilityWarned: 0,
          credentialSource: 'fallback',
          envVarName: 'CANTONCTL_JWT_LOCAL',
          mode: 'bearer-token',
          networkName: 'local',
        },
        'splice-devnet': {
          authWarnings: ['No stored credential found.'],
          compatibilityFailed: 0,
          compatibilityWarned: 0,
          credentialSource: 'missing',
          envVarName: 'CANTONCTL_JWT_DEVNET',
          mode: 'env-or-keychain-jwt',
          networkName: 'devnet',
        },
        'splice-localnet': {
          authWarnings: ['Using LocalNet fallback token.'],
          compatibilityFailed: 0,
          compatibilityWarned: 0,
          credentialSource: 'fallback',
          envVarName: 'CANTONCTL_JWT_LOCALNET',
          mode: 'bearer-token',
          networkName: 'localnet',
        },
        'sv-network': {
          authWarnings: [],
          compatibilityFailed: 1,
          compatibilityWarned: 0,
          credentialSource: 'stored',
          envVarName: 'CANTONCTL_JWT_SVNET',
          mode: 'env-or-keychain-jwt',
          networkName: 'svnet',
        },
      }

      const runtime = runtimeByProfile[resolvedProfile.name]
      return {
        auth: {
          description: 'UI auth profile',
          envVarName: runtime.envVarName,
          experimental: false,
          mode: runtime.mode,
          network: runtime.networkName,
          profileKind: resolvedProfile.kind,
          profileName: resolvedProfile.name,
          requiresExplicitExperimental: false,
          warnings: runtime.authWarnings,
        },
        compatibility: {
          checks: [],
          failed: runtime.compatibilityFailed,
          passed: 1,
          profile: {
            experimental: resolvedProfile.experimental,
            kind: resolvedProfile.kind,
            name: resolvedProfile.name,
          },
          services: [],
          warned: runtime.compatibilityWarned,
        },
        credential: {
          mode: runtime.mode,
          network: runtime.networkName,
          source: runtime.credentialSource,
          token: runtime.credentialSource === 'missing' ? undefined : `${runtime.networkName}-token`,
        },
        networkName: runtime.networkName,
        profile: resolvedProfile,
        profileContext: {} as never,
      }
    }),
  }))

  const createReadinessRunner = vi.fn(() => ({
    run: vi.fn(async ({config: loadedConfig, profileName}: {config: CantonctlConfig; profileName?: string}) => {
      const resolvedProfile = loadedConfig.profiles?.[profileName ?? 'sandbox']
      if (!resolvedProfile) {
        throw new Error('Expected readiness profile to exist')
      }

      if (resolvedProfile.name === 'sandbox') {
        return {
          auth: {
            credentialSource: 'fallback',
            envVarName: 'CANTONCTL_JWT_LOCAL',
            mode: 'bearer-token',
            warnings: ['Using local fallback token.'],
          },
          canary: {
            checks: [],
            selectedSuites: [],
            skippedSuites: [],
            success: true,
          },
          compatibility: {failed: 0, passed: 1, warned: 0},
          preflight: {
            auth: {
              credentialSource: 'fallback',
              envVarName: 'CANTONCTL_JWT_LOCAL',
              mode: 'bearer-token',
              warnings: [],
            },
            checks: [
              {
                category: 'service',
                detail: 'Ledger warming up.',
                endpoint: 'http://localhost:7575',
                name: 'Ledger',
                status: 'warn',
              },
              {
                category: 'service',
                detail: 'Wallet endpoint not reachable.',
                endpoint: 'http://localhost:9999',
                name: 'Wallet',
                status: 'fail',
              },
              {
                category: 'service',
                detail: 'Sandbox scan check skipped.',
                endpoint: undefined,
                name: 'Scan',
                status: 'skip',
              },
            ],
            compatibility: {failed: 0, passed: 1, warned: 0},
            network: {
              checklist: ['Start sandbox'],
              name: 'local',
              reminders: ['Local fallback token is active.'],
              resetExpectation: 'local-only',
              tier: 'local',
            },
            profile: {
              experimental: resolvedProfile.experimental,
              kind: resolvedProfile.kind,
              name: resolvedProfile.name,
            },
            success: false,
          },
          profile: {
            experimental: resolvedProfile.experimental,
            kind: resolvedProfile.kind,
            name: resolvedProfile.name,
          },
          success: false,
          summary: {failed: 1, passed: 1, skipped: 1, warned: 1},
        } as never
      }

      return {
        auth: {
          credentialSource: resolvedProfile.kind === 'remote-validator' ? 'missing' : 'stored',
          envVarName: resolvedProfile.kind === 'remote-validator' ? 'CANTONCTL_JWT_DEVNET' : 'CANTONCTL_JWT_REMOTE',
          mode: resolvedProfile.kind === 'remote-validator' ? 'env-or-keychain-jwt' : 'bearer-token',
          warnings: [],
        },
        canary: {
          checks: resolvedProfile.kind === 'remote-validator'
            ? [{detail: 'Validator public API reachable.', status: 'pass', suite: 'validator-public', warnings: []}]
            : [],
          selectedSuites: resolvedProfile.kind === 'remote-validator' ? ['validator-public'] : [],
          skippedSuites: resolvedProfile.kind === 'remote-validator' ? ['scan-public'] : [],
          success: true,
        },
        compatibility: {
          failed: resolvedProfile.name === 'sv-network' ? 1 : 0,
          passed: 1,
          warned: 0,
        },
        preflight: {
          auth: {
            credentialSource: resolvedProfile.kind === 'remote-validator' ? 'missing' : 'stored',
            envVarName: resolvedProfile.kind === 'remote-validator' ? 'CANTONCTL_JWT_DEVNET' : 'CANTONCTL_JWT_REMOTE',
            mode: resolvedProfile.kind === 'remote-validator' ? 'env-or-keychain-jwt' : 'bearer-token',
            warnings: [],
          },
          checks: [{
            category: 'service',
            detail: 'Remote services reachable.',
            endpoint: resolvedProfile.services.ledger?.url,
            name: 'Ledger',
            status: 'pass',
          }],
          compatibility: {
            failed: resolvedProfile.name === 'sv-network' ? 1 : 0,
            passed: 1,
            warned: 0,
          },
          network: {
            checklist: ['Confirm remote auth'],
            name: resolvedProfile.name === 'sv-network' ? 'svnet' : 'devnet',
            reminders: [],
            resetExpectation: 'unknown',
            tier: resolvedProfile.kind.startsWith('remote-') ? 'remote' : 'local',
          },
          profile: {
            experimental: resolvedProfile.experimental,
            kind: resolvedProfile.kind,
            name: resolvedProfile.name,
          },
          success: true,
        },
        profile: {
          experimental: resolvedProfile.experimental,
          kind: resolvedProfile.kind,
          name: resolvedProfile.name,
        },
        success: true,
        summary: {failed: 0, passed: 2, skipped: 1, warned: 0},
      } as never
    }),
  }))

  const createDoctor = vi.fn((opts: {profileName?: string}) => ({
    check: vi.fn(async () => (
      opts.profileName === 'sandbox'
        ? {
          checks: [
            {detail: 'Docker daemon reachable.', name: 'Docker', required: false, status: 'warn'},
            {detail: 'Java 21 missing.', name: 'Java 21', required: true, status: 'fail'},
          ],
          failed: 1,
          passed: 0,
          warned: 1,
        } as never
        : {
          checks: [{detail: 'Environment healthy.', name: 'Node.js', required: true, status: 'pass'}],
          failed: 0,
          passed: 1,
          warned: 0,
        } as never
    )),
  }))

  const createDiagnosticsCollector = vi.fn(() => ({
    collect: vi.fn(async ({config: loadedConfig, profileName}: {config: CantonctlConfig; profileName?: string}) => {
      const resolvedProfile = loadedConfig.profiles?.[profileName ?? 'splice-devnet']
      if (!resolvedProfile) {
        throw new Error('Expected diagnostics profile to exist')
      }

      const health = resolvedProfile.name === 'sv-network'
        ? [
          {
            detail: 'Auth needs a token.',
            endpoint: 'https://sv-auth.example.com/readyz',
            name: 'auth-readyz',
            status: 'auth-required',
          },
          {
            detail: 'Scan reachable.',
            endpoint: 'https://sv-scan.example.com/readyz',
            name: 'scan-readyz',
            status: 'healthy',
          },
        ]
        : [
          {
            detail: 'Auth needs a token.',
            endpoint: 'https://auth.example.com/readyz',
            name: 'auth-readyz',
            status: 'auth-required',
          },
          {
            detail: 'Scan reachable.',
            endpoint: 'https://scan.example.com/readyz',
            name: 'scan-readyz',
            status: 'healthy',
          },
          {
            detail: 'Validator unreachable.',
            endpoint: 'https://validator.example.com/readyz',
            name: 'validator-readyz',
            status: 'unreachable',
          },
          {
            detail: 'Token API not exposed.',
            endpoint: 'https://token.example.com/readyz',
            name: 'tokenStandard-readyz',
            status: 'not-exposed',
          },
          {
            detail: 'ANS reachable.',
            endpoint: 'https://ans.example.com/readyz',
            name: 'ans-readyz',
            status: 'healthy',
          },
        ]

      return {
        auth: {
          envVarName: 'CANTONCTL_JWT_REMOTE',
          mode: 'env-or-keychain-jwt',
          source: 'stored',
        },
        compatibility: {failed: 0, passed: 1, warned: 0},
        health,
        metrics: [],
        profile: {
          experimental: resolvedProfile.experimental,
          kind: resolvedProfile.kind,
          name: resolvedProfile.name,
          network: resolvedProfile.name === 'sv-network' ? 'svnet' : 'devnet',
        },
        services: [],
      } as never
    }),
  }))

  const createLocalnet = vi.fn(() => ({
    down: vi.fn(async () => ({target: 'stop', workspace: {root: '/workspace'} as never})),
    status: vi.fn(async ({profile, workspace}: {profile?: string; workspace: string}) => {
      if (workspace === '/broken-workspace') {
        throw new Error('LocalNet down')
      }

      return {
        containers: [],
        health: {
          validatorReadyz: {
            body: 'ok',
            healthy: true,
            status: 200,
            url: 'http://127.0.0.1:4903/api/validator/readyz',
          },
        },
        profiles: {
          sv: {
            health: {validatorReadyz: 'http://127.0.0.1:4903/api/validator/readyz'},
            name: 'sv',
            urls: {
              ledger: 'http://canton.localhost:4000/v2',
              scan: 'http://scan.localhost:4000/api/scan',
              validator: 'http://wallet.localhost:4000/api/validator',
              wallet: 'http://wallet.localhost:4000',
            },
          },
        } as never,
        selectedProfile: (profile ?? 'sv') as never,
        services: {
          ledger: {url: 'http://canton.localhost:4000/v2'},
          scan: {url: 'http://scan.localhost:4000/api/scan'},
          validator: {url: 'http://wallet.localhost:4000/api/validator'},
          wallet: {url: 'http://wallet.localhost:4000'},
        },
        workspace: {root: workspace} as never,
      } as never
    }),
    up: vi.fn(async () => ({
      containers: [],
      health: {
        validatorReadyz: {
          body: 'ok',
          healthy: true,
          status: 200,
          url: 'http://127.0.0.1:4903/api/validator/readyz',
        },
      },
      profiles: {} as never,
      selectedProfile: 'sv' as never,
      services: {
        ledger: {url: 'http://canton.localhost:4000/v2'},
        validator: {url: 'http://wallet.localhost:4000/api/validator'},
        wallet: {url: 'http://wallet.localhost:4000'},
      },
      workspace: {root: '/workspace'} as never,
    } as never)),
  }))

  const controller = createUiController({
    createDiagnosticsCollector,
    createDoctor,
    createLedgerClient,
    createLocalnet,
    createProcessRunner: vi.fn(() => ({} as never)),
    createProfileRuntimeResolver: createRuntimeResolver,
    createReadinessRunner: createReadinessRunner,
    cwd: '/repo',
    detectTopology: vi.fn(async () => (
      Object.prototype.hasOwnProperty.call(options, 'detectTopologyResult')
        ? (options.detectTopologyResult ?? null)
        : topology
    )),
    findConfigPath: vi.fn(() => options.findConfigPath ?? '/repo/cantonctl.yaml'),
    loadConfig: vi.fn(async () => config),
  })

  return {
    config,
    controller,
    topology,
  }
}

describe('ui controller helpers', () => {
  it('covers exported helper behavior for profile selection, rendering, and service maps', () => {
    const config = createConfig()
    const remoteProfile = config.profiles?.['splice-devnet'] as NormalizedProfile

    expect(resolveRequestedProfileName(config, 'splice-devnet')).toBe('splice-devnet')
    expect(resolveRequestedProfileName(config)).toBe('sandbox')
    expect(resolveRequestedProfileName({
      ...config,
      'default-profile': undefined,
      profiles: {
        alpha: remoteProfile,
        beta: config.profiles?.sandbox as NormalizedProfile,
      },
    })).toBe('alpha')

    expect(buildStorageKey('/repo/cantonctl.yaml')).toBe('cantonctl-ui:/repo/cantonctl.yaml')
    expect(deriveReadinessBadge({
      authenticated: false,
      compatibilityFailed: 0,
      compatibilityWarned: 0,
      experimental: false,
      local: false,
    })).toEqual({detail: 'Auth required', tone: 'fail'})
    expect(deriveReadinessBadge({
      authenticated: true,
      compatibilityFailed: 1,
      compatibilityWarned: 0,
      experimental: false,
      local: false,
    })).toEqual({detail: 'Compatibility blocking', tone: 'fail'})
    expect(deriveReadinessBadge({
      authenticated: true,
      compatibilityFailed: 0,
      compatibilityWarned: 0,
      experimental: true,
      local: false,
    })).toEqual({detail: 'Experimental profile', tone: 'warn'})
    expect(deriveReadinessBadge({
      authenticated: true,
      compatibilityFailed: 0,
      compatibilityWarned: 1,
      experimental: false,
      local: false,
    })).toEqual({detail: 'Compatibility warnings', tone: 'warn'})
    expect(deriveReadinessBadge({
      authenticated: true,
      compatibilityFailed: 0,
      compatibilityWarned: 0,
      experimental: false,
      local: true,
    })).toEqual({detail: 'Local runtime', tone: 'info'})

    expect(buildEnvironmentPath(config, 'splice-localnet')).toEqual([
      {active: false, label: 'Sandbox', profiles: ['sandbox'], stage: 'sandbox'},
      {active: true, label: 'Local Control Plane', profiles: ['broken-localnet', 'canton-multi', 'splice-localnet'], stage: 'local'},
      {active: false, label: 'Remote Network', profiles: ['splice-devnet', 'sv-network'], stage: 'remote'},
    ])
    expect(buildEnvironmentPath({
      ...config,
      profiles: {sandbox: config.profiles?.sandbox as NormalizedProfile},
    }, 'sandbox')).toEqual([
      {active: true, label: 'Sandbox', profiles: ['sandbox'], stage: 'sandbox'},
    ])
    expect(isLocalProfile('sandbox')).toBe(true)
    expect(isLocalProfile('remote-validator')).toBe(false)
    expect(shouldCheckLocalEndpoint('http://scan.localhost:4000/api/scan')).toBe(true)
    expect(shouldCheckLocalEndpoint('https://ledger.example.com')).toBe(false)
    expect(shouldCheckLocalEndpoint('not a url')).toBe(false)

    expect(renderProfileYaml(config.profiles?.['splice-localnet'] as NormalizedProfile, ['localnet'])).toContain('profile: splice-localnet')
    expect(renderProfileYaml({
      ...remoteProfile,
      experimental: true,
    }, [])).toContain('experimental: true')

    expect(stripUndefined({
      alpha: 1,
      beta: undefined,
      gamma: [1, undefined, {delta: undefined, epsilon: 2}],
    })).toEqual({
      alpha: 1,
      gamma: [1, {epsilon: 2}],
    })

    expect(buildRemoteServiceMap(remoteProfile, {
      auth: {envVarName: 'JWT', mode: 'env-or-keychain-jwt', source: 'stored'},
      compatibility: {failed: 0, passed: 1, warned: 0},
      health: [
        {detail: 'Auth needs token.', endpoint: 'https://auth.example.com/readyz', name: 'auth-readyz', status: 'auth-required'},
        {detail: 'Scan healthy.', endpoint: 'https://scan.example.com/readyz', name: 'scan-readyz', status: 'healthy'},
        {detail: 'Validator unhealthy.', endpoint: 'https://validator.example.com/readyz', name: 'validator-readyz', status: 'unreachable'},
        {detail: 'Validator later check.', endpoint: 'https://validator.example.com/livez', name: 'validator-livez', status: 'healthy'},
        {detail: 'Token hidden.', endpoint: 'https://token.example.com/readyz', name: 'tokenStandard-readyz', status: 'not-exposed'},
        {detail: 'ANS healthy.', endpoint: 'https://ans.example.com/readyz', name: 'ans-readyz', status: 'healthy'},
      ],
      metrics: [],
      profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'devnet'},
      services: [],
    } as never)).toEqual({
      edges: [
        {from: 'auth', label: 'authenticates', to: 'ledger'},
        {from: 'scan', label: 'indexes', to: 'ledger'},
        {from: 'validator', label: 'submits', to: 'ledger'},
        {from: 'tokenStandard', label: 'reads', to: 'scan'},
        {from: 'ans', label: 'resolves via', to: 'scan'},
      ],
      nodes: expect.arrayContaining([
        expect.objectContaining({id: 'auth', status: 'auth-required', tone: 'warn'}),
        expect.objectContaining({id: 'scan', status: 'healthy', tone: 'pass'}),
        expect.objectContaining({id: 'validator', status: 'unreachable', tone: 'fail'}),
        expect.objectContaining({id: 'tokenStandard', status: 'not-exposed', tone: 'skip'}),
        expect.objectContaining({id: 'ans', status: 'healthy', tone: 'pass'}),
      ]),
    })
    expect(buildRemoteServiceMap({
      experimental: false,
      kind: 'remote-sv-network',
      name: 'ledger-only',
      services: {
        ledger: {url: 'https://ledger-only.example.com'},
      },
    }, {
      auth: {envVarName: 'JWT', mode: 'env-or-keychain-jwt', source: 'stored'},
      compatibility: {failed: 0, passed: 1, warned: 0},
      health: [],
      metrics: [],
      profile: {experimental: false, kind: 'remote-sv-network', name: 'ledger-only', network: 'remote'},
      services: [],
    } as never)).toEqual({
      edges: [],
      nodes: [
        {
          detail: 'Ledger endpoint',
          id: 'ledger',
          kind: 'service',
          label: 'ledger',
          status: 'configured',
          tone: 'info',
          url: 'https://ledger-only.example.com',
        },
      ],
    })

    expect(toHealthSummary('healthy')).toEqual({status: 'healthy', tone: 'pass'})
    expect(toHealthSummary('auth-required')).toEqual({status: 'auth-required', tone: 'warn'})
    expect(toHealthSummary('not-exposed')).toEqual({status: 'not-exposed', tone: 'skip'})
    expect(toHealthSummary('unreachable')).toEqual({status: 'unreachable', tone: 'fail'})
  })
})

describe('ui controller', () => {
  it('builds session, overview, checks, and support data for the read-only control plane', async () => {
    const {controller} = createFixture()

    const session = await controller.getSession({requestedProfile: 'splice-devnet'})
    expect(session).toEqual(expect.objectContaining({
      configPath: '/repo/cantonctl.yaml',
      defaultProfile: 'sandbox',
      requestedProfile: 'splice-devnet',
      selectedProfile: 'splice-devnet',
      storageKey: 'cantonctl-ui:/repo/cantonctl.yaml',
    }))
    expect(session.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'sandbox', readiness: {detail: 'Local runtime', tone: 'info'}}),
      expect.objectContaining({name: 'splice-devnet', readiness: {detail: 'Auth required', tone: 'fail'}}),
      expect.objectContaining({name: 'sv-network', readiness: {detail: 'Compatibility blocking', tone: 'fail'}}),
    ]))

    const overview = await controller.getOverview({profileName: 'sandbox'})
    expect(overview.profile).toEqual({kind: 'sandbox', name: 'sandbox'})
    expect(overview.readiness).toEqual({failed: 1, passed: 1, skipped: 1, success: false, warned: 1})
    expect(overview.services).toEqual(expect.arrayContaining([
      expect.objectContaining({endpoint: 'http://localhost:7575', name: 'ledger', status: 'healthy', tone: 'pass'}),
    ]))
    expect(overview.advisories).toEqual(expect.arrayContaining([
      expect.objectContaining({detail: 'Using local fallback token.', source: 'auth', tone: 'warn'}),
      expect.objectContaining({detail: 'Ledger warming up.', source: 'Ledger', tone: 'warn'}),
      expect.objectContaining({detail: 'Wallet endpoint not reachable.', source: 'Wallet', tone: 'fail'}),
      expect.objectContaining({detail: 'Docker daemon reachable.', source: 'doctor:Docker', tone: 'warn'}),
      expect.objectContaining({detail: 'Java 21 missing.', source: 'doctor:Java 21', tone: 'fail'}),
    ]))

    const checks = await controller.getChecks({profileName: 'splice-devnet'})
    expect(checks).toEqual(expect.objectContaining({
      auth: expect.objectContaining({
        authenticated: false,
        envVarName: 'CANTONCTL_JWT_DEVNET',
        mode: 'env-or-keychain-jwt',
        source: 'missing',
      }),
      canary: expect.objectContaining({
        selectedSuites: ['validator-public'],
        skippedSuites: ['scan-public'],
        success: true,
      }),
      preflight: expect.objectContaining({
        network: expect.objectContaining({name: 'devnet', tier: 'remote'}),
        success: true,
      }),
      profile: {kind: 'remote-validator', name: 'splice-devnet'},
    }))

    const support = await controller.getSupport({profileName: 'splice-devnet'})
    expect(support).toEqual({
      defaults: {
        diagnosticsOutputDir: path.join('/repo', '.cantonctl', 'diagnostics', 'splice-devnet'),
        exportTargets: ['dapp-sdk', 'wallet-sdk', 'dapp-api'],
        scanUrl: 'https://scan.example.com',
      },
      profile: {kind: 'remote-validator', name: 'splice-devnet'},
    })
  })

  it('renders profile detail and runtime data across sandbox, localnet, topology, and remote modes', async () => {
    const {controller, topology} = createFixture()

    const profiles = await controller.getProfiles({profileName: 'splice-localnet'})
    expect(profiles.selected).toEqual(expect.objectContaining({
      auth: expect.objectContaining({authenticated: true, mode: 'bearer-token', source: 'fallback'}),
      imports: {
        localnet: {
          sourceProfile: 'sv',
          version: '0.5.3',
          workspace: '/workspace',
        },
        scan: {url: 'http://scan.localhost:4000/api/scan'},
      },
      kind: 'splice-localnet',
      name: 'splice-localnet',
      networkMappings: ['localnet'],
      networkName: 'localnet',
      validation: {
        detail: 'cantonctl.yaml validates against the canonical schema.',
        valid: true,
      },
    }))
    expect(profiles.selected.yaml).toContain('profile: splice-localnet')
    expect(profiles.selected.services).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'ledger', status: 'healthy', tone: 'pass'}),
      expect.objectContaining({name: 'localnet', status: 'healthy', tone: 'pass'}),
    ]))

    const brokenProfiles = await controller.getProfiles({profileName: 'broken-localnet'})
    expect(brokenProfiles.selected.services).toEqual(expect.arrayContaining([
      expect.objectContaining({detail: 'LocalNet down', name: 'localnet', status: 'unreachable', tone: 'fail'}),
      expect.objectContaining({name: 'ledger', status: 'unreachable', tone: 'fail'}),
    ]))

    const sandboxRuntime = await controller.getRuntime({profileName: 'sandbox'})
    expect(sandboxRuntime).toEqual({
      autoPoll: true,
      mode: 'sandbox',
      profile: {kind: 'sandbox', name: 'sandbox'},
      summary: {
        healthDetail: 'Ledger ready.',
        jsonApiPort: 7575,
        ledgerUrl: 'http://localhost:7575',
        partyCount: 1,
        version: '3.4.11',
      },
    })

    const topologyRuntime = await controller.getRuntime({profileName: 'canton-multi'})
    expect(topologyRuntime.mode).toBe('canton-multi')
    expect(topologyRuntime.topology).toEqual({
      exportJson: expect.stringContaining('"topologyName": "default"'),
      participants: [
        {
          healthy: true,
          name: topology.participants[0]?.name ?? 'participant1',
          parties: ['participant1-party'],
          ports: topology.participants[0]?.ports ?? {admin: 10011, jsonApi: 10013, ledgerApi: 10012},
          version: '3.4.11',
        },
        {
          healthy: false,
          name: topology.participants[1]?.name ?? 'participant2',
          parties: topology.participants[1]?.parties ?? ['Bob'],
          ports: topology.participants[1]?.ports ?? {admin: 10021, jsonApi: 10023, ledgerApi: 10022},
          version: undefined,
        },
      ],
      synchronizer: topology.synchronizer,
      topologyName: 'default',
    })

    const localnetRuntime = await controller.getRuntime({profileName: 'splice-localnet'})
    expect(localnetRuntime).toEqual(expect.objectContaining({
      autoPoll: true,
      mode: 'splice-localnet',
      profile: {kind: 'splice-localnet', name: 'splice-localnet'},
      summary: expect.objectContaining({
        healthDetail: 'Validator readyz healthy.',
        ledgerUrl: 'http://canton.localhost:4000/v2',
        workspace: '/workspace',
      }),
    }))
    expect(localnetRuntime.serviceMap?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'workspace', label: 'LocalNet Workspace', tone: 'info'}),
      expect.objectContaining({id: 'validator', label: 'Validator', status: 'healthy', tone: 'pass'}),
      expect.objectContaining({id: 'scan', label: 'Scan'}),
    ]))

    const brokenLocalnetRuntime = await controller.getRuntime({profileName: 'broken-localnet'})
    expect(brokenLocalnetRuntime).toEqual({
      autoPoll: true,
      mode: 'splice-localnet',
      profile: {kind: 'splice-localnet', name: 'broken-localnet'},
      serviceMap: undefined,
      summary: {
        healthDetail: 'Import a LocalNet workspace to expose live LocalNet status.',
        ledgerUrl: 'http://canton.localhost:4100/v2',
        workspace: '/broken-workspace',
      },
    })

    const remoteRuntime = await controller.getRuntime({profileName: 'splice-devnet'})
    expect(remoteRuntime.mode).toBe('remote')
    expect(remoteRuntime.serviceMap?.edges).toEqual(expect.arrayContaining([
      {from: 'auth', label: 'authenticates', to: 'ledger'},
      {from: 'scan', label: 'indexes', to: 'ledger'},
      {from: 'validator', label: 'submits', to: 'ledger'},
      {from: 'tokenStandard', label: 'reads', to: 'scan'},
      {from: 'ans', label: 'resolves via', to: 'scan'},
    ]))
    expect(remoteRuntime.serviceMap?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'auth', status: 'auth-required', tone: 'warn'}),
      expect.objectContaining({id: 'validator', status: 'unreachable', tone: 'fail'}),
    ]))

    const svRuntime = await controller.getRuntime({profileName: 'sv-network'})
    expect(svRuntime).toEqual(expect.objectContaining({
      autoPoll: false,
      mode: 'remote',
      profile: {kind: 'remote-sv-network', name: 'sv-network'},
    }))
    expect(svRuntime.serviceMap?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'auth', status: 'auth-required', tone: 'warn'}),
      expect.objectContaining({id: 'scan', status: 'healthy', tone: 'pass'}),
    ]))
  })

  it('handles missing config paths and unavailable topology manifests gracefully', async () => {
    const missingConfigController = createUiController({
      cwd: '/repo',
      findConfigPath: vi.fn(() => undefined),
      loadConfig: vi.fn(async () => createConfig()),
    })

    await expect(missingConfigController.getSession()).rejects.toMatchObject({
      code: ErrorCode.CONFIG_NOT_FOUND,
    })

    const {controller} = createFixture({detectTopologyResult: undefined})
    await expect(controller.getRuntime({profileName: 'canton-multi'})).resolves.toEqual({
      autoPoll: true,
      mode: 'canton-multi',
      profile: {kind: 'canton-multi', name: 'canton-multi'},
      topology: {
        exportJson: '',
        participants: [],
        synchronizer: {admin: 0, publicApi: 0},
        topologyName: 'unavailable',
      },
    })
  })

  it('uses the default localnet detector and client wiring when explicit overrides are absent', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-localnet-'))
    await fs.mkdir(path.join(workspace, 'config'), {recursive: true})
    await fs.mkdir(path.join(workspace, 'localnet', 'env'), {recursive: true})
    await Promise.all([
      fs.writeFile(path.join(workspace, 'Makefile'), 'start:\n\t@echo up\nstop:\n\t@echo down\nstatus:\n\t@echo status\n', 'utf8'),
      fs.writeFile(path.join(workspace, 'compose.yaml'), 'services: {}\n', 'utf8'),
      fs.writeFile(path.join(workspace, '.env'), 'HOST_BIND_IP=127.0.0.1\n', 'utf8'),
      fs.writeFile(path.join(workspace, 'localnet', 'compose.yaml'), 'services: {}\n', 'utf8'),
      fs.writeFile(path.join(workspace, 'localnet', 'compose.env'), 'SV_UI_PORT=4000\n', 'utf8'),
      fs.writeFile(path.join(workspace, 'localnet', 'env', 'common.env'), 'VALIDATOR_ADMIN_API_PORT_SUFFIX=903\n', 'utf8'),
    ])

    const config = createConfig()
    const baseLocalnet = config.profiles?.['splice-localnet'] as NormalizedProfile
    config.profiles = {
      'splice-localnet': {
        ...baseLocalnet,
        services: {
          ...baseLocalnet.services,
          localnet: {
            ...baseLocalnet.services.localnet,
            workspace,
          },
        },
      },
    }
    config['default-profile'] = 'splice-localnet'

    const controller = createUiController({
      createLedgerClient: vi.fn(() => ({
        getParties: vi.fn(async () => ({partyDetails: []})),
        getVersion: vi.fn(async () => ({version: '3.4.11'})),
      }) as never),
      createProcessRunner: vi.fn(() => ({
        run: vi.fn(async () => ({
          exitCode: 0,
          stderr: '',
          stdout: 'NAME  IMAGE  COMMAND  SERVICE  CREATED  STATUS  PORTS\nvalidator  img  cmd  validator  now  Up (healthy)  0.0.0.0:4903->4903/tcp\n',
        })),
        which: vi.fn(async () => '/usr/bin/make'),
      }) as never),
      createProfileRuntimeResolver: vi.fn(() => ({
        resolve: vi.fn(async () => ({
          auth: {
            description: 'LocalNet fallback',
            envVarName: 'CANTONCTL_JWT_LOCALNET',
            experimental: false,
            mode: 'bearer-token',
            network: 'localnet',
            profileKind: 'splice-localnet',
            profileName: 'splice-localnet',
            requiresExplicitExperimental: false,
            warnings: [],
          },
          compatibility: {checks: [], failed: 0, passed: 1, profile: {experimental: false, kind: 'splice-localnet', name: 'splice-localnet'}, services: [], warned: 0},
          credential: {mode: 'bearer-token', network: 'localnet', source: 'fallback', token: 'localnet-token'},
          networkName: 'localnet',
          profile: config.profiles?.['splice-localnet'],
          profileContext: {} as never,
        }) as never),
      })),
      createReadinessRunner: vi.fn(() => ({
        run: vi.fn(async () => ({
          auth: {credentialSource: 'fallback', envVarName: 'CANTONCTL_JWT_LOCALNET', mode: 'bearer-token', warnings: []},
          canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
          compatibility: {failed: 0, passed: 1, warned: 0},
          preflight: {
            auth: {credentialSource: 'fallback', envVarName: 'CANTONCTL_JWT_LOCALNET', mode: 'bearer-token', warnings: []},
            checks: [],
            compatibility: {failed: 0, passed: 1, warned: 0},
            network: {checklist: [], name: 'localnet', reminders: [], resetExpectation: 'local-only', tier: 'local'},
            profile: {experimental: false, kind: 'splice-localnet', name: 'splice-localnet'},
            success: true,
          },
          profile: {experimental: false, kind: 'splice-localnet', name: 'splice-localnet'},
          success: true,
          summary: {failed: 0, passed: 1, skipped: 0, warned: 0},
        }) as never),
      })),
      cwd: '/repo',
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => 'ok',
      })) as never,
      findConfigPath: vi.fn(() => '/repo/cantonctl.yaml'),
      loadConfig: vi.fn(async () => config),
    })

    try {
      const runtime = await controller.getRuntime({profileName: 'splice-localnet'})
      expect(runtime).toEqual(expect.objectContaining({
        mode: 'splice-localnet',
        serviceMap: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({id: 'workspace', url: workspace}),
            expect.objectContaining({id: 'validator', status: 'healthy'}),
          ]),
        }),
        summary: expect.objectContaining({
          healthDetail: 'Validator readyz healthy.',
          workspace,
        }),
      }))
    } finally {
      await fs.rm(workspace, {force: true, recursive: true})
    }
  })
})
