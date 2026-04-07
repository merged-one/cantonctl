import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import PromoteDiff from '../../src/commands/promote/diff.js'
import ResetChecklist from '../../src/commands/reset/checklist.js'
import UpgradeCheck from '../../src/commands/upgrade/check.js'
import {createCanaryRunner} from '../../src/lib/canary/run.js'
import {createInMemoryBackend} from '../../src/lib/credential-store.js'
import {createPreflightChecks} from '../../src/lib/preflight/checks.js'
import {createProfileRuntimeResolver} from '../../src/lib/profile-runtime.js'
import {createReadinessRunner} from '../../src/lib/readiness.js'
import {createLifecycleDiff} from '../../src/lib/lifecycle/diff.js'
import {createResetRunner} from '../../src/lib/lifecycle/reset.js'
import {createPromotionRunner} from '../../src/lib/promotion-rollout.js'
import {createUpgradeRunner} from '../../src/lib/lifecycle/upgrade.js'

const CLI_ROOT = process.cwd()

interface MockServer {
  close(): Promise<void>
  url: string
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function writeConfig(projectDir: string, contents: string): void {
  fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), contents)
}

async function startServer(
  handler: (pathname: string) => {body: unknown; status?: number},
): Promise<MockServer> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const result = handler(url.pathname)
    response.statusCode = result.status ?? 200
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(result.body))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  return {
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
    url: `http://127.0.0.1:${address.port}`,
  }
}

async function runInProject(
  projectDir: string,
  command: typeof PromoteDiff | typeof UpgradeCheck | typeof ResetChecklist,
  args: string[],
): Promise<{error?: Error; stderr: string; stdout: string}> {
  const cwd = process.cwd
  Object.defineProperty(process, 'cwd', {
    configurable: true,
    value: () => projectDir,
  })

  try {
    return await captureOutput(() => command.run(args, {root: CLI_ROOT}))
  } finally {
    Object.defineProperty(process, 'cwd', {
      configurable: true,
      value: cwd.bind(process),
    })
  }
}

function createPromoteHarness(env: Record<string, string | undefined>): typeof PromoteDiff {
  return class TestPromoteDiff extends PromoteDiff {
    protected override createPromotionRunner() {
      const createResolver = () => createProfileRuntimeResolver({
        createBackendWithFallback: async () => ({backend: createInMemoryBackend(), isKeychain: false}),
        env,
      })

      return createPromotionRunner({
        createLifecycleDiff: () => createLifecycleDiff({
          createProfileRuntimeResolver: createResolver,
        }),
        createPreflightRunner: () => createPreflightChecks({
          createProfileRuntimeResolver: createResolver,
        }),
        createReadinessRunner: () => createReadinessRunner({
          createCanaryRunner: () => createCanaryRunner({
            createProfileRuntimeResolver: createResolver,
          }),
          createPreflightRunner: () => createPreflightChecks({
            createProfileRuntimeResolver: createResolver,
          }),
        }),
      })
    }
  }
}

function createUpgradeHarness(env: Record<string, string | undefined>): typeof UpgradeCheck {
  return class TestUpgradeCheck extends UpgradeCheck {
    protected override createUpgradeRunner() {
      return createUpgradeRunner({
        createProfileRuntimeResolver: () => createProfileRuntimeResolver({
          createBackendWithFallback: async () => ({backend: createInMemoryBackend(), isKeychain: false}),
          env,
        }),
      })
    }
  }
}

