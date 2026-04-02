import {describe, expect, it} from 'vitest'

import {getUpstreamSource} from '../lib/upstream/manifest.js'
import {
  SYNCED_SPEC_REGISTRY,
  STABLE_GENERATED_OPENAPI_SOURCE_IDS,
  STABLE_GENERATED_OPENRPC_SOURCE_IDS,
  STABLE_GENERATED_SOURCE_IDS,
  ledgerJsonApi,
  openrpc,
  splice,
} from './index.js'

describe('generated spec artifacts', () => {
  it('exports the expected root modules', () => {
    expect(ledgerJsonApi.cantonJsonLedgerApiMetadata.sourceId).toBe('canton-json-ledger-api-openapi')
    expect(splice.spliceScanExternalMetadata.sourceId).toBe('splice-scan-external-openapi')
    expect(splice.spliceAnsExternalMetadata.sourceId).toBe('splice-ans-external-openapi')
    expect(openrpc.spliceDappApiOpenRpcMetadata.sourceId).toBe('splice-dapp-api-openrpc')
    expect(Array.isArray(openrpc.spliceDappApiOpenRpcSpec.methods)).toBe(true)
  })

  it('maps every synced spec back to an upstream manifest entry', () => {
    for (const entry of SYNCED_SPEC_REGISTRY) {
      const source = getUpstreamSource(entry.sourceId)
      expect(source.format).toBe(entry.format)
      expect(source.family).toBe(entry.family)
      expect(source.stability).toBe(entry.stability)
    }
  })

  it('keeps experimental and operator-only specs out of the stable generated tree', () => {
    const stableGeneratedIds = new Set<string>(STABLE_GENERATED_SOURCE_IDS)

    expect(stableGeneratedIds.has('splice-scan-proxy-openapi')).toBe(false)
    expect(stableGeneratedIds.has('splice-validator-internal-openapi')).toBe(false)
    expect(stableGeneratedIds.has('splice-wallet-internal-openapi')).toBe(false)
    expect(stableGeneratedIds.has('splice-wallet-user-api-openrpc')).toBe(false)

    for (const sourceId of STABLE_GENERATED_SOURCE_IDS) {
      const source = getUpstreamSource(sourceId)
      expect(source.stability).toBe('stable-external')
      expect(source.intendedUse).toContain('generate-client')
    }

    expect(STABLE_GENERATED_OPENAPI_SOURCE_IDS).toEqual(
      expect.arrayContaining([
        'canton-json-ledger-api-openapi',
        'splice-scan-external-openapi',
        'splice-ans-external-openapi',
      ]),
    )
    expect(STABLE_GENERATED_OPENRPC_SOURCE_IDS).toEqual(['splice-dapp-api-openrpc'])
  })
})
