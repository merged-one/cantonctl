import {describe, expect, it} from 'vitest'

import type {CantonctlConfig} from './config.js'
import {resolveAuthProfile, toJwtEnvVarName} from './auth-profile.js'

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

  it('resolves oidc-backed profiles to experimental client-credentials mode', () => {
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

    expect(profile.mode).toBe('oidc-client-credentials')
    expect(profile.profileName).toBe('splice-devnet')
    expect(profile.requiresExplicitExperimental).toBe(true)
    expect(profile.warnings.join(' ')).toContain('operator-only')
  })

  it('treats sandbox and localnet-style profiles as local-only unsafe hmac auth', () => {
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

    expect(profile.mode).toBe('localnet-unsafe-hmac')
    expect(profile.experimental).toBe(true)
    expect(profile.warnings.join(' ')).toContain('local-only')
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
})

describe('toJwtEnvVarName', () => {
  it('normalizes hyphenated names', () => {
    expect(toJwtEnvVarName('my-network')).toBe('CANTONCTL_JWT_MY_NETWORK')
  })
})
