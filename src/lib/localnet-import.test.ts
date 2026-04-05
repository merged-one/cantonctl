import * as yaml from 'js-yaml'

import {describe, expect, it} from 'vitest'

import {mergeLocalnetProfileIntoConfigYaml, synthesizeProfileFromLocalnetWorkspace} from './localnet-import.js'
import type {LocalnetWorkspace} from './localnet-workspace.js'

function createWorkspace(options: {scan?: string; version?: string} = {}): LocalnetWorkspace {
  const env: Record<string, string> = {}
  if (options.version) {
    env.SPLICE_VERSION = options.version
  }

  return {
    composeFilePath: '/workspace/compose.yaml',
    configDir: '/workspace/config',
    env,
    envFilePaths: ['/workspace/.env'],
    localnetDir: '/workspace/docker/modules/localnet',
    makeTargets: {down: 'stop', status: 'status', up: 'start'},
    makefilePath: '/workspace/Makefile',
    profiles: {
      'app-provider': {
        health: {validatorReadyz: 'http://127.0.0.1:3903/api/validator/readyz'},
        name: 'app-provider',
        urls: {
          ledger: 'http://canton.localhost:3000/v2',
          validator: 'http://wallet.localhost:3000/api/validator',
          wallet: 'http://wallet.localhost:3000',
        },
      },
      'app-user': {
        health: {validatorReadyz: 'http://127.0.0.1:2903/api/validator/readyz'},
        name: 'app-user',
        urls: {
          ledger: 'http://canton.localhost:2000/v2',
          validator: 'http://wallet.localhost:2000/api/validator',
          wallet: 'http://wallet.localhost:2000',
        },
      },
      sv: {
        health: {validatorReadyz: 'http://127.0.0.1:4903/api/validator/readyz'},
        name: 'sv',
        urls: {
          ledger: 'http://canton.localhost:4000/v2',
          scan: options.scan,
          validator: 'http://wallet.localhost:4000/api/validator',
          wallet: 'http://wallet.localhost:4000',
        },
      },
    },
    root: '/workspace',
    services: {
      ledger: 'http://canton.localhost:4000/v2',
      scan: options.scan ?? 'http://scan.localhost:4000/api/scan',
      validator: 'http://wallet.localhost:4000/api/validator',
      wallet: 'http://wallet.localhost:4000',
    },
  }
}

describe('synthesizeProfileFromLocalnetWorkspace', () => {
  it('materializes the canonical splice-localnet profile and network mapping', () => {
    const synthesized = synthesizeProfileFromLocalnetWorkspace({
      workspace: createWorkspace({
        scan: 'http://scan.localhost:4000/api/scan',
        version: '0.5.3',
      }),
    })

    expect(synthesized.name).toBe('splice-localnet')
    expect(synthesized.networkName).toBe('localnet')
    expect(synthesized.network).toEqual({profile: 'splice-localnet'})
    expect(synthesized.profile).toEqual({
      kind: 'splice-localnet',
      ledger: {url: 'http://canton.localhost:4000/v2'},
      localnet: {
        distribution: 'splice-localnet',
        'source-profile': 'sv',
        version: '0.5.3',
        workspace: '/workspace',
      },
      scan: {url: 'http://scan.localhost:4000/api/scan'},
      validator: {url: 'http://wallet.localhost:4000/api/validator'},
    })
    expect(synthesized.warnings).toEqual([])
    expect(synthesized.yaml).toContain('profiles:')
    expect(synthesized.yaml).toContain('splice-localnet:')
    expect(synthesized.yaml).toContain('networks:')
    expect(synthesized.yaml).toContain('localnet:')
  })

  it('supports custom names and warns when scan or version cannot be inferred', () => {
    const synthesized = synthesizeProfileFromLocalnetWorkspace({
      name: 'splice-localnet-user',
      networkName: 'team-localnet',
      sourceProfile: 'app-user',
      workspace: createWorkspace(),
    })

    expect(synthesized.name).toBe('splice-localnet-user')
    expect(synthesized.networkName).toBe('team-localnet')
    expect(synthesized.profile).toEqual({
      kind: 'splice-localnet',
      ledger: {url: 'http://canton.localhost:2000/v2'},
      localnet: {
        distribution: 'splice-localnet',
        'source-profile': 'app-user',
        version: undefined,
        workspace: '/workspace',
      },
      validator: {url: 'http://wallet.localhost:2000/api/validator'},
    })
    expect(synthesized.warnings).toEqual([
      'Profile "app-user" does not expose a scan endpoint; stable/public checks will be limited.',
      'Could not infer SPLICE_VERSION from the LocalNet workspace .env files.',
    ])
  })
})

