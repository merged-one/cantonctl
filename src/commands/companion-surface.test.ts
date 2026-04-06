import {captureOutput} from '@oclif/test'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as canaryReportModule from '../lib/canary/report.js'
import * as canaryRunModule from '../lib/canary/run.js'
import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import * as diagnosticsBundleModule from '../lib/diagnostics/bundle.js'
import * as diagnosticsCollectModule from '../lib/diagnostics/collect.js'
import * as discoveryFetchModule from '../lib/discovery/fetch.js'
import * as exportFormattersModule from '../lib/export/formatters.js'
import * as exportSdkConfigModule from '../lib/export/sdk-config.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import * as lifecycleResetModule from '../lib/lifecycle/reset.js'
import * as lifecycleUpgradeModule from '../lib/lifecycle/upgrade.js'
import * as localnetImportModule from '../lib/localnet-import.js'
import * as localnetWorkspaceModule from '../lib/localnet-workspace.js'
import type {PreflightReport} from '../lib/preflight/output.js'
import * as preflightChecksModule from '../lib/preflight/checks.js'
import * as promotionRolloutModule from '../lib/promotion-rollout.js'
import type {PromotionRolloutResult} from '../lib/promotion-rollout.js'
import * as readinessModule from '../lib/readiness.js'
import type {ReadinessReport} from '../lib/readiness.js'
import {createPreflightRolloutContract, createReadinessRolloutContract} from '../lib/rollout-contract.js'
import type {RuntimeInventory} from '../lib/runtime-inventory.js'
import CanaryStablePublic from './canary/stable-public.js'
import DiagnosticsBundle from './diagnostics/bundle.js'
import DiscoverNetwork from './discover/network.js'
import ExportSdkConfig from './export/sdk-config.js'
import Init from './init.js'
import Preflight from './preflight.js'
import ProfilesImportLocalnet from './profiles/import-localnet.js'
import ProfilesImportScan from './profiles/import-scan.js'
import PromoteDiff, {renderPromotionRollout} from './promote/diff.js'
import Readiness, {renderReadinessReport} from './readiness.js'
import ResetChecklist from './reset/checklist.js'
import UpgradeCheck from './upgrade/check.js'

