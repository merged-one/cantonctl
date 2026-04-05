import {describe, expect, it} from 'vitest'

import type {CantonctlConfig} from './config.js'
import {isAuthProfileMode, resolveAuthProfile, toJwtEnvVarName} from './auth-profile.js'
import {ErrorCode} from './errors.js'

describe('resolveAuthProfile', () => {
  it('defaults remote jwt networks to env-or-keychain-jwt', () => {
    const config: CantonctlConfig = {
      networks: {
        devnet: {auth: 'jwt', type: 'remote', url: 'https://ledger.example.com'},
      },
      networkProfiles: {
        devnet: 'devnet',
      },
      profiles: {
        devnet: {
          experimental: false,
          kind: 'remote-validator',
          name: 'devnet',
          services: {
            auth: {kind: 'jwt'},
            ledger: {url: 'https://ledger.example.com'},
          },
        },
      },
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const profile = resolveAuthProfile({config, network: 'devnet'})

    expect(profile.mode).toBe('env-or-keychain-jwt')
    expect(profile.experimental).toBe(false)
    expect(profile.envVarName).toBe('CANTONCTL_JWT_DEVNET')
    expect(profile.warnings).toEqual([])
  })

  it('resolves oidc-backed profiles to env-or-keychain-jwt mode', () => {
    const config: CantonctlConfig = {
      networks: {
        validator: {type: 'remote', url: 'https://ledger.example.com'},
      },
      networkProfiles: {
        validator: 'splice-devnet',
      },
      profiles: {
        'splice-devnet': {
          experimental: false,
          kind: 'remote-validator',
          name: 'splice-devnet',
          services: {
            auth: {issuer: 'https://login.example.com', kind: 'oidc'},
            ledger: {url: 'https://ledger.example.com'},
            validator: {url: 'https://validator.example.com'},
          },
        },
      },
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const profile = resolveAuthProfile({config, network: 'validator'})

    expect(profile.mode).toBe('env-or-keychain-jwt')
    expect(profile.profileName).toBe('splice-devnet')
    expect(profile.requiresExplicitExperimental).toBe(false)
    expect(profile.warnings).toEqual([])
  })

  it('treats sandbox and localnet-style profiles as bearer-token with local fallback', () => {
    const config: CantonctlConfig = {
      'default-profile': 'splice-localnet',
      networks: {
        local: {type: 'docker'},
      },
      networkProfiles: {
        local: 'splice-localnet',
      },
      profiles: {
        'splice-localnet': {
          experimental: true,
          kind: 'splice-localnet',
          name: 'splice-localnet',
          services: {
            localnet: {distribution: 'splice-localnet', version: '0.5.x'},
            validator: {url: 'https://validator.example.com'},
          },
        },
      },
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const profile = resolveAuthProfile({config, network: 'local'})

    expect(profile.mode).toBe('bearer-token')
    expect(profile.experimental).toBe(false)
    expect(profile.warnings.join(' ')).toContain('local fallback token')
  })

  it('allows an explicit bearer-token override when the operator wants caller-managed auth', () => {
    const config: CantonctlConfig = {
      networks: {
        devnet: {auth: 'jwt', type: 'remote', url: 'https://ledger.example.com'},
      },
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const profile = resolveAuthProfile({
      config,
      network: 'devnet',
      requestedMode: 'bearer-token',
    })

    expect(profile.mode).toBe('bearer-token')
    expect(profile.warnings[0]).toContain('Operator override')
  })

  it('falls back to a same-name profile and infers bearer-token mode for shared-secret or none auth', () => {
    const config: CantonctlConfig = {
      networks: {
        ops: {type: 'remote', url: 'https://ledger.example.com'},
      },
      profiles: {
        ops: {
          experimental: false,
          kind: 'remote-validator',
          name: 'ops',
          services: {
            auth: {kind: 'none'},
            ledger: {url: 'https://ledger.example.com'},
          },
        },
      },
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const profile = resolveAuthProfile({config, network: 'ops'})

    expect(profile.mode).toBe('bearer-token')
    expect(profile.profileName).toBe('ops')
    expect(profile.description).toContain('explicitly supplied bearer token')
    expect(profile.warnings[0]).toContain('local fallback token')
  })

  it('falls back to the default profile for local when no explicit local profile exists', () => {
    const config: CantonctlConfig = {
      'default-profile': 'splice-devnet',
      networks: {
        local: {type: 'remote', url: 'https://ledger.example.com'},
      },
      profiles: {
        'splice-devnet': {
          experimental: false,
          kind: 'remote-validator',
          name: 'splice-devnet',
          services: {
            auth: {issuer: 'https://login.example.com', kind: 'oidc'},
            ledger: {url: 'https://ledger.example.com'},
          },
        },
      },
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    }

    const profile = resolveAuthProfile({config, network: 'local'})

    expect(profile.mode).toBe('env-or-keychain-jwt')
    expect(profile.profileName).toBe('splice-devnet')
    expect(profile.profileKind).toBe('remote-validator')
  })

  it('fails when the requested network is missing', () => {
    const config: CantonctlConfig = {
      networks: {
        devnet: {auth: 'jwt', type: 'remote', url: 'https://ledger.example.com'},
      },
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    }

    try {
      resolveAuthProfile({config, network: 'missing'})
    } catch (err) {
      expect(err).toEqual(expect.objectContaining({
        code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
        suggestion: 'Network "missing" not found in cantonctl.yaml. Available: devnet',
      }))
    }
  })

  it('reports no available networks when none are configured', () => {
    const config: CantonctlConfig = {
      project: {name: 'demo', 'sdk-version': '3.4.11'},
      version: 1,
    }

    try {
      resolveAuthProfile({config, network: 'missing'})
    } catch (err) {
      expect(err).toEqual(expect.objectContaining({
        code: ErrorCode.CONFIG_SCHEMA_VIOLATION,
        suggestion: 'Network "missing" not found in cantonctl.yaml. Available: none',
      }))
    }
  })
})

describe('toJwtEnvVarName', () => {
  it('normalizes hyphenated names', () => {
    expect(toJwtEnvVarName('my-network')).toBe('CANTONCTL_JWT_MY_NETWORK')
  })
})

describe('isAuthProfileMode', () => {
  it('accepts known modes and rejects unknown values', () => {
    expect(isAuthProfileMode('env-or-keychain-jwt')).toBe(true)
    expect(isAuthProfileMode('not-a-mode')).toBe(false)
  })
})
