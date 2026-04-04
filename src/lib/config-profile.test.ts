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

  it('infers the default profile when exactly one profile exists without local aliases', () => {
    const result = normalizeConfigProfiles({
      profiles: {
        remote: {
          kind: 'remote-validator',
          ledger: {url: 'https://ledger.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })

    expect(result.defaultProfile).toBe('remote')
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

  it('maps remote-sv profiles and legacy auth kinds back to compatible network targets', () => {
    const result = normalizeConfigProfiles({
      networks: {
        devnet: {profile: 'sv'},
        ops: {profile: 'token-auth'},
      },
      profiles: {
        sv: {
          kind: 'remote-sv-network',
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
        },
        'token-auth': {
          auth: {kind: 'shared-secret'},
          kind: 'remote-validator',
          ledger: {auth: 'shared-secret', url: 'https://ops-ledger.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })

    expect(result.networks.devnet).toEqual({
      type: 'remote',
      url: 'https://ledger.example.com',
    })
    expect(result.networks.ops).toEqual({
      auth: 'shared-secret',
      type: 'remote',
      url: 'https://ops-ledger.example.com',
    })
  })

  it('normalizes optional services and leaves the default profile unset when multiple non-local profiles exist', () => {
    const result = normalizeConfigProfiles({
      networks: {
        canton: {profile: 'canton'},
        qa: {profile: 'none-auth'},
      },
      profiles: {
        canton: {
          kind: 'canton-multi',
          ledger: {url: 'https://canton-ledger.example.com'},
        },
        'none-auth': {
          ans: {url: 'https://ans.example.com'},
          auth: {kind: 'none'},
          kind: 'remote-validator',
          ledger: {url: 'https://qa-ledger.example.com'},
          scanProxy: {url: 'https://scan-proxy.example.com'},
          tokenStandard: {url: 'https://token.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })

    expect(result.defaultProfile).toBeUndefined()
    expect(result.profiles['none-auth'].services.ans).toEqual({
      url: 'https://ans.example.com',
    })
    expect(result.profiles['none-auth'].services.scanProxy).toEqual({
      url: 'https://scan-proxy.example.com',
    })
    expect(result.profiles['none-auth'].services.tokenStandard).toEqual({
      url: 'https://token.example.com',
    })
    expect(result.networks.canton).toEqual({
      type: 'docker',
      url: 'https://canton-ledger.example.com',
    })
    expect(result.networks.qa).toEqual({
      auth: 'none',
      type: 'remote',
      url: 'https://qa-ledger.example.com',
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

  it('fails when sandbox and canton-multi profiles omit the required ledger service', () => {
    expect(() => normalizeConfigProfiles({
      profiles: {
        canton: {
          kind: 'canton-multi',
        },
        sandbox: {
          kind: 'sandbox',
        },
      },
      project: {name: 'my-app', 'sdk-version': '3.4.11'},
      version: 1,
    })).toThrow(CantonctlError)

    try {
      normalizeConfigProfiles({
        profiles: {
          canton: {
            kind: 'canton-multi',
          },
          sandbox: {
            kind: 'sandbox',
          },
        },
        project: {name: 'my-app', 'sdk-version': '3.4.11'},
        version: 1,
      })
    } catch (err) {
      const e = err as CantonctlError
      expect(e.code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
      expect(e.context.issues).toContainEqual({
        message: 'ledger service is required for profile kind "sandbox"',
        path: 'profiles.sandbox.ledger',
      })
      expect(e.context.issues).toContainEqual({
        message: 'ledger service is required for profile kind "canton-multi"',
        path: 'profiles.canton.ledger',
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