const CLI_ROOT = process.cwd()
const ORIGINAL_CWD = process.cwd()
const TEMP_DIRS: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(ORIGINAL_CWD)
  for (const dir of TEMP_DIRS.splice(0)) {
    rmSync(dir, {force: true, recursive: true})
  }
})

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'splice-devnet',
    networks: {
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ans: {url: 'https://ans.example.com'},
          auth: {issuer: 'https://login.example.com', kind: 'jwt', url: 'https://auth.example.com'},
          ledger: {url: 'https://ledger.example.com'},
          scan: {url: 'https://scan.example.com'},
          tokenStandard: {url: 'https://tokens.example.com'},
          validator: {url: 'https://validator.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createPreflightReport(success: boolean): PreflightReport {
  const auth = createResolvedAuthSummary({
    credentialSource: 'stored',
    operatorCredentialSource: success ? 'stored' : 'missing',
    warnings: success ? ['Keychain token is near expiry.'] : [],
  })
  const profile = {
    experimental: success,
    kind: 'remote-validator' as const,
    name: 'splice-devnet',
  }
  const checks = [
    {
      category: 'scan' as const,
      detail: success ? 'Scan reachable.' : 'Scan failed.',
      endpoint: 'https://scan.example.com',
      name: 'scan',
      status: success ? 'pass' as const : 'fail' as const,
    },
  ]
  const reconcile = {
    runbook: [],
    summary: {failed: 0, info: 0, manualRunbooks: 0, supportedActions: 0, warned: 0},
    supportedActions: [],
  }

  return {
    auth,
    checks,
    compatibility: {failed: success ? 0 : 1, passed: 3, warned: 1},
    drift: [],
    egressIp: success ? '203.0.113.10' : undefined,
    inventory: createInventory(profile),
    network: {
      checklist: ['Confirm egress IP'],
      name: 'splice-devnet',
      reminders: success ? ['DevNet may reset periodically.'] : [],
      resetExpectation: 'resets-expected',
      tier: 'devnet',
    },
    profile,
    reconcile,
    rollout: createPreflightRolloutContract({
      checks,
      profile,
      reconcile,
    }),
    success,
  }
}

function createCanaryReport(success: boolean) {
  return {
    checks: [
      {
        detail: success ? 'Reachable.' : 'Request failed.',
        endpoint: 'https://scan.example.com',
        status: success ? 'pass' : 'fail',
        suite: 'scan',
        warnings: [],
      },
    ],
    profile: {kind: 'remote-validator', name: 'splice-devnet'},
    success,
  }
}

function createDiagnosticsSnapshot() {
  return {
    auth: {envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET', mode: 'env-or-keychain-jwt', source: 'stored'},
    compatibility: {failed: 0, passed: 3, warned: 1},
    health: [{detail: 'Healthy.', endpoint: 'https://scan.example.com/readyz', name: 'scan-readyz', status: 'healthy'}],
    metrics: [{detail: 'Metrics endpoint reachable.', endpoint: 'https://scan.example.com/metrics', service: 'scan', status: 'available'}],
    profile: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet'},
    services: [{endpoint: 'https://scan.example.com', name: 'scan', stability: 'stable-public'}],
    validatorLiveness: {approvedValidatorCount: 1, endpoint: 'https://scan.example.com', sampleSize: 1},
  }
}

function createDiscoverySnapshot() {
  return {
    dsoInfo: {auth_url: 'https://auth.example.com', validator_url: 'https://validator.example.com'},
    scanUrl: 'https://scan.example.com',
    scans: [{url: 'https://scan.example.com'}],
    sequencers: [{id: 'sequencer::1'}],
  }
}

function createPromoteReport(success: boolean): PromotionRolloutResult {
  const advisories: PromotionRolloutResult['advisories'] = success
    ? [{code: 'network-tier', message: 'tier changed', severity: 'warn'}]
    : [{code: 'scan-missing', message: 'scan missing', severity: 'fail'}]

  return {
    advisories,
    from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
    rollout: createPromotionRollout({
      mode: 'plan',
      steps: [
        {
          blockers: [],
          dependencies: [],
          detail: 'splice-devnet -> splice-testnet',
          effect: 'read',
          id: 'inspect-profile-diff',
          owner: 'cantonctl',
          postconditions: [],
          preconditions: [],
          runbook: [],
          status: 'ready',
          title: 'Inspect source and target profiles',
          warnings: advisories
            .filter(advisory => advisory.severity === 'warn')
            .map(advisory => ({code: advisory.code, detail: advisory.message})),
        },
        {
          blockers: success ? [] : [{code: 'scan-missing', detail: 'scan missing'}],
          dependencies: ['inspect-profile-diff'],
          detail: success ? 'Promotion plan is ready for splice-devnet -> splice-testnet.' : undefined,
          effect: 'read',
          id: 'validate-rollout',
          owner: 'cantonctl',
          postconditions: [],
          preconditions: [],
          runbook: [],
          status: success ? 'ready' : 'blocked',
          title: 'Validate rollout gate',
          warnings: [],
        },
      ],
      success,
      warned: advisories.filter(advisory => advisory.severity === 'warn').length,
    }),
    services: [{change: 'changed', from: 'https://scan.devnet.example.com', name: 'scan', to: 'https://scan.testnet.example.com'}],
    success,
    summary: {failed: success ? 0 : 1, info: 0, warned: 0},
    to: {experimental: false, kind: 'remote-validator', name: 'splice-testnet', network: 'splice-testnet', tier: 'testnet'},
  }
}

function createUpgradeReport(success: boolean) {
  return {
    advisories: success ? [{code: 'sponsor-reminder', message: 'confirm secrets', severity: 'warn'}] : [{code: 'auth-material', message: 'missing auth', severity: 'fail'}],
    auth: {envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET', mode: 'env-or-keychain-jwt', source: success ? 'stored' : 'missing'},
    compatibility: {failed: success ? 0 : 1, warned: 1},
    migration: {previousMigrationId: 4, source: 'https://scan.example.com'},
    profile: {kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
    success,
  } as const
}

function createExportedSdkConfig() {
  return {
    auth: {
      envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
      mode: 'env-or-keychain-jwt',
      tokenPlaceholder: '${CANTONCTL_JWT_SPLICE_DEVNET}',
    },
    cip: 'CIP-0103',
    endpoints: {
      authUrl: 'https://auth.example.com',
      dappApiUrl: 'https://validator.example.com',
      ledgerUrl: 'https://ledger.example.com',
      scanUrl: 'https://scan.example.com',
      tokenStandardUrl: 'https://tokens.example.com',
      validatorUrl: 'https://validator.example.com',
      walletGatewayUrl: 'https://validator.example.com',
    },
    notes: ['Use official SDKs.'],
    profile: {kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet'},
    target: 'dapp-sdk',
  } as const
}

function createLocalnetWorkspace() {
  return {
    composeFilePath: '/tmp/quickstart/compose.yaml',
    configDir: '/tmp/quickstart/config',
    env: {SPLICE_VERSION: '0.5.3'},
    envFilePaths: ['/tmp/quickstart/.env'],
    localnetDir: '/tmp/quickstart/docker/modules/localnet',
    makeTargets: {down: 'stop', status: 'status', up: 'start'},
    makefilePath: '/tmp/quickstart/Makefile',
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
          scan: 'http://scan.localhost:4000/api/scan',
          validator: 'http://wallet.localhost:4000/api/validator',
          wallet: 'http://wallet.localhost:4000',
        },
      },
    },
    root: '/tmp/quickstart',
    services: {
      ledger: 'http://canton.localhost:4000/v2',
      scan: 'http://scan.localhost:4000/api/scan',
      validator: 'http://wallet.localhost:4000/api/validator',
      wallet: 'http://wallet.localhost:4000',
    },
  } as const
}

function createReadinessReport(success: boolean): ReadinessReport {
  const preflight = createPreflightReport(success)
  const canaryChecks = [
    {
      detail: success ? 'Stable/public scan endpoint reachable.' : 'Stable/public scan endpoint failed.',
      endpoint: 'https://scan.example.com',
      status: success ? 'pass' as const : 'fail' as const,
      suite: 'scan' as const,
      warnings: success ? [] : ['Scan returned HTTP 500.'],
    },
  ]

  return {
    auth: createResolvedAuthSummary({
      credentialSource: success ? 'stored' : 'missing',
      operatorCredentialSource: success ? 'stored' : 'missing',
      warnings: success ? ['Refresh auth before promotion.'] : [],
    }),
    canary: {
      checks: canaryChecks,
      selectedSuites: ['scan', 'ans'],
      skippedSuites: ['token-standard', 'validator-user'],
      success,
    },
    compatibility: {failed: success ? 0 : 1, passed: 3, warned: 1},
    drift: preflight.drift,
    inventory: preflight.inventory,
    preflight,
    profile: {
      experimental: false,
      kind: 'remote-validator',
      name: 'splice-devnet',
    },
    reconcile: preflight.reconcile,
    rollout: createReadinessRolloutContract({
      canary: {checks: canaryChecks},
      preflight: {
        profile: preflight.profile,
        rollout: preflight.rollout,
      },
    }),
    success,
    summary: {
      failed: success ? 0 : 2,
      passed: success ? 3 : 1,
      skipped: 2,
      warned: success ? 1 : 0,
    },
  } as const
}

function createResolvedAuthSummary(options: {
  credentialSource: 'env' | 'fallback' | 'missing' | 'stored'
  operatorCredentialSource?: 'env' | 'fallback' | 'missing' | 'stored'
  warnings?: string[]
}) {
  return {
    app: {
      credentialSource: options.credentialSource,
      envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
      required: options.credentialSource !== 'fallback',
    },
    credentialSource: options.credentialSource,
    envVarName: 'CANTONCTL_JWT_SPLICE_DEVNET',
    mode: 'env-or-keychain-jwt' as const,
    operator: {
      credentialSource: options.operatorCredentialSource ?? options.credentialSource,
      description: 'Use an explicitly supplied operator JWT for remote control-plane mutations.',
      envVarName: 'CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET',
      prerequisites: ['Store an operator credential explicitly before remote mutations.'],
      required: true,
    },
    warnings: options.warnings ?? [],
  }
}

function createInventory(profile: {
  experimental: boolean
  kind: 'remote-validator'
  name: string
}): RuntimeInventory {
  return {
    capabilities: [],
    drift: [],
    mode: 'profile',
    profile: {
      experimental: profile.experimental,
      kind: profile.kind,
      name: profile.name,
      resolvedFrom: 'argument',
    },
    schemaVersion: 1,
    services: [],
    summary: {
      configuredCapabilities: 0,
      configuredServices: 0,
      driftedCapabilities: 0,
      healthyCapabilities: 0,
      healthyServices: 0,
      unreachableCapabilities: 0,
      unreachableServices: 0,
      warnedCapabilities: 0,
    },
  }
}

function createPromotionRollout(options: {
  mode: 'apply' | 'dry-run' | 'plan'
  steps: Array<{
    blockers: Array<{code: string; detail: string}>
    dependencies: string[]
    detail?: string
    effect: 'read' | 'write'
    id: string
    owner: 'cantonctl' | 'official-stack' | 'operator'
    postconditions: []
    preconditions: []
    runbook: Array<{code: string; detail: string; owner: 'cantonctl' | 'official-stack' | 'operator'; title: string}>
    status: 'blocked' | 'completed' | 'dry-run' | 'failed' | 'manual' | 'pending' | 'ready'
    title: string
    warnings: Array<{code: string; detail: string}>
  }>
  success: boolean
  warned: number
}) {
  return {
    description: 'Promotion workflow',
    mode: options.mode,
    operation: 'promotion',
    partial: false,
    resume: {
      canResume: false,
      checkpoints: [],
      completedStepIds: [],
      nextStepId: undefined,
    },
    steps: options.steps,
    success: options.success,
    summary: {
      blocked: options.steps.filter(step => step.status === 'blocked').length,
      completed: options.steps.filter(step => step.status === 'completed').length,
      dryRun: options.steps.filter(step => step.status === 'dry-run').length,
      failed: options.steps.filter(step => step.status === 'failed').length,
      manual: options.steps.filter(step => step.status === 'manual').length,
      pending: options.steps.filter(step => step.status === 'pending').length,
      ready: options.steps.filter(step => step.status === 'ready').length,
      warned: options.warned,
    },
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

describe('companion command surface', () => {
  it('prints splice template next steps for init in human mode', async () => {
    class TestInit extends Init {
      protected override resolveProjectDir(projectName: string): string {
        return `/tmp/${projectName}`
      }

      protected override scaffoldProject(options: {dir: string; name: string; template: 'splice-token-app' | 'splice-scan-reader' | 'splice-dapp-sdk'}) {
        return {
          files: ['cantonctl.yaml'],
          projectDir: options.dir,
          template: options.template,
        }
      }
    }

    const result = await captureOutput(() => TestInit.run(['demo-app', '--template', 'splice-token-app'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('cantonctl compat check splice-devnet')
  })

  it('runs preflight in human mode and serializes failures in json mode', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const run = vi.fn()
      .mockResolvedValueOnce(createPreflightReport(true))
      .mockResolvedValueOnce(createPreflightReport(false))
    vi.spyOn(preflightChecksModule, 'createPreflightChecks').mockReturnValue({run})

    const human = await captureOutput(() => Preflight.run([], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Profile: splice-devnet')
    expect(human.stdout).toContain('Egress IP: 203.0.113.10')

    const jsonFailure = await captureOutput(() => Preflight.run(['--json'], {root: CLI_ROOT}))
    expect(jsonFailure.error).toBeDefined()
    expect(parseJson(jsonFailure.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({success: false}),
      success: false,
    }))
  })

  it('serializes CantonctlError preflight failures and rethrows unexpected ones', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const createPreflightChecksSpy = vi.spyOn(preflightChecksModule, 'createPreflightChecks')

    createPreflightChecksSpy.mockReturnValueOnce({
      run: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'create config'})),
    })

    const handled = await captureOutput(() => Preflight.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND, suggestion: 'create config'}),
      success: false,
    }))

    createPreflightChecksSpy.mockReturnValueOnce({run: vi.fn().mockRejectedValue(new Error('preflight boom'))})
    await expect(Preflight.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('preflight boom')
  })

  it('runs stable-public canaries in human mode and json mode', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const run = vi.fn()
      .mockResolvedValueOnce(createCanaryReport(true))
      .mockResolvedValueOnce(createCanaryReport(false))
    vi.spyOn(canaryRunModule, 'createCanaryRunner').mockReturnValue({run})

    const human = await captureOutput(() => CanaryStablePublic.run(['--suite', 'scan'], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Profile: splice-devnet')
    expect(human.stdout).toContain('scan')

    const jsonFailure = await captureOutput(() => CanaryStablePublic.run(['--suite', 'scan', '--json'], {root: CLI_ROOT}))
    expect(jsonFailure.error).toBeDefined()
    expect(parseJson(jsonFailure.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({success: false}),
      success: false,
    }))
  })

  it('serializes canary command failures and rethrows unexpected ones', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const createRunnerSpy = vi.spyOn(canaryRunModule, 'createCanaryRunner')

    createRunnerSpy.mockReturnValueOnce({
      run: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'set profile'})),
    })
    const handled = await captureOutput(() => CanaryStablePublic.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    createRunnerSpy.mockReturnValueOnce({run: vi.fn().mockRejectedValue(new Error('canary boom'))})
    await expect(CanaryStablePublic.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('canary boom')
  })

  it('writes diagnostics bundles in human and json modes', async () => {
    const projectDir = createTempDir('cantonctl-diagnostics-')
    process.chdir(projectDir)
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const snapshot = createDiagnosticsSnapshot()
    const collect = vi.fn().mockResolvedValue(snapshot)
    const write = vi.fn()
      .mockResolvedValueOnce({files: [join(projectDir, 'profile.json')], outputDir: join(projectDir, '.cantonctl', 'diagnostics', 'splice-devnet')})
      .mockResolvedValueOnce({files: [join(projectDir, 'bundle.json')], outputDir: join(projectDir, 'artifacts')})
    vi.spyOn(diagnosticsCollectModule, 'createDiagnosticsCollector').mockReturnValue({collect})
    vi.spyOn(diagnosticsBundleModule, 'createDiagnosticsBundleWriter').mockReturnValue({write})

    const human = await captureOutput(() => DiagnosticsBundle.run([], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Diagnostics bundle written to')

    const json = await captureOutput(() => DiagnosticsBundle.run(['--json', '--output', join(projectDir, 'artifacts')], {root: CLI_ROOT}))
    expect(json.error).toBeUndefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        bundle: expect.objectContaining({outputDir: join(projectDir, 'artifacts')}),
        snapshot: expect.objectContaining({profile: expect.objectContaining({name: 'splice-devnet'})}),
      }),
      success: true,
    }))
  })

  it('serializes diagnostics command failures and rethrows unexpected ones', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const createCollectorSpy = vi.spyOn(diagnosticsCollectModule, 'createDiagnosticsCollector')
    vi.spyOn(diagnosticsBundleModule, 'createDiagnosticsBundleWriter').mockReturnValue({
      write: vi.fn(),
    })

    createCollectorSpy.mockReturnValueOnce({
      collect: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'fix config'})),
    })
    const handled = await captureOutput(() => DiagnosticsBundle.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    createCollectorSpy.mockReturnValueOnce({
      collect: vi.fn().mockRejectedValue(new Error('diagnostics boom')),
    })
    await expect(DiagnosticsBundle.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('diagnostics boom')
  })

  it('discovers network metadata in human and json modes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(createDiscoverySnapshot())
      .mockResolvedValueOnce(createDiscoverySnapshot())
    vi.spyOn(discoveryFetchModule, 'createNetworkDiscoveryFetcher').mockReturnValue({fetch})

    const human = await captureOutput(() => DiscoverNetwork.run(['--scan-url', 'https://scan.example.com'], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Connected scans: 1')

    const json = await captureOutput(() => DiscoverNetwork.run(['--scan-url', 'https://scan.example.com', '--json'], {root: CLI_ROOT}))
    expect(json.error).toBeUndefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({scanUrl: 'https://scan.example.com'}),
      success: true,
    }))
  })

  it('serializes discovery command failures and rethrows unexpected ones', async () => {
    const createFetcherSpy = vi.spyOn(discoveryFetchModule, 'createNetworkDiscoveryFetcher')

    createFetcherSpy.mockReturnValueOnce({
      fetch: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'set scan url'})),
    })
    const handled = await captureOutput(() => DiscoverNetwork.run(['--scan-url', 'https://scan.example.com', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    createFetcherSpy.mockReturnValueOnce({
      fetch: vi.fn().mockRejectedValue(new Error('discover boom')),
    })
    await expect(DiscoverNetwork.run(['--scan-url', 'https://scan.example.com', '--json'], {root: CLI_ROOT})).rejects.toThrow('discover boom')
  })

  it('exports SDK config in env and wrapped json modes', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const exported = createExportedSdkConfig()
    const exportConfig = vi.fn()
      .mockResolvedValueOnce(exported)
      .mockResolvedValueOnce(exported)
    vi.spyOn(exportSdkConfigModule, 'createSdkConfigExporter').mockReturnValue({exportConfig})
    vi.spyOn(exportFormattersModule, 'renderSdkConfigEnv').mockReturnValue('SPLICE_AUTH_MODE=env-or-keychain-jwt\n')
    vi.spyOn(exportFormattersModule, 'renderSdkConfigJson').mockReturnValue('{"cip":"CIP-0103"}\n')

    const human = await captureOutput(() => ExportSdkConfig.run(['--target', 'dapp-sdk', '--format', 'env'], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('SPLICE_AUTH_MODE=env-or-keychain-jwt')

    const json = await captureOutput(() => ExportSdkConfig.run(['--target', 'dapp-sdk', '--format', 'json', '--json'], {root: CLI_ROOT}))
    expect(json.error).toBeUndefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        config: expect.objectContaining({cip: 'CIP-0103'}),
        format: 'json',
        rendered: '{"cip":"CIP-0103"}\n',
      }),
      success: true,
    }))
  })

  it('serializes SDK export failures and rethrows unexpected ones', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const createExporterSpy = vi.spyOn(exportSdkConfigModule, 'createSdkConfigExporter')

    createExporterSpy.mockReturnValueOnce({
      exportConfig: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'configure profile'})),
    })
    const handled = await captureOutput(() => ExportSdkConfig.run(['--target', 'dapp-sdk', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    createExporterSpy.mockReturnValueOnce({
      exportConfig: vi.fn().mockRejectedValue(new Error('export boom')),
    })
    await expect(ExportSdkConfig.run(['--target', 'dapp-sdk', '--json'], {root: CLI_ROOT})).rejects.toThrow('export boom')
  })

  it('imports scan-derived profiles in human mode and writes config in json mode', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(createDiscoverySnapshot())
      .mockResolvedValueOnce(createDiscoverySnapshot())
      .mockResolvedValueOnce(createDiscoverySnapshot())
    vi.spyOn(discoveryFetchModule, 'createNetworkDiscoveryFetcher').mockReturnValue({fetch})

    const human = await captureOutput(() => ProfilesImportScan.run([
      '--scan-url',
      'https://scan.example.com',
      '--kind',
      'remote-validator',
      '--name',
      'imported-validator',
    ], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('imported-validator')

    const projectDir = createTempDir('cantonctl-import-scan-')
    writeFileSync(join(projectDir, 'cantonctl.yaml'), 'version: 1\nprofiles:\n  sandbox:\n    kind: sandbox\n', 'utf8')
    process.chdir(projectDir)

    const humanWrite = await captureOutput(() => ProfilesImportScan.run([
      '--scan-url',
      'https://scan.example.com',
      '--kind',
      'remote-sv-network',
      '--name',
      'written-human',
      '--write',
    ], {root: CLI_ROOT}))
    expect(humanWrite.error).toBeUndefined()
    expect(humanWrite.stdout).toContain('Wrote written-human to')

    const json = await captureOutput(() => ProfilesImportScan.run([
      '--json',
      '--scan-url',
      'https://scan.example.com',
      '--kind',
      'remote-sv-network',
      '--name',
      'imported-sv',
      '--write',
    ], {root: CLI_ROOT}))
    expect(json.error).toBeUndefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        configPath: expect.stringMatching(/cantonctl\.yaml$/),
        profileName: 'imported-sv',
        write: true,
      }),
      success: true,
    }))
    expect(readFileSync(join(projectDir, 'cantonctl.yaml'), 'utf8')).toContain('imported-sv')
  })

  it('serializes import-scan config errors and rethrows unexpected ones', async () => {
    const projectDir = createTempDir('cantonctl-import-scan-missing-')
    process.chdir(projectDir)
    vi.spyOn(discoveryFetchModule, 'createNetworkDiscoveryFetcher').mockReturnValue({
      fetch: vi.fn().mockResolvedValue(createDiscoverySnapshot()),
    })

    const handled = await captureOutput(() => ProfilesImportScan.run([
      '--json',
      '--scan-url',
      'https://scan.example.com',
      '--kind',
      'remote-validator',
      '--write',
    ], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    vi.restoreAllMocks()
    vi.spyOn(discoveryFetchModule, 'createNetworkDiscoveryFetcher').mockReturnValue({
      fetch: vi.fn().mockRejectedValue(new Error('import boom')),
    })
    await expect(ProfilesImportScan.run([
      '--json',
      '--scan-url',
      'https://scan.example.com',
      '--kind',
      'remote-validator',
    ], {root: CLI_ROOT})).rejects.toThrow('import boom')
  })

  it('imports LocalNet workspaces in human mode and writes config in json mode', async () => {
    const workspace = createLocalnetWorkspace()

    class TestProfilesImportLocalnet extends ProfilesImportLocalnet {
      protected override createDetector() {
        return {
          detect: vi.fn().mockResolvedValue(workspace),
        }
      }
    }

    const human = await captureOutput(() => TestProfilesImportLocalnet.run([
      '--workspace',
      '../quickstart',
    ], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Workspace: /tmp/quickstart')
    expect(human.stdout).toContain('Imported sv as profile "splice-localnet" and network "localnet"')
    expect(human.stdout).toContain('kind: splice-localnet')

    const projectDir = createTempDir('cantonctl-import-localnet-')
    writeFileSync(join(projectDir, 'cantonctl.yaml'), [
      'version: 1',
      'project:',
      '  name: demo',
      '  sdk-version: "3.4.11"',
      'profiles:',
      '  sandbox:',
      '    kind: sandbox',
      '    ledger:',
      '      port: 5001',
    ].join('\n'), 'utf8')
    process.chdir(projectDir)

    const json = await captureOutput(() => TestProfilesImportLocalnet.run([
      '--workspace',
      '../quickstart',
      '--write',
      '--json',
    ], {root: CLI_ROOT}))
    expect(json.error).toBeUndefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        configPath: expect.stringMatching(/cantonctl\.yaml$/),
        networkName: 'localnet',
        profileName: 'splice-localnet',
        sourceProfile: 'sv',
        workspace: '/tmp/quickstart',
        write: true,
      }),
      success: true,
    }))
    expect(readFileSync(join(projectDir, 'cantonctl.yaml'), 'utf8')).toContain('splice-localnet')
    expect(readFileSync(join(projectDir, 'cantonctl.yaml'), 'utf8')).toContain('localnet:')
  })

  it('serializes import-localnet config errors and rethrows unexpected ones', async () => {
    const workspace = createLocalnetWorkspace()

    class TestProfilesImportLocalnet extends ProfilesImportLocalnet {
      protected override createDetector() {
        return {
          detect: vi.fn().mockResolvedValue(workspace),
        }
      }
    }

    const projectDir = createTempDir('cantonctl-import-localnet-missing-')
    process.chdir(projectDir)

    const handled = await captureOutput(() => TestProfilesImportLocalnet.run([
      '--workspace',
      '../quickstart',
      '--write',
      '--json',
    ], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    vi.restoreAllMocks()
    vi.spyOn(localnetImportModule, 'synthesizeProfileFromLocalnetWorkspace').mockImplementation(() => {
      throw new Error('import-localnet boom')
    })

    class BrokenProfilesImportLocalnet extends ProfilesImportLocalnet {
      protected override createDetector() {
        return {
          detect: vi.fn().mockResolvedValue(workspace),
        }
      }
    }

    await expect(BrokenProfilesImportLocalnet.run([
      '--workspace',
      '../quickstart',
      '--json',
    ], {root: CLI_ROOT})).rejects.toThrow('import-localnet boom')
  })

  it('runs readiness in human mode and serializes failures in json mode', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const run = vi.fn()
      .mockResolvedValueOnce(createReadinessReport(true))
      .mockResolvedValueOnce(createReadinessReport(false))
    vi.spyOn(readinessModule, 'createReadinessRunner').mockReturnValue({run})

    const human = await captureOutput(() => Readiness.run([], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Profile: splice-devnet')
    expect(human.stdout).toContain('Canary suites: scan, ans')
    expect(human.stdout).toContain('Readiness passed')

    const jsonFailure = await captureOutput(() => Readiness.run(['--json'], {root: CLI_ROOT}))
    expect(jsonFailure.error).toBeDefined()
    expect(parseJson(jsonFailure.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({success: false}),
      success: false,
    }))
  })

  it('serializes readiness command failures and rethrows unexpected ones', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const createRunnerSpy = vi.spyOn(readinessModule, 'createReadinessRunner')

    createRunnerSpy.mockReturnValueOnce({
      run: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'set profile'})),
    })
    const handled = await captureOutput(() => Readiness.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    createRunnerSpy.mockReturnValueOnce({run: vi.fn().mockRejectedValue(new Error('readiness boom'))})
    await expect(Readiness.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('readiness boom')
  })

  it('renders promotion diffs in human mode and fails in json mode', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const run = vi.fn()
      .mockResolvedValueOnce(createPromoteReport(true))
      .mockResolvedValueOnce(createPromoteReport(false))
    vi.spyOn(promotionRolloutModule, 'createPromotionRunner').mockReturnValue({run})

    const human = await captureOutput(() => PromoteDiff.run(['--from', 'splice-devnet', '--to', 'splice-testnet'], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('From: splice-devnet (devnet)')
    expect(human.stdout).toContain('Mode: plan')
    expect(human.stdout).toContain('network-tier')

    const json = await captureOutput(() => PromoteDiff.run(['--from', 'splice-devnet', '--to', 'splice-testnet', '--json'], {root: CLI_ROOT}))
    expect(json.error).toBeDefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({success: false}),
      success: false,
    }))
  })

  it('renders placeholder service values when promotion diffs omit before/after endpoints', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    vi.spyOn(promotionRolloutModule, 'createPromotionRunner').mockReturnValue({
      run: vi.fn().mockResolvedValue({
        advisories: [],
        from: {experimental: false, kind: 'remote-validator', name: 'splice-devnet', network: 'splice-devnet', tier: 'devnet'},
        rollout: createPromotionRollout({
          mode: 'plan',
          steps: [{
            blockers: [],
            dependencies: [],
            detail: 'Promotion plan is ready for splice-devnet -> team-devnet.',
            effect: 'read',
            id: 'validate-rollout',
            owner: 'cantonctl',
            postconditions: [],
            preconditions: [],
            runbook: [],
            status: 'ready',
            title: 'Validate rollout gate',
            warnings: [],
          }],
          success: true,
          warned: 0,
        }),
        services: [{change: 'added', name: 'scan'}],
        success: true,
        summary: {failed: 0, info: 0, warned: 0},
        to: {experimental: false, kind: 'remote-validator', name: 'splice-devnet-2', network: 'team-devnet', tier: 'devnet'},
      }),
    })

    const result = await captureOutput(() => PromoteDiff.run(['--from', 'splice-devnet', '--to', 'team-devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('-')
    expect(result.stdout).not.toContain('Severity')
  })

  it('serializes promote diff failures and rethrows unexpected ones', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const createRunnerSpy = vi.spyOn(promotionRolloutModule, 'createPromotionRunner')

    createRunnerSpy.mockReturnValueOnce({
      run: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'add profiles'})),
    })
    const handled = await captureOutput(() => PromoteDiff.run(['--from', 'a', '--to', 'b', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    createRunnerSpy.mockReturnValueOnce({
      run: vi.fn().mockRejectedValue(new Error('promote boom')),
    })
    await expect(PromoteDiff.run(['--from', 'a', '--to', 'b', '--json'], {root: CLI_ROOT})).rejects.toThrow('promote boom')
  })

  it('passes explicit promotion modes through to the runner and rejects conflicting flags', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const run = vi.fn()
      .mockResolvedValueOnce(createPromoteReport(true))
      .mockResolvedValueOnce(createPromoteReport(true))
    vi.spyOn(promotionRolloutModule, 'createPromotionRunner').mockReturnValue({run})

    const dryRun = await captureOutput(() => PromoteDiff.run([
      '--from',
      'splice-devnet',
      '--to',
      'splice-testnet',
      '--dry-run',
      '--json',
    ], {root: CLI_ROOT}))
    expect(dryRun.error).toBeUndefined()
    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({mode: 'dry-run'}))

    const apply = await captureOutput(() => PromoteDiff.run([
      '--from',
      'splice-devnet',
      '--to',
      'splice-testnet',
      '--apply',
      '--json',
    ], {root: CLI_ROOT}))
    expect(apply.error).toBeUndefined()
    expect(run).toHaveBeenNthCalledWith(2, expect.objectContaining({mode: 'apply'}))

    const conflicting = await captureOutput(() => PromoteDiff.run([
      '--from',
      'splice-devnet',
      '--to',
      'splice-testnet',
      '--plan',
      '--dry-run',
      '--json',
    ], {root: CLI_ROOT}))
    expect(conflicting.error).toBeDefined()
    expect(parseJson(conflicting.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))
  })

  it('renders live promotion gate status, runbooks, and failure summaries', () => {
    const out = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }

    renderPromotionRollout(out, {
      ...createPromoteReport(false),
      preflight: createPreflightReport(false),
      readiness: createReadinessReport(false),
      rollout: createPromotionRollout({
        mode: 'dry-run',
        steps: [
          {
            blockers: [{code: 'scan-missing', detail: 'Blocked by target gate'}],
            dependencies: [],
            effect: 'read',
            id: 'inspect-target-preflight',
            owner: 'cantonctl',
            postconditions: [],
            preconditions: [],
            runbook: [],
            status: 'blocked',
            title: 'Inspect target preflight gate',
            warnings: [{code: 'target-warning', detail: 'Investigate target drift'}],
          },
          {
            blockers: [],
            dependencies: ['inspect-target-preflight'],
            effect: 'write',
            id: 'manual-promotion-runbook',
            owner: 'official-stack',
            postconditions: [],
            preconditions: [],
            runbook: [{
              code: 'manual-cutover',
              detail: 'Follow the official cutover runbook.',
              owner: 'official-stack',
              title: 'Manual cutover',
            }],
            status: 'manual',
            title: 'Review manual promotion runbook',
            warnings: [],
          },
        ],
        success: false,
        warned: 1,
      }),
      success: false,
    })

    expect(out.log).toHaveBeenCalledWith('Target preflight: fail')
    expect(out.log).toHaveBeenCalledWith('Target readiness: fail')
    expect(out.warn).toHaveBeenCalledWith('Inspect target preflight gate: Investigate target drift')
    expect(out.info).toHaveBeenCalledWith('Manual cutover: Follow the official cutover runbook.')
    expect(out.error).toHaveBeenCalledWith('Promotion rollout found blocking issues.')
    expect(out.table).toHaveBeenCalledWith(
      ['Step', 'Status', 'Owner', 'Detail'],
      expect.arrayContaining([
        ['Inspect target preflight gate', 'blocked', 'cantonctl', 'Blocked by target gate'],
        ['Review manual promotion runbook', 'manual', 'official-stack', '-'],
      ]),
    )
  })

  it('skips advisory and rollout tables when the promotion report is empty beyond services', () => {
    const out = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }

    renderPromotionRollout(out, {
      ...createPromoteReport(true),
      advisories: [],
      rollout: createPromotionRollout({
        mode: 'plan',
        steps: [],
        success: true,
        warned: 0,
      }),
    })

    expect(out.table).toHaveBeenCalledTimes(1)
    expect(out.success).toHaveBeenCalledWith('Promotion plan completed.')
  })

  it('renders successful live promotion summaries with passing target gates', () => {
    const out = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }

    renderPromotionRollout(out, {
      ...createPromoteReport(true),
      preflight: createPreflightReport(true),
      readiness: createReadinessReport(true),
      rollout: createPromotionRollout({
        mode: 'apply',
        steps: [{
          blockers: [],
          dependencies: [],
          detail: 'Live rollout gates passed.',
          effect: 'read',
          id: 'validate-rollout',
          owner: 'cantonctl',
          postconditions: [],
          preconditions: [],
          runbook: [],
          status: 'completed',
          title: 'Validate rollout gate',
          warnings: [],
        }],
        success: true,
        warned: 0,
      }),
      success: true,
    })

    expect(out.log).toHaveBeenCalledWith('Target preflight: pass')
    expect(out.log).toHaveBeenCalledWith('Target readiness: pass')
    expect(out.success).toHaveBeenCalledWith('Promotion rollout completed.')
  })

  it('renders reset checklists in human and json modes', async () => {
    const createChecklist = vi.fn()
      .mockReturnValueOnce({
        checklist: [{severity: 'warn', text: 'Confirm reset schedule.'}],
        network: 'devnet',
        resetExpectation: 'resets-expected',
      })
      .mockReturnValueOnce({
        checklist: [{severity: 'info', text: 'No reset expected.'}],
        network: 'mainnet',
        resetExpectation: 'no-resets-expected',
      })
    vi.spyOn(lifecycleResetModule, 'createResetHelper').mockReturnValue({createChecklist})

    const human = await captureOutput(() => ResetChecklist.run(['--network', 'devnet'], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Reset expectation: resets-expected')

    const json = await captureOutput(() => ResetChecklist.run(['--network', 'mainnet', '--json'], {root: CLI_ROOT}))
    expect(json.error).toBeUndefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({network: 'mainnet'}),
      success: true,
    }))
  })

  it('renders upgrade checks in human mode and serializes failures in json mode', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const check = vi.fn()
      .mockResolvedValueOnce(createUpgradeReport(true))
      .mockResolvedValueOnce(createUpgradeReport(false))
    vi.spyOn(lifecycleUpgradeModule, 'createUpgradeChecker').mockReturnValue({check})

    const human = await captureOutput(() => UpgradeCheck.run([], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Profile: splice-devnet (devnet)')

    const json = await captureOutput(() => UpgradeCheck.run(['--json'], {root: CLI_ROOT}))
    expect(json.error).toBeDefined()
    expect(parseJson(json.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({success: false}),
      success: false,
    }))
  })

  it('serializes upgrade command failures and rethrows unexpected ones', async () => {
    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const createCheckerSpy = vi.spyOn(lifecycleUpgradeModule, 'createUpgradeChecker')

    createCheckerSpy.mockReturnValueOnce({
      check: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.CONFIG_NOT_FOUND, {suggestion: 'set auth'})),
    })
    const handled = await captureOutput(() => UpgradeCheck.run(['--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_NOT_FOUND}),
      success: false,
    }))

    createCheckerSpy.mockReturnValueOnce({
      check: vi.fn().mockRejectedValue(new Error('upgrade boom')),
    })
    await expect(UpgradeCheck.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('upgrade boom')
  })

  it('writes imported LocalNet profiles and wires the default workspace detector', async () => {
    class HumanImportLocalnet extends ProfilesImportLocalnet {
      protected override createDetector() {
        return {
          detect: vi.fn().mockResolvedValue(createLocalnetWorkspace()),
        }
      }
    }

    class DetectorHarness extends ProfilesImportLocalnet {
      public callCreateDetector() {
        return this.createDetector()
      }

      public async run(): Promise<void> {}
    }

    const projectDir = createTempDir('cantonctl-import-localnet-human-')
    const configPath = join(projectDir, 'cantonctl.yaml')
    writeFileSync(configPath, [
      'version: 1',
      'project:',
      '  name: demo',
      '  sdk-version: "3.4.11"',
    ].join('\n'))

    process.chdir(projectDir)
    const human = await captureOutput(() => HumanImportLocalnet.run([
      '--workspace',
      '../quickstart',
      '--write',
    ], {root: CLI_ROOT}))
    expect(human.error).toBeUndefined()
    expect(human.stdout).toContain('Updated ')
    expect(human.stdout).toContain('cantonctl.yaml')

    let capturedDeps: Parameters<typeof localnetWorkspaceModule.createLocalnetWorkspaceDetector>[0] | undefined
    vi.spyOn(localnetWorkspaceModule, 'createLocalnetWorkspaceDetector').mockImplementation((deps) => {
      capturedDeps = deps
      return {detect: vi.fn()} as never
    })

    const harness = new DetectorHarness([], {} as never)
    harness.callCreateDetector()

    const tempDir = createTempDir('cantonctl-detector-')
    const tempFile = join(tempDir, 'probe.txt')
    writeFileSync(tempFile, 'probe', 'utf8')

    await expect(capturedDeps?.access(tempFile)).resolves.toBeUndefined()
    await expect(capturedDeps?.readFile(tempFile)).resolves.toBe('probe')
  })

  it('renders readiness warning details and summary pluralization', () => {
    const failureWriter = {
      error: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }
    const failurePreflightChecks = [{
      category: 'auth' as const,
      detail: 'Credential missing.',
      name: 'Credential material',
      status: 'fail' as const,
    }]
    const failurePreflight = {
      ...createPreflightReport(false),
      auth: createResolvedAuthSummary({
        credentialSource: 'stored',
        operatorCredentialSource: 'missing',
        warnings: ['Auth warning'],
      }),
      checks: failurePreflightChecks,
      compatibility: {failed: 1, passed: 1, warned: 0},
      rollout: createPreflightRolloutContract({
        checks: failurePreflightChecks,
        profile: createPreflightReport(false).profile,
        reconcile: createPreflightReport(false).reconcile,
      }),
    }
    const failureCanaryChecks = [{
      detail: 'Request failed.',
      status: 'fail' as const,
      suite: 'scan' as const,
      warnings: ['Latency spike'],
    }]
    renderReadinessReport(failureWriter as never, {
      auth: failurePreflight.auth,
      canary: {
        checks: failureCanaryChecks,
        selectedSuites: ['scan'],
        skippedSuites: ['ans', 'token-standard', 'validator-user'],
        success: false,
      },
      compatibility: failurePreflight.compatibility,
      drift: [],
      inventory: failurePreflight.inventory,
      preflight: failurePreflight,
      profile: failurePreflight.profile,
      reconcile: failurePreflight.reconcile,
      rollout: createReadinessRolloutContract({
        canary: {checks: failureCanaryChecks},
        preflight: {
          profile: failurePreflight.profile,
          rollout: failurePreflight.rollout,
        },
      }),
      success: false,
      summary: {
        failed: 2,
        passed: 0,
        skipped: 3,
        warned: 1,
      },
    })

    expect(failureWriter.warn).toHaveBeenCalledWith('Auth warning')
    expect(failureWriter.warn).toHaveBeenCalledWith('scan: Latency spike')
    expect(failureWriter.error).toHaveBeenCalledWith('Readiness found blocking issues.')

    const successWriter = {
      error: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }
    const successPreflightChecks = [{
      category: 'profile' as const,
      detail: 'Resolved.',
      name: 'Profile resolution',
      status: 'pass' as const,
    }]
    const successPreflight = {
      ...createPreflightReport(true),
      auth: createResolvedAuthSummary({
        credentialSource: 'stored',
        operatorCredentialSource: 'stored',
      }),
      checks: successPreflightChecks,
      compatibility: {failed: 0, passed: 2, warned: 0},
      rollout: createPreflightRolloutContract({
        checks: successPreflightChecks,
        profile: createPreflightReport(true).profile,
        reconcile: createPreflightReport(true).reconcile,
      }),
    }

    renderReadinessReport(successWriter as never, {
      auth: successPreflight.auth,
      canary: {
        checks: [],
        selectedSuites: [],
        skippedSuites: ['scan'],
        success: true,
      },
      compatibility: successPreflight.compatibility,
      drift: [],
      inventory: successPreflight.inventory,
      preflight: successPreflight,
      profile: successPreflight.profile,
      reconcile: successPreflight.reconcile,
      rollout: createReadinessRolloutContract({
        canary: {checks: []},
        preflight: {
          profile: successPreflight.profile,
          rollout: successPreflight.rollout,
        },
      }),
      success: true,
      summary: {
        failed: 0,
        passed: 1,
        skipped: 1,
        warned: 2,
      },
    })

    expect(successWriter.log).toHaveBeenCalledWith('Canary suites: none')
    expect(successWriter.success).toHaveBeenCalledWith(
      'Readiness passed with 2 warnings and 1 skipped item.',
    )
  })
})
