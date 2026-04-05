import {describe, expect, it, vi} from 'vitest'

import type {CanaryRunner} from './canary/run.js'
import type {CantonctlConfig} from './config.js'
import type {PreflightRunner} from './preflight/checks.js'
import type {PreflightReport} from './preflight/output.js'
import {createReadinessRunner} from './readiness.js'

function createConfig(profileName: string, services: Record<string, unknown>): CantonctlConfig {
  return {
    'default-profile': profileName,
    profiles: {
      [profileName]: {
        experimental: false,
        kind: profileName === 'sandbox' ? 'sandbox' : 'remote-validator',
        name: profileName,
        services,
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createPreflightReport(overrides: Partial<PreflightReport> = {}): PreflightReport {
  return {
    auth: {
      credentialSource: 'stored',
      envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
      mode: 'env-or-keychain-jwt',
      warnings: [],
    },
    checks: [
      {category: 'profile', detail: 'Resolved profile.', name: 'Profile resolution', status: 'pass'},
      {category: 'scan', detail: 'Reachable.', endpoint: 'https://scan.example.com', name: 'Scan reachability', status: 'pass'},
      {category: 'egress', detail: 'Visible as 203.0.113.10.', name: 'Egress IP visibility', status: 'warn'},
      {category: 'health', detail: 'Endpoint not exposed.', name: 'Validator readyz', status: 'skip'},
    ],
    compatibility: {failed: 0, passed: 3, warned: 1},
    egressIp: '203.0.113.10',
    network: {
      checklist: [],
      name: 'splice-devnet',
      reminders: [],
      resetExpectation: 'resets-expected',
      tier: 'devnet',
    },
    profile: {
      experimental: false,
      kind: 'remote-validator',
      name: 'splice-devnet',
    },
    success: true,
    ...overrides,
  }
}

describe('createReadinessRunner', () => {
  it('selects stable/public suites from the resolved profile and aggregates counts', async () => {
    const preflight: PreflightRunner = {
      run: vi.fn().mockResolvedValue(createPreflightReport()),
    }
    const canaryRun = vi.fn().mockResolvedValue({
      checks: [
        {
          detail: 'Stable/public scan endpoint reachable.',
          endpoint: 'https://scan.example.com',
          status: 'pass',
          suite: 'scan',
          warnings: [],
        },
        {
          detail: 'Validator endpoint reachable with minor warning.',
          endpoint: 'https://validator.example.com',
          status: 'pass',
          suite: 'validator-user',
          warnings: ['Token will expire soon.'],
        },
      ],
      profile: {kind: 'remote-validator', name: 'splice-devnet'},
      success: true,
    })
    const canary: CanaryRunner = {run: canaryRun}

    const runner = createReadinessRunner({
      createCanaryRunner: () => canary,
      createPreflightRunner: () => preflight,
    })
    const config = createConfig('splice-devnet', {
      ledger: {url: 'https://ledger.example.com'},
      scan: {url: 'https://scan.example.com'},
      validator: {url: 'https://validator.example.com'},
    })

    const report = await runner.run({config})

    expect(preflight.run).toHaveBeenCalledWith({config})
    expect(canaryRun).toHaveBeenCalledWith({
      config,
      profileName: undefined,
      signal: undefined,
      suites: ['scan', 'ans', 'validator-user'],
    })
    expect(report.canary.selectedSuites).toEqual(['scan', 'ans', 'validator-user'])
    expect(report.canary.skippedSuites).toEqual(['token-standard'])
    expect(report.summary).toEqual({
      failed: 0,
      passed: 4,
      skipped: 2,
      warned: 2,
    })
    expect(report.success).toBe(true)
  })

  it('propagates failures from preflight and canary output into a blocking readiness result', async () => {
    const preflight: PreflightRunner = {
      run: vi.fn().mockResolvedValue(createPreflightReport({
        checks: [
          {category: 'auth', detail: 'Credential missing.', name: 'Credential material', status: 'fail'},
          {category: 'profile', detail: 'Resolved profile.', name: 'Profile resolution', status: 'pass'},
        ],
        success: false,
      })),
    }
    const canary: CanaryRunner = {
      run: vi.fn().mockResolvedValue({
        checks: [
          {
            detail: 'Stable/public scan endpoint failed.',
            endpoint: 'https://scan.example.com',
            status: 'fail',
            suite: 'scan',
            warnings: [],
          },
        ],
        profile: {kind: 'remote-validator', name: 'splice-devnet'},
        success: false,
      }),
    }

    const runner = createReadinessRunner({
      createCanaryRunner: () => canary,
      createPreflightRunner: () => preflight,
    })
    const config = createConfig('splice-devnet', {
      ledger: {url: 'https://ledger.example.com'},
      scan: {url: 'https://scan.example.com'},
    })

    const report = await runner.run({config})

    expect(report.summary).toEqual({
      failed: 2,
      passed: 1,
      skipped: 2,
      warned: 0,
    })
    expect(report.success).toBe(false)
  })

  it('skips canary execution when no stable/public suites apply', async () => {
    const preflight: PreflightRunner = {
      run: vi.fn().mockResolvedValue(createPreflightReport({
        auth: {
          credentialSource: 'fallback',
          envVarName: 'CANTONCTL_JWT_SANDBOX',
          mode: 'bearer-token',
          warnings: [],
        },
        checks: [
          {category: 'profile', detail: 'Resolved local profile.', name: 'Profile resolution', status: 'pass'},
          {category: 'scan', detail: 'No stable/public scan endpoint configured.', name: 'Scan reachability', status: 'skip'},
        ],
        network: {
          checklist: [],
          name: 'sandbox',
          reminders: [],
          resetExpectation: 'resets-expected',
          tier: 'local',
        },
        profile: {
          experimental: false,
          kind: 'sandbox',
          name: 'sandbox',
        },
      })),
    }
    const canaryRun = vi.fn()
    const canary: CanaryRunner = {run: canaryRun}

    const runner = createReadinessRunner({
      createCanaryRunner: () => canary,
      createPreflightRunner: () => preflight,
    })
    const config = createConfig('sandbox', {
      ledger: {port: 5001, 'json-api-port': 7575},
    })

    const report = await runner.run({config})

    expect(canaryRun).not.toHaveBeenCalled()
    expect(report.canary.selectedSuites).toEqual([])
    expect(report.canary.skippedSuites).toEqual(['scan', 'ans', 'token-standard', 'validator-user'])
    expect(report.summary).toEqual({
      failed: 0,
      passed: 1,
      skipped: 5,
      warned: 0,
    })
    expect(report.success).toBe(true)
  })
})