describe('mergeLocalnetProfileIntoConfigYaml', () => {
  it('preserves existing config while updating the imported profile and network mapping', () => {
    const merged = mergeLocalnetProfileIntoConfigYaml({
      existingConfigYaml: [
        'version: 1',
        'default-profile: sandbox',
        'project:',
        '  name: demo',
        '  sdk-version: "3.4.11"',
        'profiles:',
        '  sandbox:',
        '    kind: sandbox',
        '    ledger:',
        '      port: 5001',
        '  splice-localnet:',
        '    kind: splice-localnet',
        '    ledger:',
        '      url: http://old.example.com/v2',
        'networks:',
        '  localnet:',
        '    profile: old-localnet',
      ].join('\n'),
      synthesized: synthesizeProfileFromLocalnetWorkspace({
        workspace: createWorkspace({
          scan: 'http://scan.localhost:4000/api/scan',
          version: '0.5.4',
        }),
      }),
    })

    const parsed = yaml.load(merged) as {
      'default-profile': string
      networks: Record<string, {profile: string}>
      profiles: Record<string, Record<string, unknown>>
      project: {name: string; 'sdk-version': string}
      version: number
    }

    expect(parsed.version).toBe(1)
    expect(parsed['default-profile']).toBe('sandbox')
    expect(parsed.project).toEqual({name: 'demo', 'sdk-version': '3.4.11'})
    expect(parsed.networks.localnet).toEqual({profile: 'splice-localnet'})
    expect(parsed.profiles.sandbox).toEqual({
      kind: 'sandbox',
      ledger: {port: 5001},
    })
    expect(parsed.profiles['splice-localnet']).toEqual({
      kind: 'splice-localnet',
      ledger: {url: 'http://canton.localhost:4000/v2'},
      localnet: {
        distribution: 'splice-localnet',
        'source-profile': 'sv',
        version: '0.5.4',
        workspace: '/workspace',
      },
      scan: {url: 'http://scan.localhost:4000/api/scan'},
      validator: {url: 'http://wallet.localhost:4000/api/validator'},
    })
  })

  it('replaces non-record profiles and networks blocks with canonical maps', () => {
    const merged = mergeLocalnetProfileIntoConfigYaml({
      existingConfigYaml: [
        'version: 1',
        'profiles: []',
        'networks: []',
      ].join('\n'),
      synthesized: synthesizeProfileFromLocalnetWorkspace({
        workspace: createWorkspace({
          scan: 'http://scan.localhost:4000/api/scan',
          version: '0.5.4',
        }),
      }),
    })

    const parsed = yaml.load(merged) as {
      networks: Record<string, {profile: string}>
      profiles: Record<string, Record<string, unknown>>
    }

    expect(parsed.networks).toEqual({
      localnet: {profile: 'splice-localnet'},
    })
    expect(parsed.profiles['splice-localnet']).toEqual(expect.objectContaining({
      kind: 'splice-localnet',
    }))
  })

  it('replaces null profile and network blocks with canonical maps', () => {
    const merged = mergeLocalnetProfileIntoConfigYaml({
      existingConfigYaml: [
        'version: 1',
        'profiles: null',
        'networks: null',
      ].join('\n'),
      synthesized: synthesizeProfileFromLocalnetWorkspace({
        workspace: createWorkspace({
          scan: 'http://scan.localhost:4000/api/scan',
          version: '0.5.4',
        }),
      }),
    })

    const parsed = yaml.load(merged) as {
      networks: Record<string, {profile: string}>
      profiles: Record<string, Record<string, unknown>>
    }

    expect(parsed.networks.localnet).toEqual({profile: 'splice-localnet'})
    expect(parsed.profiles['splice-localnet']).toEqual(expect.objectContaining({
      kind: 'splice-localnet',
    }))
  })

  it('replaces primitive profile and network blocks with canonical maps', () => {
    const merged = mergeLocalnetProfileIntoConfigYaml({
      existingConfigYaml: [
        'version: 1',
        'profiles: 42',
        'networks: 42',
      ].join('\n'),
      synthesized: synthesizeProfileFromLocalnetWorkspace({
        workspace: createWorkspace({
          scan: 'http://scan.localhost:4000/api/scan',
          version: '0.5.4',
        }),
      }),
    })

    const parsed = yaml.load(merged) as {
      networks: Record<string, {profile: string}>
      profiles: Record<string, Record<string, unknown>>
    }

    expect(parsed.networks.localnet).toEqual({profile: 'splice-localnet'})
    expect(parsed.profiles['splice-localnet']).toEqual(expect.objectContaining({
      kind: 'splice-localnet',
    }))
  })

  it('initializes an empty config document before merging the imported profile', () => {
    const merged = mergeLocalnetProfileIntoConfigYaml({
      existingConfigYaml: '',
      synthesized: synthesizeProfileFromLocalnetWorkspace({
        workspace: createWorkspace({
          scan: 'http://scan.localhost:4000/api/scan',
          version: '0.5.4',
        }),
      }),
    })

    const parsed = yaml.load(merged) as {
      networks: Record<string, {profile: string}>
      profiles: Record<string, Record<string, unknown>>
    }

    expect(parsed).toEqual({
      networks: {
        localnet: {profile: 'splice-localnet'},
      },
      profiles: {
        'splice-localnet': expect.objectContaining({kind: 'splice-localnet'}),
      },
    })
  })
})
