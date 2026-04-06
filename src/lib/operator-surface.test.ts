import {describe, expect, it} from 'vitest'

import type {ResolvedProfileRuntime} from './profile-runtime.js'
import {
  listOperatorSurfaceDefinitions,
  resolveOperatorSurface,
} from './operator-surface.js'
import {CantonctlError, ErrorCode} from './errors.js'

function createRuntime(): ResolvedProfileRuntime {
  return {
    auth: {
      operator: {
        description: 'operator',
        envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
        keychainAccount: 'operator:splice-devnet',
        localFallbackAllowed: false,
        prerequisites: [],
        required: true,
        scope: 'operator',
      },
      warnings: [],
    } as unknown as ResolvedProfileRuntime['auth'],
    capabilities: [],
    compatibility: {
      checks: [],
      failed: 0,
      passed: 0,
      profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet'},
      services: [],
      warned: 0,
    },
    credential: {
      mode: 'env-or-keychain-jwt',
      network: 'splice-devnet',
      scope: 'app',
      source: 'stored',
      token: 'app-token',
    },
    inventory: {} as never,
    networkName: 'splice-devnet',
    operatorCredential: {
      mode: 'env-or-keychain-jwt',
      network: 'splice-devnet',
      scope: 'operator',
      source: 'stored',
      token: 'operator-token',
    },
    profile: {
      experimental: false,
      kind: 'remote-validator',
      name: 'splice-devnet',
      services: {
        ledger: {url: 'https://ledger.example.com'},
        scan: {url: 'https://scan.example.com'},
      },
    },
    profileContext: {
      experimental: false,
      kind: 'remote-validator',
      name: 'splice-devnet',
      services: {
        ledger: {url: 'https://ledger.example.com'},
        scan: {url: 'https://scan.example.com'},
      },
    },
    services: [
      {
        controlPlane: {
          endpointProvenance: 'declared',
          lifecycleOwner: 'official-remote-runtime',
          managementClass: 'read-only',
          mutationScope: 'observed',
          operatorSurface: false,
        },
        detail: 'Scan endpoint',
        endpoint: 'https://scan.example.com',
        name: 'scan',
        sourceIds: ['splice-scan-external-openapi'],
        stability: 'stable-external',
      },
    ],
  } as ResolvedProfileRuntime
}

describe('operator surface policy', () => {
  it('lists the approved operator surfaces only', () => {
    expect(listOperatorSurfaceDefinitions()).toEqual([
      expect.objectContaining({
        commandPath: 'operator validator licenses',
        service: 'scan',
        sourceIds: ['splice-scan-external-openapi'],
        stabilities: ['stable-external'],
        surfaceId: 'validator-licenses',
      }),
    ])
  })

  it('resolves the approved validator license surface for a remote profile', () => {
    const surface = resolveOperatorSurface(createRuntime(), 'validator-licenses')

    expect(surface.commandPath).toBe('operator validator licenses')
    expect(surface.endpoint).toBe('https://scan.example.com')
    expect(surface.service.sourceIds).toEqual(['splice-scan-external-openapi'])
  })

  it('rejects unsupported profile kinds before auth resolution', () => {
    const runtime = createRuntime()
    runtime.profile.kind = 'splice-localnet'

    expect(() => resolveOperatorSurface(runtime, 'validator-licenses')).toThrowError(CantonctlError)

    try {
      resolveOperatorSurface(runtime, 'validator-licenses')
    } catch (error) {
      expect(error).toBeInstanceOf(CantonctlError)
      expect((error as CantonctlError).code).toBe(ErrorCode.SERVICE_NOT_CONFIGURED)
      expect((error as CantonctlError).suggestion).toContain('remote-validator, remote-sv-network')
    }
  })

  it('requires explicit operator credentials', () => {
    const runtime = createRuntime()
    runtime.operatorCredential = {
      ...runtime.operatorCredential,
      source: 'missing',
      token: undefined,
    }

    expect(() => resolveOperatorSurface(runtime, 'validator-licenses')).toThrowError(CantonctlError)

    try {
      resolveOperatorSurface(runtime, 'validator-licenses')
    } catch (error) {
      expect(error).toBeInstanceOf(CantonctlError)
      expect((error as CantonctlError).code).toBe(ErrorCode.SERVICE_AUTH_FAILED)
      expect((error as CantonctlError).suggestion).toContain('cantonctl auth login splice-devnet --scope operator')
    }
  })

  it('rejects profiles that do not require explicit operator auth', () => {
    const runtime = createRuntime()
    runtime.auth = {
      ...runtime.auth,
      operator: {
        ...runtime.auth.operator,
        required: false,
      },
    }

    expect(() => resolveOperatorSurface(runtime, 'validator-licenses')).toThrowError(CantonctlError)
  })

  it('rejects missing operator services and source-id drift with boundary-aware errors', () => {
    const missingService = createRuntime()
    missingService.services = []

    expect(() => resolveOperatorSurface(missingService, 'validator-licenses')).toThrowError(CantonctlError)

    const wrongSource = createRuntime()
    wrongSource.services = [
      {
        ...wrongSource.services[0],
        sourceIds: ['splice-validator-internal-openapi'],
      },
    ]

    expect(() => resolveOperatorSurface(wrongSource, 'validator-licenses')).toThrowError(CantonctlError)
  })

  it('rejects stability and control-plane drift', () => {
    const wrongStability = createRuntime()
    wrongStability.services = [
      {
        ...wrongStability.services[0],
        stability: 'operator-only',
      },
    ]
    expect(() => resolveOperatorSurface(wrongStability, 'validator-licenses')).toThrowError(CantonctlError)

    const wrongLifecycleOwner = createRuntime()
    wrongLifecycleOwner.services = [
      {
        ...wrongLifecycleOwner.services[0],
        controlPlane: {
          ...wrongLifecycleOwner.services[0].controlPlane,
          lifecycleOwner: 'official-local-runtime',
        },
      },
    ]
    expect(() => resolveOperatorSurface(wrongLifecycleOwner, 'validator-licenses')).toThrowError(CantonctlError)

    const wrongManagementClass = createRuntime()
    wrongManagementClass.services = [
      {
        ...wrongManagementClass.services[0],
        controlPlane: {
          ...wrongManagementClass.services[0].controlPlane,
          managementClass: 'plan-only',
        },
      },
    ]
    expect(() => resolveOperatorSurface(wrongManagementClass, 'validator-licenses')).toThrowError(CantonctlError)

    const wrongMutationScope = createRuntime()
    wrongMutationScope.services = [
      {
        ...wrongMutationScope.services[0],
        controlPlane: {
          ...wrongMutationScope.services[0].controlPlane,
          mutationScope: 'managed',
        },
      },
    ]
    expect(() => resolveOperatorSurface(wrongMutationScope, 'validator-licenses')).toThrowError(CantonctlError)
  })
})
