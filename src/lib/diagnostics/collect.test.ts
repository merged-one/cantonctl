import {describe, expect, it, vi} from 'vitest'

import type {CantonctlConfig} from '../config.js'
import type {ProfileRuntimeResolver} from '../profile-runtime.js'
import {createDiagnosticsCollector} from './collect.js'
import type {DiagnosticsAuditRecord} from './audit.js'

function createConfig(): CantonctlConfig {
  return {
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createResolver(): () => ProfileRuntimeResolver {
  return () => ({
    resolve: vi.fn().mockResolvedValue({
      auth: {
        app: {
          description: '',
          envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
          keychainAccount: 'splice-devnet',
          localFallbackAllowed: false,
          prerequisites: [],
          required: true,
          scope: 'app',
        },
        authKind: 'jwt',
        description: '',
        envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
        experimental: false,
        mode: 'env-or-keychain-jwt',
        network: 'splice-devnet',
        operator: {
          description: '',
          envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
          keychainAccount: 'operator:splice-devnet',
          localFallbackAllowed: false,
          prerequisites: [],
          required: true,
          scope: 'operator',
        },
        requiresExplicitExperimental: false,
        warnings: [],
      },
      capabilities: [],
      compatibility: {
        checks: [],
        failed: 0,
        passed: 2,
        profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'},
        services: [
          {detail: 'Scan endpoint', endpoint: 'https://scan.devnet.example.com', name: 'scan', sourceIds: [], stability: 'stable-external'},
          {detail: 'Validator endpoint', endpoint: 'https://validator.devnet.example.com', name: 'validator', sourceIds: [], stability: 'operator-only'},
        ],
        warned: 1,
      },
      credential: {
        mode: 'env-or-keychain-jwt',
        network: 'splice-devnet',
        scope: 'app',
        source: 'stored',
        token: 'jwt-token',
      },
      inventory: {
        capabilities: [],
        drift: [],
        mode: 'profile',
        profile: {
          experimental: false,
          kind: 'remote-validator',
          name: 'splice-devnet',
          resolvedFrom: 'argument',
        },
        schemaVersion: 1,
        services: [],
        summary: {
          configuredCapabilities: 0,
          configuredServices: 0,
          driftedCapabilities: 0,
          healthyCapabilities: 0,
          healthyServices: 0,
          unreachableCapabilities: 0,
          unreachableServices: 0,
          warnedCapabilities: 0,
        },
      },
      networkName: 'splice-devnet',
      operatorCredential: {
        mode: 'env-or-keychain-jwt',
        network: 'splice-devnet',
        scope: 'operator',
        source: 'stored',
        token: 'operator-token',
      },
      profile: {
        definitionSource: 'profile',
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.devnet.example.com'},
          ledger: {url: 'https://ledger.devnet.example.com'},
          scan: {url: 'https://scan.devnet.example.com'},
          validator: {url: 'https://validator.devnet.example.com'},
        },
      },
      profileContext: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.devnet.example.com'},
          ledger: {url: 'https://ledger.devnet.example.com'},
          scan: {url: 'https://scan.devnet.example.com'},
          validator: {url: 'https://validator.devnet.example.com'},
        },
      },
      services: [
        {detail: 'Auth endpoint', endpoint: 'https://auth.devnet.example.com', name: 'auth', sourceIds: [], stability: 'stable-public'},
        {detail: 'Ledger endpoint', endpoint: 'https://ledger.devnet.example.com', name: 'ledger', sourceIds: [], stability: 'config-only'},
        {detail: 'Scan endpoint', endpoint: 'https://scan.devnet.example.com', name: 'scan', sourceIds: [], stability: 'stable-public'},
        {detail: 'Validator endpoint', endpoint: 'https://validator.devnet.example.com', name: 'validator', sourceIds: [], stability: 'operator-only'},
      ],
    }),
  })
}

describe('diagnostics collector', () => {
  it('collects profile, inventory, drift, auth, and validator liveness summaries', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', {status: 404}))
      .mockResolvedValueOnce(new Response('', {status: 404}))
      .mockResolvedValueOnce(new Response('', {status: 404}))
      .mockResolvedValueOnce(new Response('', {status: 404}))
      .mockResolvedValueOnce(new Response('', {status: 200}))
      .mockResolvedValueOnce(new Response('', {status: 404}))
      .mockResolvedValueOnce(new Response('', {status: 404}))
      .mockResolvedValueOnce(new Response('', {status: 404}))
      .mockResolvedValueOnce(new Response('', {status: 200}))
    const lastOperation: DiagnosticsAuditRecord = {
      command: 'deploy',
      context: {profile: {name: 'splice-devnet'}},
      mode: 'apply',
      recordedAt: '2026-04-06T22:00:00.000Z',
      rollout: {
        operation: 'deploy',
        partial: false,
        steps: [],
        success: true,
        summary: {blocked: 0, completed: 2, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
      },
      schemaVersion: 1,
      success: true,
    }

    const collector = createDiagnosticsCollector({
      createAuditStore: () => ({
        readLastOperation: vi.fn().mockResolvedValue(lastOperation),
        writeLastOperation: vi.fn(),
      }),
      createProfileRuntimeResolver: createResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        listValidatorLicenses: vi.fn().mockResolvedValue({
          validator_licenses: [{validator: 'validator::1'}],
        }),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch,
    })

    const snapshot = await collector.collect({
      config: createConfig(),
      profileName: 'splice-devnet',
      projectDir: '/tmp/project',
    })

    expect(snapshot.profile).toEqual(expect.objectContaining({
      definitionSource: 'profile',
      name: 'splice-devnet',
      services: expect.objectContaining({
        scan: expect.objectContaining({url: 'https://scan.devnet.example.com'}),
      }),
    }))
    expect(snapshot.auth).toEqual({
      app: {
        envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
        required: true,
        source: 'stored',
      },
      mode: 'env-or-keychain-jwt',
      operator: {
        envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
        required: true,
        source: 'stored',
      },
    })
    expect(snapshot.inventory).toEqual(expect.objectContaining({
      mode: 'profile',
      profile: expect.objectContaining({name: 'splice-devnet'}),
      schemaVersion: 1,
    }))
    expect(snapshot.drift).toEqual(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({code: 'upstream-line-mismatch', source: 'compatibility'}),
      ]),
      summary: expect.objectContaining({manualRunbooks: 1, warned: 1}),
    }))
    expect(snapshot.lastOperation).toEqual(lastOperation)
    expect(snapshot.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({service: 'scan'}),
    ]))
    expect(snapshot.health).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'scan-readyz'}),
    ]))
    expect(snapshot.validatorLiveness).toEqual({
      approvedValidatorCount: 1,
      endpoint: 'https://scan.devnet.example.com',
      sampleSize: 1,
    })
  })
})
