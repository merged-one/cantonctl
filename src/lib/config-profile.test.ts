import {describe, expect, it} from 'vitest'

import {normalizeConfigProfiles} from './config-profile.js'
import {CantonctlError, ErrorCode} from './errors.js'

describe('normalizeConfigProfiles', () => {
  it('normalizes legacy networks into deterministic canonical profiles', () => {
    const result = normalizeConfigProfiles({
      networks: {
        canton: {type: 'docker'},
        devnet: {auth: 'jwt', type: 'remote', url: 'https://ledger.example.com'},
        local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })

    expect(result.defaultProfile).toBe('local')
    expect(result.profiles.local).toEqual({
      experimental: false,
      kind: 'sandbox',
      name: 'local',
      services: {
        auth: undefined,
        ledger: {port: 5001, 'json-api-port': 7575},
      },
    })
    expect(result.profiles.canton.kind).toBe('canton-multi')
    expect(result.profiles.devnet.kind).toBe('remote-validator')
    expect(result.networks).toEqual({
      canton: {type: 'docker'},
      devnet: {auth: 'jwt', type: 'remote', url: 'https://ledger.example.com'},
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    })
  })

  it('normalizes profile references into legacy-compatible network targets', () => {
    const result = normalizeConfigProfiles({
      'default-profile': 'sandbox',
      networks: {
        devnet: {profile: 'validator'},
        local: {kind: 'ledger', profile: 'sandbox'},
      },
      profiles: {
        sandbox: {
          kind: 'sandbox',
          ledger: {port: 5001, 'json-api-port': 7575},
        },
        validator: {
          auth: {issuer: 'https://login.example.com', kind: 'oidc'},
          kind: 'remote-validator',
          ledger: {url: 'https://ledger.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })

    expect(result.profiles.sandbox.services.ledger).toEqual({
      port: 5001,
      'json-api-port': 7575,
    })
    expect(result.profiles.validator.services.auth).toEqual({
      issuer: 'https://login.example.com',
      kind: 'oidc',
    })
    expect(result.networks.local).toEqual({
      port: 5001,
      'json-api-port': 7575,
      type: 'sandbox',
    })
    expect(result.networks.devnet).toEqual({
      type: 'remote',
      url: 'https://ledger.example.com',
    })
  })

  it('synthesizes a local network for default sandbox profiles when networks are omitted', () => {
    const result = normalizeConfigProfiles({
      'default-profile': 'sandbox',
      profiles: {
        sandbox: {
          kind: 'sandbox',
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })

    expect(result.networks).toEqual({
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    })
  })

  it('maps splice-localnet profiles back to legacy docker networks when referenced explicitly', () => {
    const result = normalizeConfigProfiles({
      networks: {
        local: {profile: 'splice'},
      },
      profiles: {
        splice: {
          kind: 'splice-localnet',
          ledger: {port: 5001, 'json-api-port': 7575},
          localnet: {distribution: 'splice', version: '0.5.x'},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })

    expect(result.defaultProfile).toBe('splice')
    expect(result.networks.local).toEqual({
      port: 5001,
      'json-api-port': 7575,
      type: 'docker',
    })
  })

  it('fails with structured errors when a profile kind uses invalid services', () => {
    expect(() => normalizeConfigProfiles({
      profiles: {
        sandbox: {
          kind: 'sandbox',
          ledger: {port: 5001, 'json-api-port': 7575},
          scan: {url: 'https://scan.example.com'},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })).toThrow(CantonctlError)

    try {
      normalizeConfigProfiles({
        profiles: {
          sandbox: {
            kind: 'sandbox',
            ledger: {port: 5001, 'json-api-port': 7575},
            scan: {url: 'https://scan.example.com'},
          },
        },
        project: {name: 'my-app', 'sdk-version': '3.4.11'},
        version: 1,
      })
    } catch (err) {
      const e = err as CantonctlError
      expect(e.code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
      expect(e.context.issues).toContainEqual({
        message: 'service "scan" is not allowed for profile kind "sandbox"',
        path: 'profiles.sandbox.scan',
      })
    }
  })

  it('fails when the configured default profile is missing', () => {
    expect(() => normalizeConfigProfiles({
      'default-profile': 'missing',
      profiles: {
        sandbox: {
          kind: 'sandbox',
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })).toThrow(CantonctlError)

    try {
      normalizeConfigProfiles({
        'default-profile': 'missing',
        profiles: {
          sandbox: {
            kind: 'sandbox',
            ledger: {port: 5001, 'json-api-port': 7575},
          },
        },
        project: {name: 'my-app', 'sdk-version': '3.4.11'},
        version: 1,
      })
    } catch (err) {
      const e = err as CantonctlError
      expect(e.code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
      expect(e.context.issues).toContainEqual({
        message: 'profile "missing" is not defined',
        path: 'default-profile',
      })
    }
  })

  it('fails when a network references a profile without a ledger service', () => {
    expect(() => normalizeConfigProfiles({
      networks: {
        devnet: {profile: 'sv'},
      },
      profiles: {
        sv: {
          kind: 'remote-sv-network',
          scan: {url: 'https://scan.example.com'},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })).toThrow(CantonctlError)
  })

  it('fails when required splice-localnet and remote-sv services are missing', () => {
    expect(() => normalizeConfigProfiles({
      profiles: {
        local: {
          kind: 'splice-localnet',
          ledger: {port: 5001, 'json-api-port': 7575},
        },
        sv: {
          kind: 'remote-sv-network',
          ledger: {url: 'https://ledger.example.com'},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })).toThrow(CantonctlError)

    try {
      normalizeConfigProfiles({
        profiles: {
          local: {
            kind: 'splice-localnet',
            ledger: {port: 5001, 'json-api-port': 7575},
          },
          sv: {
            kind: 'remote-sv-network',
            ledger: {url: 'https://ledger.example.com'},
          },
        },
        project: {name: 'my-app', 'sdk-version': '3.4.11'},
        version: 1,
      })
    } catch (err) {
      const e = err as CantonctlError
      expect(e.code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
      expect(e.context.issues).toContainEqual({
        message: 'localnet service is required for profile kind "splice-localnet"',
        path: 'profiles.local.localnet',
      })
      expect(e.context.issues).toContainEqual({
        message: 'scan or scanProxy service is required for profile kind "remote-sv-network"',
        path: 'profiles.sv',
      })
    }
  })

  it('fails when a network references an undefined profile', () => {
    expect(() => normalizeConfigProfiles({
      networks: {
        devnet: {profile: 'missing'},
      },
      profiles: {
        sandbox: {
          kind: 'sandbox',
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })).toThrow(CantonctlError)
  })
})
