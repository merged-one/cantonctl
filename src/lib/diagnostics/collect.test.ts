import {describe, expect, it, vi} from 'vitest'

import {createDiagnosticsCollector} from './collect.js'
import type {ProfileRuntimeResolver} from '../profile-runtime.js'
import type {CantonctlConfig} from '../config.js'

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
        description: '',
        envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
        experimental: false,
        mode: 'env-or-keychain-jwt',
        network: 'splice-devnet',
        requiresExplicitExperimental: false,
        warnings: [],
      },
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
        source: 'stored',
        token: 'jwt-token',
      },
      networkName: 'splice-devnet',
      profile: {
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
    }),
  })
}

describe('diagnostics collector', () => {
  it('collects profile, health, metrics, and validator liveness summaries', async () => {
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

    const collector = createDiagnosticsCollector({
      createProfileRuntimeResolver: createResolver(),
      createScanAdapter: vi.fn().mockReturnValue({
        listValidatorLicenses: vi.fn().mockResolvedValue({
          validator_licenses: [{validator: 'validator::1'}],
        }),
        metadata: {baseUrl: 'https://scan.devnet.example.com'},
      }),
      fetch,
    })

    const snapshot = await collector.collect({config: createConfig(), profileName: 'splice-devnet'})
    expect(snapshot.profile).toEqual(expect.objectContaining({name: 'splice-devnet'}))
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

