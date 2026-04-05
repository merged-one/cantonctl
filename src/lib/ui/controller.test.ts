import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../config.js'
import type {DiagnosticsCollector, DiagnosticsSnapshot} from '../diagnostics/collect.js'
import type {Doctor} from '../doctor.js'
import type {Localnet, LocalnetStatusResult} from '../localnet.js'
import type {LocalnetProfileName} from '../localnet-workspace.js'
import type {ReadinessReport, ReadinessRunner} from '../readiness.js'
import type {ProfileRuntimeResolver, ResolvedProfileRuntime} from '../profile-runtime.js'
import {generateTopology} from '../topology.js'

import {createUiController} from './controller.js'

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networkProfiles: {
      devnet: 'splice-devnet',
      local: 'sandbox',
      localnet: 'splice-localnet',
    },
    networks: {
      devnet: {type: 'remote', url: 'https://ledger.example.com'},
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
      localnet: {type: 'docker', url: 'http://canton.localhost:4000/v2'},
    },
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575, url: 'http://localhost:7575'},
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {kind: 'oidc', url: 'https://auth.example.com'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          validator: {url: 'https://validator.example.com'},
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
            'source-profile': 'sv',
            version: '0.5.3',
            workspace: '/workspace',
          },
          scan: {url: 'http://scan.localhost:4000/api/scan'},
          validator: {url: 'http://wallet.localhost:4000/api/validator'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createRuntimeResolver(): ProfileRuntimeResolver {
  const resolve: ProfileRuntimeResolver['resolve'] = async ({config, profileName}) => {
    const profile = config.profiles?.[profileName ?? 'sandbox']!
    return {
      auth: {
        description: 'auth',
        envVarName: 'CANTONCTL_JWT_DEVNET',
        experimental: false,
        mode: profile.kind === 'remote-validator' ? 'env-or-keychain-jwt' : 'bearer-token',
        network: profileName === 'splice-devnet' ? 'devnet' : profileName === 'splice-localnet' ? 'localnet' : 'local',
        requiresExplicitExperimental: false,
        warnings: [],
      },
      compatibility: {
        checks: [],
        failed: 0,
        passed: 1,
        profile: {experimental: false, kind: profile.kind, name: profile.name},
        services: [],
        warned: 0,
      },
      credential: {
        mode: profile.kind === 'remote-validator' ? 'env-or-keychain-jwt' : 'bearer-token',
        network: profileName === 'splice-devnet' ? 'devnet' : 'local',
        source: profile.kind === 'remote-validator' ? 'missing' : 'fallback',
        token: profile.kind === 'remote-validator' ? undefined : 'local-token',
      },
      networkName: profileName === 'splice-devnet' ? 'devnet' : profileName === 'splice-localnet' ? 'localnet' : 'local',
      profile,
      profileContext: {profile} as never,
    } satisfies ResolvedProfileRuntime
  }

  return {
    resolve: vi.fn(resolve),
  }
}

function createReadiness(): ReadinessRunner {
  const run: ReadinessRunner['run'] = async ({config, profileName}) => {
    const profile = config.profiles?.[profileName ?? 'sandbox']!
    return {
      auth: {
        credentialSource: profile.kind === 'remote-validator' ? 'missing' : 'fallback',
        envVarName: 'JWT',
        mode: 'bearer-token',
        warnings: [],
      },
      canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
      compatibility: {failed: 0, passed: 1, warned: 0},
      preflight: {
        auth: {credentialSource: 'fallback', envVarName: 'JWT', mode: 'bearer-token', warnings: []},
        checks: [],
        compatibility: {failed: 0, passed: 1, warned: 0},
        network: {checklist: [], name: 'local', reminders: [], resetExpectation: 'local-only', tier: 'local'},
        profile: {experimental: false, kind: profile.kind, name: profile.name},
        success: true,
      },
      profile: {experimental: false, kind: profile.kind, name: profile.name},
      success: true,
      summary: {failed: 0, passed: 3, skipped: 1, warned: 0},
    } satisfies ReadinessReport
  }

  return {
    run: vi.fn(run),
  }
}

function createDoctorInstance(): Doctor {
  return {
    check: vi.fn(async () => ({
      checks: [],
      failed: 0,
      passed: 2,
      warned: 0,
    })),
  }
}

function createDiagnostics(): DiagnosticsCollector {
  const collect: DiagnosticsCollector['collect'] = async () => ({
    auth: {envVarName: 'JWT', mode: 'bearer-token', source: 'fallback'},
    compatibility: {failed: 0, passed: 1, warned: 0},
    health: [{detail: 'Healthy.', endpoint: 'https://validator.example.com/readyz', name: 'validator-readyz', status: 'healthy'}],
    metrics: [],
    profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'devnet'},
    services: [{name: 'validator', stability: 'stable-external', endpoint: 'https://validator.example.com'}],
  } satisfies DiagnosticsSnapshot)

  return {
    collect: vi.fn(collect),
  }
}

