import {describe, expect, it} from 'vitest'

import {
  UPSTREAM_FORMATS,
  UPSTREAM_INTENDED_USES,
  UPSTREAM_MANIFEST,
  UPSTREAM_STABILITY_CLASSES,
  UPSTREAM_SOURCES,
  UPSTREAM_SOURCES_BY_ID,
  getUpstreamSource,
} from './manifest.js'

const REQUIRED_SOURCE_IDS = [
  'canton-json-ledger-api-openapi',
  'splice-scan-external-openapi',
  'splice-scan-proxy-openapi',
  'splice-ans-external-openapi',
  'splice-dapp-api-openrpc',
  'canton-network-dapp-sdk',
  'canton-network-wallet-sdk',
  'splice-validator-internal-openapi',
  'splice-wallet-internal-openapi',
  'splice-wallet-user-api-openrpc',
  'splice-token-metadata-openapi',
  'splice-token-allocation-openapi',
  'splice-token-allocation-instruction-openapi',
  'splice-token-transfer-instruction-openapi',
  'splice-token-metadata-daml',
  'splice-token-holding-daml',
  'splice-token-allocation-daml',
  'splice-token-allocation-instruction-daml',
  'splice-token-transfer-instruction-daml',
] as const

describe('UPSTREAM_MANIFEST', () => {
  it('has the expected manifest shape', () => {
    expect(UPSTREAM_MANIFEST.version).toBe(1)
    expect(UPSTREAM_MANIFEST.policy.generatedArtifactsMustUseManifest).toBe(true)
    expect(UPSTREAM_MANIFEST.policy.notes.length).toBeGreaterThan(0)
    expect(UPSTREAM_SOURCES.length).toBeGreaterThan(0)

    for (const source of UPSTREAM_SOURCES) {
      expect(source.id.length).toBeGreaterThan(0)
      expect(source.name.length).toBeGreaterThan(0)
      expect(UPSTREAM_STABILITY_CLASSES).toContain(source.stability)
      expect(UPSTREAM_FORMATS).toContain(source.format)
      expect(source.intendedUse.length).toBeGreaterThan(0)
      expect(UPSTREAM_INTENDED_USES).toEqual(expect.arrayContaining([...source.intendedUse]))

      if (source.source.kind === 'git') {
        expect(source.source.repo).toMatch(/^https:\/\/github\.com\//)
        expect(source.source.ref.length).toBeGreaterThan(0)
        expect(source.source.path.length).toBeGreaterThan(0)
        expect(source.source.url).toContain(source.source.ref)
      } else {
        expect(source.source.packageName).toMatch(/^@canton-network\//)
        expect(source.source.version.length).toBeGreaterThan(0)
        expect(source.source.packageUrl).toContain(source.source.version)
        expect(source.source.tarballUrl).toContain(source.source.version)
      }
    }
  })

  it('includes the required source entries', () => {
    const sourceIds = new Set(UPSTREAM_SOURCES.map(source => source.id))

    for (const requiredId of REQUIRED_SOURCE_IDS) {
      expect(sourceIds.has(requiredId)).toBe(true)
      expect(getUpstreamSource(requiredId)).toEqual(UPSTREAM_SOURCES_BY_ID[requiredId])
    }
  })

  it('applies stability classification rules', () => {
    for (const source of UPSTREAM_SOURCES) {
      switch (source.stability) {
        case 'stable-external':
          expect(['openapi', 'openrpc']).toContain(source.format)
          expect(source.intendedUse).toEqual(
            expect.arrayContaining(['compatibility-check']),
          )
          break

        case 'stable-daml-interface':
          expect(source.format).toBe('daml-interface')
          expect(source.intendedUse).toContain('generate-bindings')
          break

        case 'public-sdk':
          expect(source.format).toBe('npm-package')
          expect(source.source.kind).toBe('npm')
          expect(source.intendedUse).toContain('runtime-integration')
          break

        case 'experimental-internal':
        case 'operator-only':
          expect(source.intendedUse).not.toContain('generate-client')
          expect(source.intendedUse).not.toContain('generate-bindings')
          break
      }
    }

    expect(getUpstreamSource('canton-json-ledger-api-openapi').stability).toBe('stable-external')
    expect(getUpstreamSource('splice-dapp-api-openrpc').stability).toBe('stable-external')
    expect(getUpstreamSource('canton-network-dapp-sdk').stability).toBe('public-sdk')
    expect(getUpstreamSource('splice-scan-proxy-openapi').stability).toBe('experimental-internal')
    expect(getUpstreamSource('splice-validator-internal-openapi').stability).toBe('operator-only')
    expect(getUpstreamSource('splice-token-metadata-daml').stability).toBe('stable-daml-interface')
  })

  it('has no duplicate source ids', () => {
    const sourceIds = UPSTREAM_SOURCES.map(source => source.id)
    expect(new Set(sourceIds).size).toBe(sourceIds.length)
  })
})
