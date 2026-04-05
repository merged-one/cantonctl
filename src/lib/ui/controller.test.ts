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
  it('covers controller construction defaults without injecting cwd, env, or fetch', () => {
    const controller = createUiController()

    expect(controller).toEqual(expect.objectContaining({
      getChecks: expect.any(Function),
      getMap: expect.any(Function),
      getOverview: expect.any(Function),
      getProfiles: expect.any(Function),
      getRuntime: expect.any(Function),
      getSession: expect.any(Function),
      getSupport: expect.any(Function),
    }))
  })

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
    expect(resolveRequestedProfileName({
      ...config,
      'default-profile': undefined,
      profiles: undefined,
    })).toBeUndefined()

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
    expect(deriveReadinessBadge({
      authenticated: true,
      compatibilityFailed: 0,
      compatibilityWarned: 0,
      experimental: false,
      local: false,
    })).toEqual({detail: 'Ready', tone: 'pass'})

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
    expect(buildEnvironmentPath({
      ...config,
      profiles: undefined,
    }, 'sandbox')).toEqual([])
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

  it('builds topology-first map data and findings across sandbox, topology, localnet, and remote profiles', async () => {
    const {controller, topology} = createFixture()

    const sandboxMap = await controller.getMap({profileName: 'sandbox'})
    expect(sandboxMap).toEqual(expect.objectContaining({
      autoPoll: true,
      mode: 'sandbox',
      profile: {kind: 'sandbox', name: 'sandbox'},
      summary: {
        detail: 'Sandbox profile on local; 1 visible party.',
        headline: '1 blocking issue',
        readiness: {failed: 1, passed: 1, skipped: 1, success: false, warned: 1},
      },
    }))
    expect(sandboxMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'Network local.',
        id: 'profile',
        kind: 'profile',
        status: 'attention',
        tone: 'fail',
      }),
      expect.objectContaining({
        badges: ['bearer-token', 'fallback'],
        id: 'auth',
        kind: 'auth',
        status: 'fallback',
        tone: 'warn',
      }),
      expect.objectContaining({
        badges: ['SDK 3.4.11'],
        id: 'ledger',
        kind: 'service',
        parties: ['Alice'],
        ports: {'json-api': 7575, port: 5001},
        status: 'healthy',
        tone: 'pass',
      }),
    ]))
    expect(sandboxMap.edges).toEqual(expect.arrayContaining([
      {from: 'profile', label: 'profile', to: 'auth', tone: 'fail'},
      {from: 'auth', label: 'talks to', to: 'ledger', tone: 'pass'},
    ]))
    expect(sandboxMap.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({detail: 'Using local fallback token.', source: 'auth', title: 'Auth posture', tone: 'warn'}),
      expect.objectContaining({source: 'compatibility', title: 'Service auth', tone: 'warn'}),
      expect.objectContaining({detail: 'Ledger warming up.', source: 'preflight', title: 'Ledger', tone: 'warn'}),
      expect.objectContaining({detail: 'Wallet endpoint not reachable.', nodeIds: ['profile'], source: 'preflight', title: 'Wallet', tone: 'fail'}),
      expect.objectContaining({detail: 'Docker daemon reachable.', source: 'doctor', title: 'Docker', tone: 'warn'}),
      expect.objectContaining({detail: 'Java 21 missing.', source: 'doctor', title: 'Java 21', tone: 'fail'}),
    ]))
    expect((sandboxMap.nodes.find(node => node.id === 'auth')?.findingIds ?? []).length).toBeGreaterThan(0)
    expect((sandboxMap.nodes.find(node => node.id === 'profile')?.findingIds ?? []).length).toBeGreaterThan(0)

    const topologyMap = await controller.getMap({profileName: 'canton-multi'})
    expect(topologyMap).toEqual(expect.objectContaining({
      autoPoll: true,
      mode: 'canton-multi',
      profile: {kind: 'canton-multi', name: 'canton-multi'},
      summary: expect.objectContaining({
        detail: '2 participants in topology "default".',
        headline: 'Mapped surfaces healthy',
      }),
    }))
    expect(topologyMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'synchronizer',
        kind: 'synchronizer',
        ports: {
          admin: topology.synchronizer.admin,
          'public-api': topology.synchronizer.publicApi,
        },
        status: 'degraded',
        tone: 'warn',
      }),
      expect.objectContaining({
        badges: ['SDK 3.4.11'],
        id: `participant:${topology.participants[0]?.name ?? 'participant1'}`,
        parties: ['participant1-party'],
        status: 'healthy',
        tone: 'pass',
      }),
      expect.objectContaining({
        id: `participant:${topology.participants[1]?.name ?? 'participant2'}`,
        status: 'unreachable',
        tone: 'fail',
      }),
    ]))
    expect(topologyMap.edges).toEqual(expect.arrayContaining([
      {from: 'profile', label: 'profile', to: 'auth', tone: 'pass'},
      {from: 'auth', label: 'authorizes', to: 'synchronizer', tone: 'warn'},
      {from: 'synchronizer', label: 'sync', to: `participant:${topology.participants[0]?.name ?? 'participant1'}`, tone: 'pass'},
      {from: 'synchronizer', label: 'sync', to: `participant:${topology.participants[1]?.name ?? 'participant2'}`, tone: 'fail'},
    ]))

    const localnetMap = await controller.getMap({profileName: 'splice-localnet'})
    expect(localnetMap).toEqual(expect.objectContaining({
      autoPoll: true,
      mode: 'splice-localnet',
      profile: {kind: 'splice-localnet', name: 'splice-localnet'},
      summary: expect.objectContaining({
        detail: 'Workspace /workspace.',
        headline: 'Mapped surfaces healthy',
      }),
    }))
    expect(localnetMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        badges: ['sv'],
        id: 'workspace',
        kind: 'workspace',
        status: 'configured',
        tone: 'info',
        url: '/workspace',
      }),
      expect.objectContaining({id: 'localnet', label: 'LocalNet', status: 'healthy', tone: 'pass'}),
      expect.objectContaining({id: 'tokenStandard', label: 'Token Standard', status: 'configured', tone: 'info'}),
      expect.objectContaining({id: 'validator', status: 'configured', tone: 'info'}),
    ]))
    expect(localnetMap.edges).toEqual(expect.arrayContaining([
      {from: 'profile', label: 'profile', to: 'auth', tone: 'pass'},
      {from: 'workspace', label: 'sv', to: 'validator', tone: 'info'},
      {from: 'validator', label: 'submits', to: 'ledger', tone: 'info'},
      {from: 'scan', label: 'indexes', to: 'ledger', tone: 'info'},
      {from: 'tokenStandard', label: 'reads', to: 'scan', tone: 'info'},
    ]))
    expect(localnetMap.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({source: 'compatibility', title: 'Service auth', tone: 'warn'}),
      expect.objectContaining({source: 'compatibility', title: 'Service validator', tone: 'warn'}),
      expect.objectContaining({source: 'compatibility', title: 'Service localnet', tone: 'warn'}),
    ]))

    const brokenLocalnetMap = await controller.getMap({profileName: 'broken-localnet'})
    expect(brokenLocalnetMap).toEqual(expect.objectContaining({
      autoPoll: true,
      mode: 'splice-localnet',
      summary: expect.objectContaining({
        detail: 'Workspace /broken-workspace.',
      }),
    }))
    expect(brokenLocalnetMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'workspace',
        status: 'imported',
        tone: 'warn',
        url: '/broken-workspace',
      }),
      expect.objectContaining({
        id: 'auth',
        kind: 'auth',
        status: 'fallback',
        tone: 'warn',
      }),
      expect.objectContaining({
        detail: 'LocalNet down',
        id: 'localnet',
        label: 'LocalNet',
        status: 'unreachable',
        tone: 'fail',
      }),
    ]))

    const remoteMap = await controller.getMap({profileName: 'splice-devnet'})
    expect(remoteMap).toEqual(expect.objectContaining({
      autoPoll: false,
      mode: 'remote',
      profile: {kind: 'remote-validator', name: 'splice-devnet'},
      summary: {
        detail: 'Remote service graph on devnet.',
        headline: 'Mapped surfaces healthy',
        readiness: {failed: 0, passed: 2, skipped: 1, success: true, warned: 0},
      },
    }))
    expect(remoteMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'auth',
        kind: 'auth',
        badges: ['env-or-keychain-jwt'],
        status: 'auth-required',
        tone: 'warn',
      }),
      expect.objectContaining({
        id: 'validator',
        kind: 'service',
        status: 'unreachable',
        tone: 'fail',
      }),
    ]))
    expect(remoteMap.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'No stored credential found.',
        nodeIds: ['auth'],
        source: 'auth',
        title: 'Auth posture',
        tone: 'fail',
      }),
      expect.objectContaining({
        detail: 'No credential is currently resolved for this profile.',
        nodeIds: ['auth'],
        source: 'auth',
        title: 'Credential required',
        tone: 'fail',
      }),
      expect.objectContaining({source: 'compatibility', title: 'Service auth', tone: 'warn'}),
      expect.objectContaining({source: 'compatibility', title: 'Service validator', tone: 'warn'}),
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

  it('normalizes non-Error LocalNet failures in the profile status snapshot', async () => {
    const config = createConfig()
    config['default-profile'] = 'broken-localnet'
    config.profiles = {
      'broken-localnet': config.profiles?.['broken-localnet'] as NormalizedProfile,
    }

    const controller = createUiController({
      createLedgerClient: vi.fn(() => ({
        getParties: vi.fn(async () => ({partyDetails: []})),
        getVersion: vi.fn(async () => ({version: '3.4.11'})),
      }) as never),
      createLocalnet: vi.fn(() => ({
        down: vi.fn(async () => ({target: 'stop', workspace: {root: '/broken-workspace'} as never})),
        status: vi.fn(async () => {
          throw 'LocalNet string failure'
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
            ledger: {url: 'http://canton.localhost:4100/v2'},
            validator: {url: 'http://wallet.localhost:4100/api/validator'},
            wallet: {url: 'http://wallet.localhost:4100'},
          },
          workspace: {root: '/broken-workspace'} as never,
        }) as never),
      })),
      createProcessRunner: vi.fn(() => ({} as never)),
      createProfileRuntimeResolver: vi.fn(() => ({
        resolve: vi.fn(async () => ({
          auth: {
            description: 'LocalNet fallback',
            envVarName: 'CANTONCTL_JWT_LOCALNET',
            experimental: false,
            mode: 'bearer-token',
            network: 'broken-localnet',
            profileKind: 'splice-localnet',
            profileName: 'broken-localnet',
            requiresExplicitExperimental: false,
            warnings: [],
          },
          compatibility: {
            checks: [],
            failed: 0,
            passed: 1,
            profile: {experimental: false, kind: 'splice-localnet', name: 'broken-localnet'},
            services: [],
            warned: 0,
          },
          credential: {mode: 'bearer-token', network: 'broken-localnet', source: 'fallback', token: 'localnet-token'},
          networkName: 'broken-localnet',
          profile: config.profiles?.['broken-localnet'],
          profileContext: {} as never,
        }) as never),
      })),
      cwd: '/repo',
      findConfigPath: vi.fn(() => '/repo/cantonctl.yaml'),
      loadConfig: vi.fn(async () => config),
    })

    const profiles = await controller.getProfiles({profileName: 'broken-localnet'})
    expect(profiles.selected.services).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'LocalNet string failure',
        name: 'localnet',
        status: 'unreachable',
        tone: 'fail',
      }),
    ]))
  })

  it('covers default-argument and fallback branches for sandbox and localnet runtime views', async () => {
    const config = createConfig()
    config['default-profile'] = 'sandbox'
    config.networkProfiles = undefined
    config.parties = undefined
    config.profiles = {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          auth: {kind: 'shared-secret'},
          ledger: {},
        },
      },
      'splice-localnet': {
        experimental: false,
        kind: 'splice-localnet',
        name: 'splice-localnet',
        services: {
          ledger: {url: 'http://canton.localhost:4000/v2'},
          localnet: {
            distribution: 'splice-localnet',
            workspace: '/workspace-no-source',
          },
          validator: {url: 'http://wallet.localhost:4000/api/validator'},
        },
      },
    }

    const createRuntimeResolver = vi.fn(() => ({
      resolve: vi.fn(async ({config: loadedConfig, profileName}: {config: CantonctlConfig; profileName?: string}) => {
        const resolvedProfile = loadedConfig.profiles?.[profileName ?? loadedConfig['default-profile'] ?? 'sandbox']
        if (!resolvedProfile) {
          throw new Error('Expected profile to exist')
        }

        const networkName = resolvedProfile.name === 'splice-localnet' ? 'localnet' : 'local'

        return {
          auth: {
            description: 'Fallback auth',
            envVarName: networkName === 'localnet' ? 'CANTONCTL_JWT_LOCALNET' : 'CANTONCTL_JWT_LOCAL',
            experimental: false,
            mode: 'bearer-token' as const,
            network: networkName,
            profileKind: resolvedProfile.kind,
            profileName: resolvedProfile.name,
            requiresExplicitExperimental: false,
            warnings: [],
          },
          compatibility: {checks: [], failed: 0, passed: 1, profile: resolvedProfile, services: [], warned: 0},
          credential: {mode: 'bearer-token' as const, network: networkName, source: 'fallback', token: `${networkName}-token`},
          networkName,
          profile: resolvedProfile,
          profileContext: {} as never,
        } as never
      }),
    }))

    const createReadinessRunner = vi.fn(() => ({
      run: vi.fn(async ({config: loadedConfig, profileName}: {config: CantonctlConfig; profileName?: string}) => {
        const resolvedProfile = loadedConfig.profiles?.[profileName ?? loadedConfig['default-profile'] ?? 'sandbox']
        if (!resolvedProfile) {
          throw new Error('Expected readiness profile to exist')
        }

        return {
          auth: {
            credentialSource: 'fallback',
            envVarName: 'CANTONCTL_JWT_LOCAL',
            mode: 'bearer-token',
            warnings: [],
          },
          canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
          compatibility: {failed: 0, passed: 1, warned: 0},
          preflight: {
            auth: {
              credentialSource: 'fallback',
              envVarName: 'CANTONCTL_JWT_LOCAL',
              mode: 'bearer-token',
              warnings: [],
            },
            checks: [],
            compatibility: {failed: 0, passed: 1, warned: 0},
            network: {checklist: [], name: 'local', reminders: [], resetExpectation: 'local-only', tier: 'local'},
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
          summary: {failed: 0, passed: 1, skipped: 0, warned: 0},
        } as never
      }),
    }))

    const controller = createUiController({
      createDoctor: vi.fn(() => ({
        check: vi.fn(async () => ({
          checks: [],
          failed: 0,
          passed: 1,
          warned: 0,
        }) as never),
      })),
      createLedgerClient: vi.fn(({baseUrl}: {baseUrl: string}) => ({
        getParties: vi.fn(async () => ({partyDetails: []})),
        getVersion: vi.fn(async () => {
          if (baseUrl === 'http://localhost:7575') {
            throw new Error('ledger unreachable')
          }

          return {version: undefined}
        }),
      }) as never),
      createLocalnet: vi.fn(() => ({
        down: vi.fn(async () => ({target: 'stop', workspace: {root: '/workspace-no-source'} as never})),
        status: vi.fn(async () => ({
          containers: [],
          health: {
            validatorReadyz: {
              body: 'down',
              healthy: false,
              status: 0,
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
          workspace: {root: '/workspace-no-source'} as never,
        }) as never),
        up: vi.fn(async () => ({
          containers: [],
          health: {
            validatorReadyz: {
              body: 'down',
              healthy: false,
              status: 0,
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
          workspace: {root: '/workspace-no-source'} as never,
        }) as never),
      })),
      createProcessRunner: vi.fn(() => ({} as never)),
      createProfileRuntimeResolver: createRuntimeResolver,
      createReadinessRunner,
      cwd: '/repo',
      findConfigPath: vi.fn(() => '/repo/cantonctl.yaml'),
      loadConfig: vi.fn(async () => config),
    })

    const session = await controller.getSession()
    expect(session.selectedProfile).toBe('sandbox')

    const overview = await controller.getOverview()
    expect(overview).toEqual(expect.objectContaining({
      profile: {kind: 'sandbox', name: 'sandbox'},
      readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
    }))

    const checks = await controller.getChecks()
    expect(checks.profile).toEqual({kind: 'sandbox', name: 'sandbox'})

    const profiles = await controller.getProfiles()
    expect(profiles.selected.networkMappings).toEqual([])
    expect(profiles.selected.imports.localnet).toBeUndefined()
    expect(profiles.selected.imports.scan).toBeUndefined()
    expect(profiles.selected.services).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'ledger', status: 'unreachable', tone: 'fail'}),
    ]))

    const support = await controller.getSupport()
    expect(support).toEqual({
      defaults: {
        diagnosticsOutputDir: path.join('/repo', '.cantonctl', 'diagnostics', 'sandbox'),
        exportTargets: ['dapp-sdk', 'wallet-sdk', 'dapp-api'],
        scanUrl: undefined,
      },
      profile: {kind: 'sandbox', name: 'sandbox'},
    })

    const sandboxRuntime = await controller.getRuntime()
    expect(sandboxRuntime).toEqual({
      autoPoll: true,
      mode: 'sandbox',
      profile: {kind: 'sandbox', name: 'sandbox'},
      summary: {
        healthDetail: 'Ledger unreachable.',
        jsonApiPort: undefined,
        ledgerUrl: 'http://localhost:7575',
        partyCount: 0,
        version: undefined,
      },
    })

    const sandboxMap = await controller.getMap()
    expect(sandboxMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'Ledger unreachable.',
        id: 'ledger',
        status: 'unreachable',
        tone: 'fail',
      }),
    ]))

    const localnetRuntime = await controller.getRuntime({profileName: 'splice-localnet'})
    expect(localnetRuntime).toEqual({
      autoPoll: true,
      mode: 'splice-localnet',
      profile: {kind: 'splice-localnet', name: 'splice-localnet'},
      serviceMap: {
        edges: [
          {from: 'workspace', label: 'sv', to: 'ledger'},
          {from: 'workspace', label: 'sv', to: 'validator'},
          {from: 'workspace', label: 'sv', to: 'wallet'},
        ],
        nodes: [
          {
            detail: '/workspace-no-source',
            id: 'workspace',
            kind: 'workspace',
            label: 'LocalNet Workspace',
            status: 'configured',
            tone: 'info',
            url: '/workspace-no-source',
          },
          {
            id: 'ledger',
            kind: 'service',
            label: 'Ledger',
            status: 'configured',
            tone: 'info',
            url: 'http://canton.localhost:4000/v2',
          },
          {
            id: 'validator',
            kind: 'service',
            label: 'Validator',
            status: 'unreachable',
            tone: 'fail',
            url: 'http://wallet.localhost:4000/api/validator',
          },
          {
            id: 'wallet',
            kind: 'service',
            label: 'Wallet',
            status: 'configured',
            tone: 'info',
            url: 'http://wallet.localhost:4000',
          },
        ],
      },
      summary: {
        healthDetail: 'Validator readyz error.',
        ledgerUrl: 'http://canton.localhost:4000/v2',
        workspace: '/workspace-no-source',
      },
    })
  })

  it('covers topology fallback rendering for manifest-less graphs and anonymous party labels', async () => {
    const config = createConfig()
    config['default-profile'] = 'canton-multi'
    config.profiles = {
      'canton-multi': config.profiles?.['canton-multi'] as NormalizedProfile,
    }

    const topology = generateTopology({
      cantonImage: 'ghcr.io/example/canton:0.5.3',
      config,
      projectName: config.project.name,
    })

    const controller = createUiController({
      createLedgerClient: vi.fn(() => ({
        getParties: vi.fn(async () => ({partyDetails: [{}]})),
        getVersion: vi.fn(async () => ({version: undefined})),
      }) as never),
      cwd: '/repo',
      detectTopology: vi.fn(async () => ({
        ...topology,
        manifest: undefined,
      })),
      findConfigPath: vi.fn(() => '/repo/cantonctl.yaml'),
      loadConfig: vi.fn(async () => config),
    })

    const runtime = await controller.getRuntime({profileName: 'canton-multi'})
    expect(runtime.mode).toBe('canton-multi')
    expect(runtime.topology).toEqual({
      exportJson: expect.stringContaining('"participants"'),
      participants: topology.participants.map(participant => ({
        healthy: true,
        name: participant.name,
        parties: ['party'],
        ports: participant.ports,
        version: '',
      })),
      synchronizer: topology.synchronizer,
      topologyName: 'default',
    })
  })

  it('covers remaining map branches for warn-only readiness, inserted auth nodes, unimported localnet, and canary-linked participants', async () => {
    const config: CantonctlConfig = {
      'default-profile': 'warn-sandbox',
      networks: {
        local: {type: 'docker'},
        remote: {type: 'remote', url: 'https://ledger-only.example.com'},
      },
      parties: [{name: 'Operator'}],
      profiles: {
        'canton-multi': {
          experimental: false,
          kind: 'canton-multi',
          name: 'canton-multi',
          services: {
            auth: {kind: 'shared-secret'},
            ledger: {url: 'http://localhost:12013'},
            localnet: {'base-port': 12000, distribution: 'canton-multi'},
          },
        },
        'remote-missing': {
          experimental: false,
          kind: 'remote-validator',
          name: 'remote-missing',
          services: {
            ledger: {url: 'https://missing-ledger.example.com'},
          },
        },
        'remote-plain': {
          experimental: false,
          kind: 'remote-sv-network',
          name: 'remote-plain',
          services: {
            ledger: {url: 'https://ledger-only.example.com'},
          },
        },
        'party-fallback-sandbox': {
          experimental: false,
          kind: 'sandbox',
          name: 'party-fallback-sandbox',
          services: {
            auth: {kind: 'shared-secret'},
            ledger: {url: 'http://localhost:5200'},
          },
        },
        'unimported-localnet': {
          experimental: false,
          kind: 'splice-localnet',
          name: 'unimported-localnet',
          services: {
            ledger: {url: 'http://canton.localhost:5000/v2'},
            localnet: {distribution: 'splice-localnet'},
            validator: {url: 'http://wallet.localhost:5000/api/validator'},
          },
        },
        'workspace-fallback': {
          experimental: false,
          kind: 'splice-localnet',
          name: 'workspace-fallback',
          services: {
            ledger: {url: 'http://canton.localhost:5100/v2'},
            localnet: {
              distribution: 'splice-localnet',
              workspace: '/workspace-fallback',
            },
          },
        },
        'warn-sandbox': {
          experimental: true,
          kind: 'sandbox',
          name: 'warn-sandbox',
          services: {
            auth: {kind: 'shared-secret'},
            ledger: {url: 'https://sandbox.example.com'},
          },
        },
      },
      project: {name: 'map-branches', 'sdk-version': '1.0.0'},
      version: 1,
    }

    const topology = generateTopology({
      cantonImage: 'ghcr.io/example/canton:0.5.3',
      config,
      projectName: config.project.name,
    })
    const participantA = topology.participants[0]?.name ?? 'participant1'
    const participantB = topology.participants[1]?.name ?? 'participant2'

    const createRuntimeResolver = vi.fn(() => ({
      resolve: vi.fn(async ({config: loadedConfig, profileName}: {config: CantonctlConfig; profileName?: string}) => {
        const resolvedProfile = loadedConfig.profiles?.[profileName ?? loadedConfig['default-profile'] ?? 'warn-sandbox']
        if (!resolvedProfile) {
          throw new Error('Expected profile to exist')
        }

        const runtimeByProfile: Record<string, {
          credentialSource: 'fallback' | 'missing' | 'stored'
          mode: 'bearer-token' | 'env-or-keychain-jwt'
          networkName: string
          warnings: string[]
        }> = {
          'canton-multi': {
            credentialSource: 'fallback',
            mode: 'bearer-token',
            networkName: 'local',
            warnings: [],
          },
          'remote-missing': {
            credentialSource: 'missing',
            mode: 'env-or-keychain-jwt',
            networkName: 'remote',
            warnings: [],
          },
          'remote-plain': {
            credentialSource: 'stored',
            mode: 'env-or-keychain-jwt',
            networkName: 'remote',
            warnings: [],
          },
          'party-fallback-sandbox': {
            credentialSource: 'fallback',
            mode: 'bearer-token',
            networkName: 'local',
            warnings: [],
          },
          'unimported-localnet': {
            credentialSource: 'fallback',
            mode: 'bearer-token',
            networkName: 'localnet',
            warnings: [],
          },
          'workspace-fallback': {
            credentialSource: 'fallback',
            mode: 'bearer-token',
            networkName: 'localnet',
            warnings: [],
          },
          'warn-sandbox': {
            credentialSource: 'fallback',
            mode: 'bearer-token',
            networkName: 'local',
            warnings: [],
          },
        }

        const runtime = runtimeByProfile[resolvedProfile.name]
        return {
          auth: {
            description: 'Map branch auth profile',
            envVarName: `CANTONCTL_JWT_${runtime.networkName.toUpperCase()}`,
            experimental: false,
            mode: runtime.mode,
            network: runtime.networkName,
            profileKind: resolvedProfile.kind,
            profileName: resolvedProfile.name,
            requiresExplicitExperimental: false,
            warnings: runtime.warnings,
          },
          compatibility: {
            checks: [],
            failed: 0,
            passed: 1,
            profile: {
              experimental: resolvedProfile.experimental,
              kind: resolvedProfile.kind,
              name: resolvedProfile.name,
            },
            services: [],
            warned: 0,
          },
          credential: {
            mode: runtime.mode,
            network: runtime.networkName,
            source: runtime.credentialSource,
            token: runtime.credentialSource === 'missing' ? undefined : `${resolvedProfile.name}-token`,
          },
          networkName: runtime.networkName,
          profile: resolvedProfile,
          profileContext: {} as never,
        }
      }),
    }))

    const createReadinessRunner = vi.fn(() => ({
      run: vi.fn(async ({config: loadedConfig, profileName}: {config: CantonctlConfig; profileName?: string}) => {
        const resolvedProfile = loadedConfig.profiles?.[profileName ?? loadedConfig['default-profile'] ?? 'warn-sandbox']
        if (!resolvedProfile) {
          throw new Error('Expected readiness profile to exist')
        }

        if (resolvedProfile.name === 'warn-sandbox') {
          return {
            auth: {
              credentialSource: 'fallback',
              envVarName: 'CANTONCTL_JWT_LOCAL',
              mode: 'bearer-token',
              warnings: [],
            },
            canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
            compatibility: {failed: 0, passed: 1, warned: 0},
            preflight: {
              auth: {
                credentialSource: 'fallback',
                envVarName: 'CANTONCTL_JWT_LOCAL',
                mode: 'bearer-token',
                warnings: [],
              },
              checks: [{
                category: 'service',
                detail: 'Ledger still verifying.',
                endpoint: 'https://sandbox.example.com',
                name: 'Ledger',
                status: 'warn',
              }, {
                category: 'service',
                detail: 'Workspace import is still pending.',
                endpoint: undefined,
                name: 'Workspace',
                status: 'warn',
              }],
              compatibility: {failed: 0, passed: 1, warned: 0},
              network: {
                checklist: [],
                name: 'local',
                reminders: [],
                resetExpectation: 'local-only',
                tier: 'local',
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
            success: false,
            summary: {failed: 0, passed: 1, skipped: 0, warned: 2},
          } as never
        }

        if (resolvedProfile.name === 'party-fallback-sandbox') {
          return {
            auth: {
              credentialSource: 'fallback',
              envVarName: 'CANTONCTL_JWT_LOCAL',
              mode: 'bearer-token',
              warnings: [],
            },
            canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
            compatibility: {failed: 0, passed: 1, warned: 0},
            preflight: {
              auth: {
                credentialSource: 'fallback',
                envVarName: 'CANTONCTL_JWT_LOCAL',
                mode: 'bearer-token',
                warnings: [],
              },
              checks: [],
              compatibility: {failed: 0, passed: 1, warned: 0},
              network: {
                checklist: [],
                name: 'local',
                reminders: [],
                resetExpectation: 'local-only',
                tier: 'local',
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
            summary: {failed: 0, passed: 1, skipped: 0, warned: 0},
          } as never
        }

        if (resolvedProfile.name === 'unimported-localnet') {
          return {
            auth: {
              credentialSource: 'fallback',
              envVarName: 'CANTONCTL_JWT_LOCALNET',
              mode: 'bearer-token',
              warnings: [],
            },
            canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
            compatibility: {failed: 0, passed: 1, warned: 0},
            preflight: {
              auth: {
                credentialSource: 'fallback',
                envVarName: 'CANTONCTL_JWT_LOCALNET',
                mode: 'bearer-token',
                warnings: [],
              },
              checks: [{
                category: 'service',
                detail: 'LocalNet workspace has not been imported yet.',
                endpoint: undefined,
                name: 'LocalNet',
                status: 'warn',
              }],
              compatibility: {failed: 0, passed: 1, warned: 0},
              network: {
                checklist: [],
                name: 'localnet',
                reminders: [],
                resetExpectation: 'local-only',
                tier: 'local',
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
            summary: {failed: 0, passed: 1, skipped: 0, warned: 1},
          } as never
        }

        if (resolvedProfile.name === 'canton-multi') {
          return {
            auth: {
              credentialSource: 'fallback',
              envVarName: 'CANTONCTL_JWT_LOCAL',
              mode: 'bearer-token',
              warnings: [],
            },
            canary: {
              checks: [{
                detail: `${participantA} ledger latency high.`,
                status: 'fail',
                suite: 'participant-latency',
                warnings: [`${participantB} is waiting on domain sequencing.`],
              }],
              selectedSuites: ['participant-latency'],
              skippedSuites: [],
              success: false,
            },
            compatibility: {failed: 0, passed: 1, warned: 0},
            preflight: {
              auth: {
                credentialSource: 'fallback',
                envVarName: 'CANTONCTL_JWT_LOCAL',
                mode: 'bearer-token',
                warnings: [],
              },
              checks: [],
              compatibility: {failed: 0, passed: 1, warned: 0},
              network: {
                checklist: [],
                name: 'local',
                reminders: [],
                resetExpectation: 'local-only',
                tier: 'local',
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
            success: false,
            summary: {failed: 2, passed: 0, skipped: 0, warned: 1},
          } as never
        }

        return {
          auth: {
            credentialSource: resolvedProfile.name === 'remote-missing' ? 'missing' : 'stored',
            envVarName: 'CANTONCTL_JWT_REMOTE',
            mode: 'env-or-keychain-jwt',
            warnings: [],
          },
          canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
          compatibility: {failed: 0, passed: 1, warned: 0},
          preflight: {
            auth: {
              credentialSource: resolvedProfile.name === 'remote-missing' ? 'missing' : 'stored',
              envVarName: 'CANTONCTL_JWT_REMOTE',
              mode: 'env-or-keychain-jwt',
              warnings: [],
            },
            checks: [],
            compatibility: {failed: 0, passed: 1, warned: 0},
            network: {
              checklist: [],
              name: resolvedProfile.name,
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
          summary: {failed: 0, passed: 1, skipped: 0, warned: 0},
        } as never
      }),
    }))

    const controller = createUiController({
      createDiagnosticsCollector: vi.fn(() => ({
        collect: vi.fn(async ({config: loadedConfig, profileName}: {config: CantonctlConfig; profileName?: string}) => {
          const resolvedProfile = loadedConfig.profiles?.[profileName ?? 'remote-plain']
          if (!resolvedProfile) {
            throw new Error('Expected diagnostics profile to exist')
          }

          return {
            auth: {
              envVarName: 'CANTONCTL_JWT_REMOTE',
              mode: 'env-or-keychain-jwt',
              source: resolvedProfile.name === 'remote-missing' ? 'missing' : 'stored',
            },
            compatibility: {failed: 0, passed: 1, warned: 0},
            health: [],
            metrics: [],
            profile: {
              experimental: resolvedProfile.experimental,
              kind: resolvedProfile.kind,
              name: resolvedProfile.name,
              network: 'remote',
            },
            services: [],
          } as never
        }),
      })),
      createDoctor: vi.fn(() => ({
        check: vi.fn(async () => ({
          checks: [],
          failed: 0,
          passed: 1,
          warned: 0,
        }) as never),
      })),
      createLedgerClient: vi.fn(({baseUrl}: {baseUrl: string}) => ({
        getParties: vi.fn(async () => (
          baseUrl === 'http://localhost:5200'
            ? {partyDetails: [{identifier: 'ops-party'}, {}]}
            : {partyDetails: []}
        )),
        getVersion: vi.fn(async () => (
          baseUrl === 'http://canton.localhost:5000/v2' || baseUrl === 'http://localhost:5200'
            ? {version: undefined}
            : {version: '3.4.11'}
        )),
      }) as never),
      createLocalnet: vi.fn(() => ({
        down: vi.fn(async () => ({target: 'stop', workspace: {root: '/unused'} as never})),
        status: vi.fn(async ({workspace}: {workspace: string}) => {
          if (workspace === '/workspace-fallback') {
            return {
              containers: [],
              health: {
                validatorReadyz: {
                  body: 'ok',
                  healthy: true,
                  status: 200,
                  url: 'http://127.0.0.1:5903/api/validator/readyz',
                },
              },
              profiles: {} as never,
              selectedProfile: 'sv' as never,
              services: {
                ledger: {url: 'http://canton.localhost:5100/v2'},
                validator: {url: 'http://wallet.localhost:5100/api/validator'},
                wallet: {url: 'http://wallet.localhost:5100'},
              },
              workspace: {root: workspace} as never,
            } as never
          }

          throw new Error('LocalNet status should not be requested without a workspace')
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
            ledger: {url: 'http://canton.localhost:5000/v2'},
            validator: {url: 'http://wallet.localhost:5000/api/validator'},
            wallet: {url: 'http://wallet.localhost:5000'},
          },
          workspace: {root: '/unused'} as never,
        }) as never),
      })),
      createProcessRunner: vi.fn(() => ({} as never)),
      createProfileRuntimeResolver: createRuntimeResolver,
      createReadinessRunner,
      cwd: '/repo',
      detectTopology: vi.fn(async () => topology),
      findConfigPath: vi.fn(() => '/repo/cantonctl.yaml'),
      loadConfig: vi.fn(async () => config),
    })

    const warnSandboxMap = await controller.getMap({profileName: 'warn-sandbox'})
    expect(warnSandboxMap).toEqual(expect.objectContaining({
      mode: 'sandbox',
      summary: {
        detail: 'Sandbox profile on local; 0 visible parties.',
        headline: '2 advisory findings',
        readiness: {failed: 0, passed: 1, skipped: 0, success: false, warned: 2},
      },
    }))
    expect(warnSandboxMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'Experimental profile.',
        id: 'profile',
        status: 'advisory',
        tone: 'warn',
      }),
      expect.objectContaining({
        detail: 'Credential source: fallback.',
        id: 'auth',
        status: 'fallback',
        tone: 'pass',
      }),
      expect.objectContaining({
        detail: 'Ledger configured.',
        id: 'ledger',
        ports: {},
        status: 'configured',
        tone: 'info',
        url: 'https://sandbox.example.com',
      }),
    ]))
    expect(warnSandboxMap.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'compatibility',
        title: 'Project SDK',
        tone: 'fail',
      }),
      expect.objectContaining({
        detail: 'Ledger still verifying.',
        nodeIds: ['ledger'],
        source: 'preflight',
        title: 'Ledger',
        tone: 'warn',
      }),
      expect.objectContaining({
        detail: 'Workspace import is still pending.',
        nodeIds: ['profile'],
        source: 'preflight',
        title: 'Workspace',
        tone: 'warn',
      }),
    ]))

    const unimportedLocalnetMap = await controller.getMap({profileName: 'unimported-localnet'})
    expect(unimportedLocalnetMap).toEqual(expect.objectContaining({
      mode: 'splice-localnet',
      summary: {
        detail: 'Import a LocalNet workspace to populate the service map.',
        headline: '1 advisory finding',
        readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 1},
      },
    }))
    expect(unimportedLocalnetMap.nodes.some(node => node.id === 'workspace')).toBe(false)
    expect(unimportedLocalnetMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'Credential source: fallback.',
        id: 'auth',
        kind: 'auth',
        status: 'fallback',
        tone: 'pass',
      }),
      expect.objectContaining({id: 'validator', status: 'configured', tone: 'info'}),
      expect.objectContaining({id: 'localnet', label: 'LocalNet', status: 'configured', tone: 'info'}),
    ]))
    expect(unimportedLocalnetMap.edges).toEqual(expect.arrayContaining([
      {from: 'profile', label: 'profile', to: 'auth', tone: 'warn'},
      {from: 'validator', label: 'submits', to: 'ledger', tone: 'info'},
    ]))
    expect(unimportedLocalnetMap.edges.some(edge => edge.from === 'workspace')).toBe(false)
    expect(unimportedLocalnetMap.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'LocalNet workspace has not been imported yet.',
        nodeIds: ['profile'],
        source: 'preflight',
        title: 'LocalNet',
        tone: 'warn',
      }),
    ]))

    const workspaceFallbackMap = await controller.getMap({profileName: 'workspace-fallback'})
    expect(workspaceFallbackMap).toEqual(expect.objectContaining({
      mode: 'splice-localnet',
      summary: expect.objectContaining({
        detail: 'Workspace /workspace-fallback.',
      }),
    }))
    expect(workspaceFallbackMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        badges: ['sv'],
        id: 'workspace',
        status: 'configured',
        tone: 'info',
      }),
    ]))
    expect(workspaceFallbackMap.edges).toEqual(expect.arrayContaining([
      {from: 'workspace', label: 'sv', to: 'ledger', tone: 'pass'},
    ]))
    expect(workspaceFallbackMap.edges.some(edge => edge.from === 'validator' && edge.to === 'ledger')).toBe(false)

    const remotePlainMap = await controller.getMap({profileName: 'remote-plain'})
    expect(remotePlainMap).toEqual(expect.objectContaining({
      autoPoll: false,
      mode: 'remote',
      summary: {
        detail: 'Remote service graph on remote.',
        headline: 'Mapped surfaces healthy',
        readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
      },
    }))
    expect(remotePlainMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        badges: ['env-or-keychain-jwt', 'stored'],
        detail: 'Credential source: stored.',
        id: 'auth',
        kind: 'auth',
        status: 'configured',
        tone: 'pass',
      }),
      expect.objectContaining({id: 'ledger', label: 'ledger', status: 'configured', tone: 'info'}),
    ]))
    expect(remotePlainMap.edges).toEqual([
      {from: 'profile', label: 'profile', to: 'auth', tone: 'pass'},
    ])

    const remoteMissingMap = await controller.getMap({profileName: 'remote-missing'})
    expect(remoteMissingMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        badges: ['env-or-keychain-jwt', 'missing'],
        detail: 'Credential source: missing.',
        id: 'auth',
        kind: 'auth',
        status: 'missing',
        tone: 'fail',
      }),
    ]))
    expect(remoteMissingMap.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: 'No credential is currently resolved for this profile.',
        nodeIds: ['auth'],
        source: 'auth',
        title: 'Credential required',
        tone: 'fail',
      }),
    ]))

    const partyFallbackMap = await controller.getMap({profileName: 'party-fallback-sandbox'})
    expect(partyFallbackMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ledger',
        parties: ['ops-party', 'party'],
        status: 'healthy',
        tone: 'pass',
      }),
    ]))

    const topologyMap = await controller.getMap({profileName: 'canton-multi'})
    expect(topologyMap.summary).toEqual(expect.objectContaining({
      headline: '2 blocking issues',
    }))
    expect(topologyMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'synchronizer', status: 'healthy', tone: 'pass'}),
      expect.objectContaining({id: `participant:${participantA}`, status: 'healthy', tone: 'pass'}),
      expect.objectContaining({id: `participant:${participantB}`, status: 'healthy', tone: 'pass'}),
    ]))
    expect(topologyMap.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        detail: `${participantA} ledger latency high.`,
        nodeIds: expect.arrayContaining([`participant:${participantA}`]),
        source: 'canary',
        title: 'participant-latency',
        tone: 'fail',
      }),
      expect.objectContaining({
        detail: `${participantB} is waiting on domain sequencing.`,
        nodeIds: expect.arrayContaining([`participant:${participantB}`, 'synchronizer']),
        source: 'canary',
        title: 'participant-latency',
        tone: 'warn',
      }),
    ]))
    expect((topologyMap.nodes.find(node => node.id === `participant:${participantA}`)?.findingIds ?? []).length).toBeGreaterThan(0)
    expect((topologyMap.nodes.find(node => node.id === `participant:${participantB}`)?.findingIds ?? []).length).toBeGreaterThan(0)
  })

  it('uses the default config, runtime, readiness, and diagnostics factories against a real project config', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-defaults-'))
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url === 'https://api.ipify.org?format=json') {
        return {
          json: async () => ({ip: '203.0.113.10'}),
          ok: true,
          status: 200,
          text: async () => '{"ip":"203.0.113.10"}',
        }
      }

      if (url.startsWith('https://remote-auth.example.com/')) {
        return {
          json: async () => ({}),
          ok: !url.endsWith('/metrics'),
          status: url.endsWith('/metrics') ? 404 : 200,
          text: async () => 'ok',
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    await fs.writeFile(path.join(workspace, 'cantonctl.yaml'), [
      'version: 1',
      'project:',
      '  name: demo',
      '  sdk-version: 3.4.11',
      'default-profile: sandbox',
      'profiles:',
      '  sandbox:',
      '    kind: sandbox',
      '    ledger: {}',
      '  remote-none:',
      '    kind: remote-sv-network',
      '    auth:',
      '      kind: none',
      '      url: https://remote-auth.example.com',
      '    ledger:',
      '      url: https://remote-ledger.example.com',
      '    scan:',
      '      url: https://remote-scan.example.com',
    ].join('\n'), 'utf8')

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const controller = createUiController({
      createDoctor: vi.fn(() => ({
        check: vi.fn(async () => ({
          checks: [],
          failed: 0,
          passed: 1,
          warned: 0,
        }) as never),
      })),
      createProcessRunner: vi.fn(() => ({} as never)),
      cwd: workspace,
    })

    try {
      const session = await controller.getSession()
      expect(session.selectedProfile).toBe('sandbox')
      expect(session.profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({name: 'sandbox'}),
        expect.objectContaining({name: 'remote-none'}),
      ]))

      const checks = await controller.getChecks()
      expect(checks).toEqual(expect.objectContaining({
        auth: expect.objectContaining({authenticated: true, source: 'fallback'}),
        preflight: expect.objectContaining({
          network: expect.objectContaining({name: 'local', tier: 'local'}),
          success: true,
        }),
        profile: {kind: 'sandbox', name: 'sandbox'},
      }))

      const remoteRuntime = await controller.getRuntime({profileName: 'remote-none'})
      expect(remoteRuntime).toEqual({
        autoPoll: false,
        mode: 'remote',
        profile: {kind: 'remote-sv-network', name: 'remote-none'},
        serviceMap: {
          edges: [
            {from: 'auth', label: 'authenticates', to: 'ledger'},
            {from: 'scan', label: 'indexes', to: 'ledger'},
          ],
          nodes: [
            {
              detail: 'none',
              id: 'auth',
              kind: 'service',
              label: 'auth',
              status: 'healthy',
              tone: 'pass',
              url: 'https://remote-auth.example.com',
            },
            {
              detail: 'Ledger endpoint',
              id: 'ledger',
              kind: 'service',
              label: 'ledger',
              status: 'configured',
              tone: 'info',
              url: 'https://remote-ledger.example.com',
            },
            {
              detail: 'Scan endpoint',
              id: 'scan',
              kind: 'service',
              label: 'scan',
              status: 'unreachable',
              tone: 'fail',
              url: 'https://remote-scan.example.com',
            },
          ],
        },
      })
    } finally {
      globalThis.fetch = originalFetch
      await fs.rm(workspace, {force: true, recursive: true})
    }
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
