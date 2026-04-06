import {describe, expect, it} from 'vitest'

import {
  getProfileDefinitionSource,
  getServiceSourceIds,
  getServiceStability,
  summarizeProfileCapabilities,
  summarizeServiceControlPlane,
} from './control-plane.js'
import {getUpstreamSource} from './upstream/manifest.js'

describe('control-plane metadata', () => {
  it('classifies local sandbox services as managed local runtime surfaces', () => {
    const profile = {
      definitionSource: 'profiles' as const,
      experimental: false,
      kind: 'sandbox' as const,
      name: 'sandbox',
      services: {
        auth: {kind: 'shared-secret' as const},
        ledger: {'json-api-port': 7575, port: 5001},
      },
    }

    expect(getProfileDefinitionSource(profile)).toBe('profiles')
    expect(summarizeServiceControlPlane(profile, 'ledger')).toEqual({
      endpointProvenance: 'derived-local-default',
      lifecycleOwner: 'official-local-runtime',
      managementClass: 'apply-capable',
      mutationScope: 'managed',
      operatorSurface: false,
    })
    expect(summarizeServiceControlPlane(profile, 'auth')).toEqual({
      endpointProvenance: 'declared',
      lifecycleOwner: 'cantonctl',
      managementClass: 'apply-capable',
      mutationScope: 'managed',
      operatorSurface: false,
    })
  })

  it('classifies remote and legacy-backed services against the shared policy', () => {
    const profile = {
      definitionSource: 'legacy-network' as const,
      experimental: false,
      kind: 'remote-validator' as const,
      name: 'ops',
      services: {
        ledger: {url: 'https://ledger.example.com'},
        scan: {url: 'https://scan.example.com'},
        validator: {url: 'https://validator.example.com'},
      },
    }

    expect(summarizeServiceControlPlane(profile, 'ledger')).toEqual({
      endpointProvenance: 'legacy-network',
      lifecycleOwner: 'official-remote-runtime',
      managementClass: 'plan-only',
      mutationScope: 'managed',
      operatorSurface: false,
    })
    expect(summarizeServiceControlPlane(profile, 'scan')).toEqual({
      endpointProvenance: 'legacy-network',
      lifecycleOwner: 'official-remote-runtime',
      managementClass: 'read-only',
      mutationScope: 'observed',
      operatorSurface: false,
    })
    expect(summarizeServiceControlPlane(profile, 'validator')).toEqual({
      endpointProvenance: 'legacy-network',
      lifecycleOwner: 'official-remote-runtime',
      managementClass: 'plan-only',
      mutationScope: 'managed',
      operatorSurface: true,
    })
  })

  it('anchors service and SDK capability metadata to the upstream manifest', () => {
    expect(getServiceSourceIds('tokenStandard')).toEqual([
      'splice-token-metadata-openapi',
      'splice-token-allocation-openapi',
      'splice-token-allocation-instruction-openapi',
      'splice-token-transfer-instruction-openapi',
      'splice-token-metadata-daml',
      'splice-token-holding-daml',
      'splice-token-allocation-daml',
      'splice-token-allocation-instruction-daml',
      'splice-token-transfer-instruction-daml',
    ])
    expect(getServiceStability(getServiceSourceIds('scanProxy'))).toBe('experimental-internal')
    expect(getServiceStability([])).toBe('config-only')

    const capabilities = summarizeProfileCapabilities({
      definitionSource: 'profiles',
      experimental: false,
      kind: 'splice-localnet',
      name: 'splice-localnet',
      services: {
        ledger: {url: 'http://canton.localhost:4000/v2'},
        localnet: {distribution: 'splice-localnet', version: '0.5.3'},
        validator: {url: 'http://wallet.localhost:4000/api/validator'},
      },
    })

    expect(capabilities).toEqual([{
      controlPlane: {
        lifecycleOwner: 'external-sdk',
        managementClass: 'read-only',
        mutationScope: 'out-of-scope',
        operatorSurface: false,
      },
      detail:
        'Wallet-connected application integrations belong to the official dApp and Wallet SDK packages, not the control-plane command surface.',
      name: 'wallet-integration',
      sdkPackages: [
        {packageName: '@canton-network/dapp-sdk', sourceId: 'canton-network-dapp-sdk', version: '0.24.0'},
        {packageName: '@canton-network/wallet-sdk', sourceId: 'canton-network-wallet-sdk', version: '0.21.1'},
      ],
      sourceIds: ['canton-network-dapp-sdk', 'canton-network-wallet-sdk'],
      stability: 'public-sdk',
    }])
  })

  it('fails fast when SDK capability pins stop resolving to npm packages', () => {
    const dappSdkSource = getUpstreamSource('canton-network-dapp-sdk')
    const originalSource = dappSdkSource.source

    ;(dappSdkSource as unknown as {source: Record<string, unknown>}).source = {
      kind: 'git',
      path: 'packages/dapp-sdk',
      ref: 'main',
      repo: 'https://github.com/example/sdk',
      url: 'https://example.com/sdk',
    }

    try {
      expect(() => summarizeProfileCapabilities({
        definitionSource: 'profiles',
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      })).toThrow('Expected npm upstream source for canton-network-dapp-sdk')
    } finally {
      ;(dappSdkSource as unknown as {source: typeof originalSource}).source = originalSource
    }
  })
})