function createLifecycleReadinessReport(success: boolean) {
  return {
    auth: {scope: 'app', source: 'stored', warnings: []},
    canary: {checks: [], selectedSuites: [], skippedSuites: [], success},
    compatibility: {failed: 0, warned: 0},
    drift: [],
    inventory: {
      capabilities: [],
      mode: 'profile',
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
      drift: [],
    },
    preflight: {
      auth: {scope: 'app', source: 'stored', warnings: []},
      checks: [],
      compatibility: {failed: 0, warned: 0},
      drift: [],
      inventory: {
        capabilities: [],
        mode: 'profile',
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
        drift: [],
      },
      profile: {kind: 'splice-localnet', name: 'splice-localnet'},
      reconcile: {runbook: [], summary: {failed: 0, info: 0, manualRunbooks: 0, supportedActions: 0, warned: 0}, supportedActions: []},
      rollout: {
        mode: 'dry-run',
        operation: 'readiness',
        partial: false,
        resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
        steps: [],
        success,
        summary: {blocked: 0, completed: 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
      },
      success,
      summary: {failed: 0, passed: 0, skipped: 0, warned: 0},
    },
    profile: {kind: 'splice-localnet', name: 'splice-localnet'},
    reconcile: {runbook: [], summary: {failed: 0, info: 0, manualRunbooks: 0, supportedActions: 0, warned: 0}, supportedActions: []},
    rollout: {
      mode: 'dry-run',
      operation: 'readiness',
      partial: false,
      resume: {canResume: false, checkpoints: [], completedStepIds: [], nextStepId: undefined},
      steps: [],
      success,
      summary: {blocked: 0, completed: 0, dryRun: 0, failed: 0, manual: 0, pending: 0, ready: 0, warned: 0},
    },
    success,
    summary: {failed: 0, passed: 0, skipped: 0, warned: 0},
  } as const
}

function createLocalnetHarnesses() {
  const localnet = {
    down: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({
      containers: [],
      health: {validatorReadyz: {body: 'ok', healthy: true, status: 200, url: 'http://validator.localhost:3003/readyz'}},
      profiles: {
        'app-provider': {
          health: {validatorReadyz: 'http://validator.localhost:3003/readyz'},
          name: 'app-provider' as const,
          urls: {
            ledger: 'http://ledger.localhost:3001',
            scan: 'http://scan.localhost:3012',
            validator: 'http://validator.localhost:3003',
            wallet: 'http://wallet.localhost:3000',
          },
        },
        'app-user': {
          health: {validatorReadyz: 'http://validator.localhost:2003/readyz'},
          name: 'app-user' as const,
          urls: {
            ledger: 'http://ledger.localhost:2001',
            validator: 'http://validator.localhost:2003',
            wallet: 'http://wallet.localhost:2000',
          },
        },
        sv: {
          health: {validatorReadyz: 'http://validator.localhost:5003/readyz'},
          name: 'sv' as const,
          urls: {
            ledger: 'http://ledger.localhost:5001',
            scan: 'http://scan.localhost:5012',
            validator: 'http://validator.localhost:5003',
            wallet: 'http://wallet.localhost:5000',
          },
        },
      },
      selectedProfile: 'sv' as const,
      services: {
        ledger: {url: 'http://ledger.localhost:5001'},
        scan: {url: 'http://scan.localhost:5012'},
        validator: {url: 'http://validator.localhost:5003'},
        wallet: {url: 'http://wallet.localhost:5000'},
      },
      workspace: {
        composeFilePath: '/workspace/compose.yaml',
        configDir: '/workspace/docker/modules/localnet/conf',
        env: {SPLICE_VERSION: '0.5.0'},
        localnetDir: '/workspace/docker/modules/localnet',
        makeTargets: {down: 'stop', status: 'status', up: 'start'},
        profiles: {} as never,
        root: '/workspace',
      },
    }),
    up: vi.fn().mockResolvedValue({
      containers: [],
      health: {validatorReadyz: {body: 'ok', healthy: true, status: 200, url: 'http://validator.localhost:3003/readyz'}},
      profiles: {} as never,
      selectedProfile: 'app-provider' as const,
      services: {
        ledger: {url: 'http://ledger.localhost:3001'},
        scan: {url: 'http://scan.localhost:3012'},
        validator: {url: 'http://validator.localhost:3003'},
        wallet: {url: 'http://wallet.localhost:3000'},
      },
      workspace: {
        composeFilePath: '/workspace/compose.yaml',
        configDir: '/workspace/docker/modules/localnet/conf',
        env: {SPLICE_VERSION: '0.5.0'},
        localnetDir: '/workspace/docker/modules/localnet',
        makeTargets: {down: 'stop', status: 'status', up: 'start'},
        profiles: {} as never,
        root: '/workspace',
      },
    }),
  } as const
  const readiness = {run: vi.fn().mockResolvedValue(createLifecycleReadinessReport(true))}
  const env = {CANTONCTL_JWT_SPLICE_LOCALNET: 'localnet-token'}

  class LocalnetUpgradeHarness extends UpgradeCheck {
    protected override createReadinessRunner() {
      return readiness as never
    }

    protected override createLocalnet() {
      return localnet as never
    }

    protected override createUpgradeRunner() {
      return createUpgradeRunner({
        createLocalnet: () => localnet as never,
        createProfileRuntimeResolver: () => createProfileRuntimeResolver({
          createBackendWithFallback: async () => ({backend: createInMemoryBackend(), isKeychain: false}),
          env,
        }),
        createReadinessRunner: () => readiness as never,
      })
    }
  }

  class LocalnetResetHarness extends ResetChecklist {
    protected override createReadinessRunner() {
      return readiness as never
    }

    protected override createLocalnet() {
      return localnet as never
    }

    protected override createResetRunner() {
      return createResetRunner({
        createLocalnet: () => localnet as never,
        createProfileRuntimeResolver: () => createProfileRuntimeResolver({
          createBackendWithFallback: async () => ({backend: createInMemoryBackend(), isKeychain: false}),
          env,
        }),
        createReadinessRunner: () => readiness as never,
      })
    }
  }

  return {LocalnetResetHarness, LocalnetUpgradeHarness, localnet, readiness}
}

describe('lifecycle E2E', () => {
  let projectDir: string
  let scanServer: MockServer
  let workDir: string

  beforeAll(async () => {
    scanServer = await startServer((pathname) => {
      if (pathname === '/v0/dso') {
        return {body: {migration_id: 7, previous_migration_id: 6, sv_party_id: 'sv::1'}}
      }

      if (pathname === '/v0/ans-entries') {
        return {body: {entries: []}}
      }

      return {body: {error: 'not found'}, status: 404}
    })

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-lifecycle-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

project:
  name: lifecycle-e2e
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${scanServer.url}
    ledger:
      url: https://ledger.devnet.example.com
    scan:
      url: ${scanServer.url}
  splice-testnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${scanServer.url}
    ledger:
      url: https://ledger.testnet.example.com
    scan:
      url: ${scanServer.url}
  splice-mainnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${scanServer.url}
    ledger:
      url: https://ledger.mainnet.example.com
    scan:
      url: ${scanServer.url}
  splice-localnet:
    kind: splice-localnet
    auth:
      kind: jwt
      url: ${scanServer.url}
    ledger:
      url: http://ledger.localhost:3001
    localnet:
      version: "0.5.0"
    scan:
      url: http://scan.localhost:3012
    validator:
      url: http://validator.localhost:3003
  incomplete-mainnet:
    kind: remote-validator
    ledger:
      url: https://ledger.mainnet.example.com
`,
    )
  })

  afterAll(async () => {
    await scanServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('diffs DevNet to TestNet promotions', async () => {
    const CommandHarness = createPromoteHarness({
      CANTONCTL_JWT_SPLICE_DEVNET: 'devnet-token',
      CANTONCTL_JWT_SPLICE_TESTNET: 'testnet-token',
    })
    const result = await runInProject(projectDir, CommandHarness, ['--from', 'splice-devnet', '--to', 'splice-testnet', '--json'])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      from: expect.objectContaining({tier: 'devnet'}),
      to: expect.objectContaining({tier: 'testnet'}),
      advisories: expect.arrayContaining([
        expect.objectContaining({code: 'reset-sensitive', severity: 'warn'}),
      ]),
    }))
  })

  it('diffs TestNet to MainNet promotions with mainnet continuity guidance', async () => {
    const CommandHarness = createPromoteHarness({
      CANTONCTL_JWT_SPLICE_TESTNET: 'testnet-token',
      CANTONCTL_JWT_SPLICE_MAINNET: 'mainnet-token',
    })
    const result = await runInProject(projectDir, CommandHarness, ['--from', 'splice-testnet', '--to', 'splice-mainnet', '--json'])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      from: expect.objectContaining({tier: 'testnet'}),
      to: expect.objectContaining({tier: 'mainnet'}),
      advisories: expect.arrayContaining([
        expect.objectContaining({code: 'migration-policy', severity: 'info'}),
      ]),
    }))
  })

  it('executes live promotion gates in dry-run mode', async () => {
    const CommandHarness = createPromoteHarness({
      CANTONCTL_JWT_SPLICE_DEVNET: 'devnet-token',
      CANTONCTL_JWT_SPLICE_TESTNET: 'testnet-token',
      CANTONCTL_OPERATOR_TOKEN_SPLICE_TESTNET: 'testnet-operator-token',
    })
    const result = await runInProject(projectDir, CommandHarness, [
      '--from',
      'splice-devnet',
      '--to',
      'splice-testnet',
      '--dry-run',
      '--json',
    ])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      preflight: expect.objectContaining({success: true}),
      readiness: expect.objectContaining({success: true}),
      rollout: expect.objectContaining({
        mode: 'dry-run',
        steps: expect.arrayContaining([
          expect.objectContaining({status: 'completed', title: 'Inspect target preflight gate'}),
          expect.objectContaining({status: 'completed', title: 'Inspect target readiness gate'}),
          expect.objectContaining({status: 'manual', title: 'Review manual promotion runbook'}),
          expect.objectContaining({status: 'completed', title: 'Validate rollout gate'}),
        ]),
      }),
    }))
  })

  it('executes apply-mode promotion gates with the same rollout contract', async () => {
    const CommandHarness = createPromoteHarness({
      CANTONCTL_JWT_SPLICE_DEVNET: 'devnet-token',
      CANTONCTL_JWT_SPLICE_TESTNET: 'testnet-token',
      CANTONCTL_OPERATOR_TOKEN_SPLICE_TESTNET: 'testnet-operator-token',
    })
    const result = await runInProject(projectDir, CommandHarness, [
      '--from',
      'splice-devnet',
      '--to',
      'splice-testnet',
      '--apply',
      '--json',
    ])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      rollout: expect.objectContaining({
        mode: 'apply',
        success: true,
        steps: expect.arrayContaining([
          expect.objectContaining({status: 'manual', title: 'Review manual promotion runbook'}),
          expect.objectContaining({status: 'completed', title: 'Validate rollout gate'}),
        ]),
      }),
    }))
  })

  it('returns reset checklists with different behavior for resettable and non-resettable networks', async () => {
    const devnet = parseJson((await runInProject(projectDir, ResetChecklist, ['--network', 'devnet', '--json'])).stdout)
    const testnet = parseJson((await runInProject(projectDir, ResetChecklist, ['--network', 'testnet', '--json'])).stdout)
    const mainnet = parseJson((await runInProject(projectDir, ResetChecklist, ['--network', 'mainnet', '--json'])).stdout)

    expect(devnet.data).toEqual(expect.objectContaining({resetExpectation: 'resets-expected'}))
    expect(testnet.data).toEqual(expect.objectContaining({resetExpectation: 'resets-expected'}))
    expect(mainnet.data).toEqual(expect.objectContaining({resetExpectation: 'no-resets-expected'}))
  })

  it('warns and fails upgrade checks when profile inputs are incomplete', async () => {
    const CommandHarness = createUpgradeHarness({})
    const result = await runInProject(projectDir, CommandHarness, ['--profile', 'incomplete-mainnet', '--json'])
    const json = parseJson(result.stdout)

    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      advisories: expect.arrayContaining([
        expect.objectContaining({code: 'auth-material', severity: 'fail'}),
        expect.objectContaining({code: 'scan-missing', severity: 'fail'}),
      ]),
    }))
  })

  it('executes the supported LocalNet upgrade apply workflow', async () => {
    const {LocalnetUpgradeHarness, localnet, readiness} = createLocalnetHarnesses()
    const result = await runInProject(projectDir, LocalnetUpgradeHarness, [
      '--profile',
      'splice-localnet',
      '--workspace',
      '/workspace',
      '--apply',
      '--json',
    ])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      automation: expect.objectContaining({kind: 'localnet-cycle'}),
      rollout: expect.objectContaining({
        mode: 'apply',
        steps: expect.arrayContaining([
          expect.objectContaining({status: 'completed', title: 'Cycle official LocalNet workspace'}),
          expect.objectContaining({status: 'completed', title: 'Inspect post-upgrade readiness'}),
        ]),
      }),
    }))
    expect(localnet.down).toHaveBeenCalledWith({workspace: '/workspace'})
    expect(readiness.run).toHaveBeenCalled()
  })

  it('executes the supported LocalNet reset apply workflow', async () => {
    const {LocalnetResetHarness, localnet, readiness} = createLocalnetHarnesses()
    const result = await runInProject(projectDir, LocalnetResetHarness, [
      '--profile',
      'splice-localnet',
      '--workspace',
      '/workspace',
      '--apply',
      '--json',
    ])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      automation: expect.objectContaining({kind: 'localnet-cycle'}),
      rollout: expect.objectContaining({
        mode: 'apply',
        steps: expect.arrayContaining([
          expect.objectContaining({status: 'completed', title: 'Cycle official LocalNet workspace'}),
          expect.objectContaining({status: 'completed', title: 'Inspect post-reset readiness'}),
        ]),
      }),
    }))
    expect(localnet.down).toHaveBeenCalledWith({workspace: '/workspace'})
    expect(readiness.run).toHaveBeenCalled()
  })
})