function createLocalnetClient(): Localnet {
  const createStatusResult = (
    services: LocalnetStatusResult['services'],
    profiles: LocalnetStatusResult['profiles'],
  ): LocalnetStatusResult => ({
    containers: [],
    health: {
      validatorReadyz: {
        body: 'ok',
        healthy: true,
        status: 200,
        url: 'http://127.0.0.1:4903/api/validator/readyz',
      },
    },
    profiles,
    selectedProfile: 'sv' satisfies LocalnetProfileName,
    services,
    workspace: {root: '/workspace'} as never,
  })

  return {
    down: vi.fn(async () => ({target: 'stop', workspace: {root: '/workspace'} as never})),
    status: vi.fn(async () => createStatusResult(
      {
        ledger: {url: 'http://canton.localhost:4000/v2'},
        scan: {url: 'http://scan.localhost:4000/api/scan'},
        validator: {url: 'http://wallet.localhost:4000/api/validator'},
        wallet: {url: 'http://wallet.localhost:4000'},
      },
      {
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
    )),
    up: vi.fn(async () => createStatusResult(
      {
        ledger: {url: 'http://canton.localhost:4000/v2'},
        validator: {url: 'http://wallet.localhost:4000/api/validator'},
        wallet: {url: 'http://wallet.localhost:4000'},
      },
      {} as never,
    )),
  }
}

describe('ui controller', () => {
  it('builds session summaries and respects requested profiles', async () => {
    const controller = createUiController({
      createDiagnosticsCollector: () => createDiagnostics(),
      createDoctor: () => createDoctorInstance(),
      createLocalnet: () => createLocalnetClient(),
      createProfileRuntimeResolver: () => createRuntimeResolver(),
      createReadinessRunner: () => createReadiness(),
      cwd: '/repo',
      findConfigPath: () => '/repo/cantonctl.yaml',
      loadConfig: async () => createConfig(),
    })

    const session = await controller.getSession({requestedProfile: 'splice-devnet'})
    expect(session.selectedProfile).toBe('splice-devnet')
    expect(session.storageKey).toBe('cantonctl-ui:/repo/cantonctl.yaml')
    expect(session.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'sandbox', readiness: {detail: 'Local runtime', tone: 'info'}}),
      expect.objectContaining({name: 'splice-devnet', readiness: {detail: 'Auth required', tone: 'fail'}}),
    ]))
  })

  it('renders splice-localnet runtime state and support defaults', async () => {
    const controller = createUiController({
      createDiagnosticsCollector: () => createDiagnostics(),
      createDoctor: () => createDoctorInstance(),
      createLocalnet: () => createLocalnetClient(),
      createProfileRuntimeResolver: () => createRuntimeResolver(),
      createReadinessRunner: () => createReadiness(),
      cwd: '/repo',
      detectTopology: async () => generateTopology({
        cantonImage: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
        config: createConfig(),
        projectName: 'demo',
      }),
      findConfigPath: () => '/repo/cantonctl.yaml',
      loadConfig: async () => createConfig(),
    })

    const runtime = await controller.getRuntime({profileName: 'splice-localnet'})
    expect(runtime.mode).toBe('splice-localnet')
    expect(runtime.serviceMap?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({label: 'LocalNet Workspace'}),
      expect.objectContaining({label: 'Validator', status: 'healthy'}),
    ]))

    const support = await controller.getSupport({profileName: 'splice-devnet'})
    expect(support.defaults).toEqual({
      diagnosticsOutputDir: '/repo/.cantonctl/diagnostics/splice-devnet',
      exportTargets: ['dapp-sdk', 'wallet-sdk', 'dapp-api'],
      scanUrl: 'https://scan.example.com',
    })
  })
})
