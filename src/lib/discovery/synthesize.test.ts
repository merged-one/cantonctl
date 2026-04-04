import {describe, expect, it} from 'vitest'

import {mergeProfileIntoConfigYaml, synthesizeProfileFromDiscovery} from './synthesize.js'

describe('discovery synthesis', () => {
  it('synthesizes remote-sv-network profiles from stable/public scan discovery data', () => {
    const result = synthesizeProfileFromDiscovery({
      discovery: {
        dsoInfo: {
          auth_url: 'https://auth.example.com',
          ledger_url: 'https://ledger.example.com',
        },
        scanUrl: 'https://scan.example.com',
        scans: [],
        sequencers: [],
      },
      kind: 'remote-sv-network',
      name: 'sv-profile',
    })

    expect(result.name).toBe('sv-profile')
    expect(result.profile).toEqual({
      auth: {kind: 'jwt', url: 'https://auth.example.com'},
      kind: 'remote-sv-network',
      ledger: {url: 'https://ledger.example.com'},
      scan: {url: 'https://scan.example.com'},
    })
  })

  it('synthesizes remote-validator profiles and preserves unrelated config when writing', () => {
    const synthesized = synthesizeProfileFromDiscovery({
      discovery: {
        dsoInfo: {
          auth_url: 'https://auth.example.com',
          validator_url: 'https://validator.example.com',
        },
        scanUrl: 'https://scan.example.com',
        scans: [],
        sequencers: [],
      },
      kind: 'remote-validator',
      name: 'validator-profile',
    })

    const merged = mergeProfileIntoConfigYaml({
      existingConfigYaml: `version: 1

project:
  name: demo
  sdk-version: "3.4.11"

profiles:
  sandbox:
    kind: sandbox
    ledger:
      port: 5001
      json-api-port: 7575
`,
      synthesized,
    })

    expect(merged).toContain('sandbox:')
    expect(merged).toContain('validator-profile:')
    expect(merged).toContain('validator:')
    expect(merged).toContain('https://validator.example.com')
  })
})

