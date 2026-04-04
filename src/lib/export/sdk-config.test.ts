import {describe, expect, it, vi} from 'vitest'

import {renderSdkConfigEnv} from './formatters.js'
import {createSdkConfigExporter} from './sdk-config.js'
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
      compatibility: {checks: [], failed: 0, passed: 3, profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'}, services: [], warned: 0},
      credential: {mode: 'env-or-keychain-jwt', network: 'splice-devnet', source: 'stored', token: 'jwt-token'},
      networkName: 'splice-devnet',
      profile: {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          auth: {kind: 'jwt', url: 'https://auth.example.com'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      profileContext: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', services: {}},
    }),
  })
}

describe('sdk config export', () => {
  it('exports target-specific json and env payloads with CIP-0103 wording', async () => {
    const exporter = createSdkConfigExporter({
      createProfileRuntimeResolver: createResolver(),
    })

    const dappSdk = await exporter.exportConfig({
      config: createConfig(),
      profileName: 'splice-devnet',
      target: 'dapp-sdk',
    })
    const walletSdk = await exporter.exportConfig({
      config: createConfig(),
      profileName: 'splice-devnet',
      target: 'wallet-sdk',
    })

    expect(dappSdk.cip).toBe('CIP-0103')
    expect(dappSdk.endpoints.walletGatewayUrl).toBe('https://validator.example.com')
    expect(walletSdk.endpoints.validatorUrl).toBe('https://validator.example.com')

    const env = renderSdkConfigEnv(walletSdk)
    expect(env).toContain('CANTONCTL_CIP_STANDARD=CIP-0103')
    expect(env).toContain('SPLICE_AUTH_TOKEN_ENV=CANTONCTL_JWT_SPLICE_DEVNET')
    expect(env).toContain('SPLICE_VALIDATOR_URL=https://validator.example.com')
  })
})

