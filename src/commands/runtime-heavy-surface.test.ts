import * as fs from 'node:fs'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {CantonctlConfig} from '../lib/config.js'
import type {DamlSdk} from '../lib/daml.js'
import * as deployerModule from '../lib/deployer.js'
import * as devServerModule from '../lib/dev-server.js'
import type {DevServer} from '../lib/dev-server.js'
import * as fullDevServerModule from '../lib/dev-server-full.js'
import type {FullDevServer} from '../lib/dev-server-full.js'
import type {Deployer, DeployResult} from '../lib/deployer.js'
import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import * as runtimeSupportModule from '../lib/runtime-support.js'
import * as topologyModule from '../lib/topology.js'
import type {GeneratedTopology} from '../lib/topology.js'
import Deploy, {renderDeployResult} from './deploy.js'
import Dev from './dev.js'

const CLI_ROOT = process.cwd()

afterEach(() => {
  vi.restoreAllMocks()
})

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    networks: {
      local: {port: 5001, 'json-api-port': 7575, type: 'sandbox'},
    },
    parties: [{name: 'Alice', role: 'operator'}],
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    version: 1,
  }
}

function createRunner(): ProcessRunner {
  return {
    run: vi.fn(),
    spawn: vi.fn(),
    which: vi.fn(),
  }
}

function createSdk(): DamlSdk {
  return {
    build: vi.fn(),
    codegen: vi.fn(),
    detectCommand: vi.fn(),
    getVersion: vi.fn(),
    startSandbox: vi.fn(),
    test: vi.fn(),
  } as unknown as DamlSdk
}

function setProcessStdinTty(value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value})
  return () => {
    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor)
      return
    }

    delete (process.stdin as {isTTY?: boolean}).isTTY
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function createDeployResult(overrides: Partial<DeployResult> = {}): DeployResult {
  const defaults: DeployResult = {
    artifact: {
      darPath: '/repo/.daml/dist/demo.dar',
      sizeBytes: 3,
      source: 'auto-detected',
    },
    auth: {
      envVarName: 'CANTONCTL_JWT_SANDBOX',
      mode: 'bearer-token',
      source: 'fallback',
    },
    description: 'Profile-first DAR rollout',
    fanOut: {
      mode: 'single-target',
      participantCount: 1,
      source: 'profile-ledger',
    },
    mode: 'apply',
    operation: 'deploy',
    partial: false,
    profile: {
      kind: 'sandbox',
      name: 'sandbox',
      network: 'local',
    },
    requestedTarget: 'sandbox',
    resume: {
      canResume: false,
      checkpoints: [],
      completedStepIds: ['resolve-dar', 'preflight-sandbox', 'upload-sandbox', 'verify-sandbox'],
      nextStepId: undefined,
    },
    steps: [
      {
        blockers: [],
        dependencies: [],
        detail: 'Resolved DAR artifact.',
        effect: 'read',
        id: 'resolve-dar',
        owner: 'cantonctl',
        postconditions: [],
        preconditions: [],
        runbook: [],
        status: 'completed',
        title: 'Resolve DAR artifact',
        warnings: [],
      },
      {
        blockers: [],
        dependencies: ['resolve-dar'],
        detail: 'Validated ledger reachability.',
        effect: 'read',
        id: 'preflight-sandbox',
        owner: 'cantonctl',
        postconditions: [],
        preconditions: [],
        runbook: [],
        status: 'completed',
        title: 'Preflight sandbox',
        warnings: [],
      },
      {
        blockers: [],
        dependencies: ['preflight-sandbox'],
        detail: 'Uploaded demo.dar.',
        effect: 'write',
        id: 'upload-sandbox',
        owner: 'cantonctl',
        postconditions: [],
        preconditions: [],
        runbook: [],
        status: 'completed',
        title: 'Upload DAR to sandbox',
        warnings: [],
      },
      {
        blockers: [],
        dependencies: ['upload-sandbox'],
        detail: 'Recorded package ID pkg-1.',
        effect: 'read',
        id: 'verify-sandbox',
        owner: 'cantonctl',
        postconditions: [{
          code: 'package-id-returned',
          detail: 'Ledger returned package ID pkg-1.',
          status: 'pass',
        }],
        preconditions: [],
        runbook: [],
        status: 'completed',
        title: 'Verify sandbox',
        warnings: [],
      },
    ],
    success: true,
    summary: {
      blocked: 0,
      completed: 4,
      dryRun: 0,
      failed: 0,
      manual: 0,
      pending: 0,
      ready: 0,
      warned: 0,
    },
    targets: [{
      baseUrl: 'http://localhost:7575',
      endpointSource: 'profile-ledger',
      id: 'sandbox',
      label: 'sandbox',
      managementClass: 'apply-capable',
      packageId: 'pkg-1',
      participant: undefined,
      postDeployChecks: [{
        code: 'package-id-returned',
        detail: 'Ledger returned package ID pkg-1.',
        status: 'pass',
      }],
      status: 'completed',
    }],
  }

  return {
    ...defaults,
    ...overrides,
    artifact: {...defaults.artifact, ...overrides.artifact},
    auth: {...defaults.auth, ...overrides.auth},
    fanOut: {...defaults.fanOut, ...overrides.fanOut},
    profile: {...defaults.profile, ...overrides.profile},
    resume: {...defaults.resume, ...overrides.resume},
    summary: {...defaults.summary, ...overrides.summary},
    steps: overrides.steps ?? defaults.steps,
    targets: overrides.targets ?? defaults.targets,
  }
}

describe('runtime-heavy command surface', () => {
  it('deploy emits profile-first plan results in json mode', async () => {
    let capturedOptions: Record<string, unknown> | undefined

    class TestDeploy extends Deploy {
      protected override createDeployer(_deps: Parameters<Deploy['createDeployer']>[0]): Deployer {
        return {
          deploy: vi.fn().mockImplementation(async (options) => {
            capturedOptions = options
            return createDeployResult({
              mode: 'plan',
              requestedTarget: 'sandbox',
              steps: [
                {
                  blockers: [],
                  checkpoint: {darPath: '/repo/.daml/dist/demo.dar', source: 'auto-detected'},
                  data: {darPath: '/repo/.daml/dist/demo.dar', sizeBytes: 3, source: 'auto-detected'},
                  dependencies: [],
                  detail: 'Resolved DAR artifact.',
                  effect: 'read',
                  id: 'resolve-dar',
                  owner: 'cantonctl',
                  postconditions: [],
                  preconditions: [],
                  runbook: [],
                  status: 'completed',
                  title: 'Resolve DAR artifact',
                  warnings: [],
                },
                {
                  blockers: [],
                  dependencies: ['resolve-dar'],
                  effect: 'read',
                  id: 'preflight-sandbox',
                  owner: 'cantonctl',
                  postconditions: [],
                  preconditions: [],
                  runbook: [],
                  status: 'ready',
                  title: 'Preflight sandbox',
                  warnings: [],
                },
                {
                  blockers: [],
                  dependencies: ['preflight-sandbox'],
                  effect: 'write',
                  id: 'upload-sandbox',
                  owner: 'cantonctl',
                  postconditions: [],
                  preconditions: [],
                  runbook: [],
                  status: 'ready',
                  title: 'Upload DAR to sandbox',
                  warnings: [],
                },
                {
                  blockers: [],
                  dependencies: ['upload-sandbox'],
                  effect: 'read',
                  id: 'verify-sandbox',
                  owner: 'cantonctl',
                  postconditions: [],
                  preconditions: [],
                  runbook: [],
                  status: 'ready',
                  title: 'Verify sandbox',
                  warnings: [],
                },
              ],
              summary: {
                blocked: 0,
                completed: 1,
                dryRun: 0,
                failed: 0,
                manual: 0,
                pending: 0,
                ready: 3,
                warned: 0,
              },
              targets: [{
                ...createDeployResult().targets[0]!,
                packageId: null,
                status: 'ready',
              }],
            })
          }),
        }
      }

      protected override createHooks() {
        return {emit: vi.fn()} as never
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDeploy.run(['--profile', 'sandbox', '--plan', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(capturedOptions).toEqual({
      darPath: undefined,
      mode: 'plan',
      party: undefined,
      profileName: 'sandbox',
      projectDir: '/repo',
    })
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        artifact: expect.objectContaining({darPath: '/repo/.daml/dist/demo.dar'}),
        mode: 'plan',
        profile: expect.objectContaining({name: 'sandbox'}),
        requestedTarget: 'sandbox',
      }),
      success: true,
    }))
  })

  it('starts sandbox-mode dev and emits json status', async () => {
    const start = vi.fn().mockResolvedValue(undefined)

    class TestDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start,
          stop: vi.fn().mockResolvedValue(undefined),
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const result = await captureOutput(() => TestDev.run(['--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      jsonApiPort: 7575,
      port: 5001,
      projectDir: process.cwd(),
    }))
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: {
        jsonApiPort: 7575,
        mode: 'sandbox',
        parties: ['Alice'],
        port: 5001,
        status: 'running',
      },
      success: true,
    }))
  })

  it('serializes dev validation failures', async () => {
    class TestDev extends Dev {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDev.run(['--json', '--topology', 'demo'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))
  })

  it('serializes conflicting deploy target arguments', async () => {
    class ConflictingDeploy extends Deploy {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => ConflictingDeploy.run(['local', '--profile', 'sandbox', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))
  })

  it('rethrows unexpected deploy failures', async () => {
    class TestDeploy extends Deploy {
      protected override createDeployer(_deps: Parameters<Deploy['createDeployer']>[0]): Deployer {
        return {
          deploy: vi.fn().mockRejectedValue(new Error('boom')),
        }
      }

      protected override createHooks() {
        return {emit: vi.fn()} as never
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    await expect(TestDeploy.run(['sandbox', '--json'], {root: CLI_ROOT})).rejects.toThrow('boom')
  })

  it('deploy emits human dry-run output', async () => {
    let capturedOptions: Record<string, unknown> | undefined

    class HumanDeploy extends Deploy {
      protected override createDeployer(_deps: Parameters<Deploy['createDeployer']>[0]): Deployer {
        return {
          deploy: vi.fn().mockImplementation(async (options) => {
            capturedOptions = options
            return createDeployResult({
              mode: 'dry-run',
              steps: [
                createDeployResult().steps[0]!,
                createDeployResult().steps[1]!,
                {
                  ...createDeployResult().steps[2]!,
                  detail: 'Skipped mutating step "Upload DAR to sandbox" in dry-run mode.',
                  status: 'dry-run',
                },
                {
                  ...createDeployResult().steps[3]!,
                  detail: 'Not attempted after "upload-sandbox" failed.',
                  postconditions: [],
                  status: 'pending',
                },
              ],
              summary: {
                blocked: 0,
                completed: 2,
                dryRun: 1,
                failed: 0,
                manual: 0,
                pending: 1,
                ready: 0,
                warned: 0,
              },
              targets: [{
                ...createDeployResult().targets[0]!,
                packageId: null,
                postDeployChecks: [],
                status: 'dry-run',
              }],
            })
          }),
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => HumanDeploy.run(['sandbox', '--dry-run'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(capturedOptions).toEqual(expect.objectContaining({mode: 'dry-run', profileName: 'sandbox'}))
    expect(result.stdout).toContain('Profile: sandbox (sandbox)')
    expect(result.stdout).toContain('Mode: dry-run')
    expect(result.stdout).toContain('Deploy rollout completed for 1 target.')
  })

  it('deploy exits when the rollout result is unsuccessful', async () => {
    class FailingDeploy extends Deploy {
      protected override createDeployer(_deps: Parameters<Deploy['createDeployer']>[0]): Deployer {
        return {
          deploy: vi.fn().mockResolvedValue(createDeployResult({
            success: false,
            summary: {
              blocked: 1,
              completed: 1,
              dryRun: 0,
              failed: 0,
              manual: 0,
              pending: 2,
              ready: 0,
              warned: 0,
            },
            targets: [{
              ...createDeployResult().targets[0]!,
              packageId: null,
              status: 'blocked',
            }],
          })),
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => FailingDeploy.run(['sandbox', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({success: false}),
      success: false,
    }))
  })

  it('emits multi-target deploy results in json mode', async () => {
    class MultiNodeDeploy extends Deploy {
      protected override createDeployer(_deps: Parameters<Deploy['createDeployer']>[0]): Deployer {
        return {
          deploy: vi.fn().mockResolvedValue(createDeployResult({
            fanOut: {
              mode: 'fan-out',
              participantCount: 2,
              source: 'generated-topology',
            },
            profile: {
              kind: 'canton-multi',
              name: 'multi',
              network: 'local',
            },
            requestedTarget: 'multi',
            targets: [
              {
                baseUrl: 'http://localhost:7575',
                endpointSource: 'generated-topology',
                id: 'participant-a',
                label: 'participant-a',
                managementClass: 'apply-capable',
                packageId: null,
                participant: 'participant-a',
                postDeployChecks: [],
                status: 'dry-run',
              },
              {
                baseUrl: 'http://localhost:7576',
                endpointSource: 'generated-topology',
                id: 'participant-b',
                label: 'participant-b',
                managementClass: 'apply-capable',
                packageId: 'pkg-2',
                participant: 'participant-b',
                postDeployChecks: [],
                status: 'completed',
              },
            ],
          })),
        }
      }

      protected override getProjectDir(): string {
        return '/repo'
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => MultiNodeDeploy.run(['multi', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        fanOut: {
          mode: 'fan-out',
          participantCount: 2,
          source: 'generated-topology',
        },
        profile: expect.objectContaining({kind: 'canton-multi', name: 'multi'}),
        targets: [
          expect.objectContaining({label: 'participant-a', status: 'dry-run'}),
          expect.objectContaining({label: 'participant-b', packageId: 'pkg-2', status: 'completed'}),
        ],
      }),
      success: true,
    }))
  })

  it('emits remote deploy results in json mode', async () => {
    class RemoteDeploy extends Deploy {
      protected override createDeployer(_deps: Parameters<Deploy['createDeployer']>[0]): Deployer {
        return {
          deploy: vi.fn().mockResolvedValue(createDeployResult({
            auth: {
              envVarName: 'CANTONCTL_JWT_DEVNET',
              mode: 'env-or-keychain-jwt',
              source: 'stored',
            },
            profile: {
              kind: 'remote-validator',
              name: 'splice-devnet',
              network: 'devnet',
            },
            requestedTarget: 'devnet',
            targets: [{
              baseUrl: 'https://ledger.example.com',
              endpointSource: 'profile-ledger',
              id: 'splice-devnet',
              label: 'splice-devnet',
              managementClass: 'apply-capable',
              packageId: 'pkg-remote',
              participant: undefined,
              postDeployChecks: [{
                code: 'package-id-returned',
                detail: 'Ledger returned package ID pkg-remote.',
                status: 'pass',
              }],
              status: 'completed',
            }],
          })),
        }
      }

      protected override async detectProjectTopology(): Promise<GeneratedTopology> {
        throw new Error('should not inspect local topology')
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          networks: {
            ...createConfig().networks,
            devnet: {type: 'remote', url: 'https://ledger.example.com'},
          },
        }
      }
    }

    const result = await captureOutput(() => RemoteDeploy.run(['devnet', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        profile: expect.objectContaining({name: 'splice-devnet', network: 'devnet'}),
        requestedTarget: 'devnet',
      }),
      success: true,
    }))
  })

  it('renders human deploy results with warnings and failures', () => {
    const out = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      result: vi.fn(),
      spinner: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }

    renderDeployResult(out as never, createDeployResult({
      steps: [
        {
          blockers: [],
          dependencies: [],
          detail: 'Resolved DAR artifact.',
          effect: 'read',
          id: 'resolve-dar',
          owner: 'cantonctl',
          postconditions: [],
          preconditions: [],
          runbook: [],
          status: 'completed',
          title: 'Resolve DAR artifact',
          warnings: [],
        },
        {
          blockers: [],
          dependencies: ['resolve-dar'],
          detail: 'Profile is experimental.',
          effect: 'read',
          id: 'preflight-sandbox',
          owner: 'cantonctl',
          postconditions: [{
            code: 'package-id-returned',
            detail: 'Package ID was not returned.',
            status: 'warn',
          }],
          preconditions: [],
          runbook: [],
          status: 'failed',
          title: 'Preflight sandbox',
          warnings: [{
            code: 'experimental-target',
            detail: 'Profile "sandbox" is marked experimental.',
          }],
        },
      ],
      success: false,
      summary: {
        blocked: 0,
        completed: 1,
        dryRun: 0,
        failed: 1,
        manual: 0,
        pending: 0,
        ready: 0,
        warned: 2,
      },
      targets: [{
        ...createDeployResult().targets[0]!,
        packageId: null,
        postDeployChecks: [{
          code: 'package-id-returned',
          detail: 'Package ID was not returned.',
          status: 'warn',
        }],
        status: 'failed',
      }],
    }))

    expect(out.log).toHaveBeenCalledWith('Profile: sandbox (sandbox)')
    expect(out.table).toHaveBeenCalledTimes(2)
    expect(out.warn).toHaveBeenCalledWith('Preflight sandbox: Profile "sandbox" is marked experimental.')
    expect(out.warn).toHaveBeenCalledWith('Preflight sandbox: Package ID was not returned.')
    expect(out.error).toHaveBeenCalledWith('Deploy rollout found blocking issues.')
  })

  it('renders human deploy results with plan success and fallback display values', () => {
    const out = {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      result: vi.fn(),
      spinner: vi.fn(),
      success: vi.fn(),
      table: vi.fn(),
      warn: vi.fn(),
    }

    renderDeployResult(out as never, createDeployResult({
      artifact: {
        darPath: null,
        sizeBytes: undefined,
        source: 'auto-detected',
      },
      fanOut: {
        mode: 'fan-out',
        participantCount: 2,
        source: 'generated-topology',
      },
      mode: 'plan',
      steps: [
        {
          blockers: [],
          dependencies: [],
          effect: 'read',
          error: {message: 'artifact detail unavailable'},
          id: 'resolve-dar',
          owner: 'cantonctl',
          postconditions: [],
          preconditions: [],
          runbook: [],
          status: 'failed',
          title: 'Resolve DAR artifact',
          warnings: [],
        },
        {
          blockers: [],
          dependencies: ['resolve-dar'],
          effect: 'write',
          id: 'upload-sandbox',
          owner: 'cantonctl',
          postconditions: [{
            code: 'package-id-returned',
            detail: 'Package ID looks good.',
            status: 'pass',
          }],
          preconditions: [],
          runbook: [],
          status: 'ready',
          title: 'Upload DAR to sandbox',
          warnings: [],
        },
      ],
      success: true,
      summary: {
        blocked: 0,
        completed: 0,
        dryRun: 0,
        failed: 1,
        manual: 0,
        pending: 0,
        ready: 1,
        warned: 0,
      },
      targets: [
        {
          ...createDeployResult().targets[0]!,
          baseUrl: undefined,
          id: 'participant-a',
          label: 'participant-a',
          packageId: null,
          postDeployChecks: [],
          status: 'ready',
        },
        {
          ...createDeployResult().targets[0]!,
          id: 'participant-b',
          label: 'participant-b',
          packageId: null,
          postDeployChecks: [],
          status: 'ready',
        },
      ],
    }))

    expect(out.log).toHaveBeenCalledWith('DAR: not resolved (auto-detected)')
    expect(out.success).toHaveBeenCalledWith('Deploy plan completed for 2 targets.')
    expect(out.table).toHaveBeenNthCalledWith(1, ['Target', 'Status', 'Endpoint', 'Package ID'], [
      ['participant-a', 'ready', '-', '-'],
      ['participant-b', 'ready', 'http://localhost:7575', '-'],
    ])
    expect(out.table).toHaveBeenNthCalledWith(2, ['Step', 'Status', 'Detail'], [
      ['Resolve DAR artifact', 'failed', 'artifact detail unavailable'],
      ['Upload DAR to sandbox', 'ready', '-'],
    ])
  })

  it('wires deploy default helpers', async () => {
    class DeployHarness extends Deploy {
      public callCreateDeployer(deps: Parameters<Deploy['createDeployer']>[0]) {
        return this.createDeployer(deps)
      }

      public async callDetectProjectTopology(projectDir: string) {
        return this.detectProjectTopology(projectDir)
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public async callLoadProjectConfig() {
        return this.loadProjectConfig()
      }

      public async run(): Promise<void> {}
    }

    let capturedDeps: Parameters<typeof deployerModule.createDeployer>[0] | undefined
    vi.spyOn(deployerModule, 'createDeployer').mockImplementation((deps) => {
      capturedDeps = deps
      return {deploy: vi.fn()} as never
    })
    const detectTopologySpy = vi.spyOn(topologyModule, 'detectTopology').mockResolvedValue(null)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())

    const harness = new DeployHarness([], {} as never)
    harness.callCreateDeployer({
      config: createConfig(),
      hooks: {emit: vi.fn()} as never,
    })

    const helperDir = fs.mkdtempSync(path.join(tmpdir(), 'cantonctl-deploy-helper-'))
    const helperFile = path.join(helperDir, 'file.txt')
    fs.writeFileSync(helperFile, 'deploy-helper', 'utf8')

    try {
      await expect(capturedDeps?.fs.readFile(helperFile)).resolves.toEqual(Buffer.from('deploy-helper'))
      await expect(capturedDeps?.detectTopology?.('/repo')).resolves.toBeNull()
      await expect(harness.callDetectProjectTopology('/repo')).resolves.toBeNull()
      expect(harness.callGetProjectDir()).toBe(process.cwd())
      await expect(harness.callLoadProjectConfig()).resolves.toEqual(createConfig())
      expect(capturedDeps).toEqual(expect.objectContaining({
        config: createConfig(),
        createLedgerClient: expect.any(Function),
        createProfileRuntimeResolver: expect.any(Function),
        createToken: expect.any(Function),
        detectTopology: expect.any(Function),
        findDarFile: expect.any(Function),
        fs: expect.objectContaining({readFile: expect.any(Function)}),
      }))
      expect(detectTopologySpy).toHaveBeenCalledWith('/repo')
      expect(loadConfigSpy).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(helperDir, {force: true, recursive: true})
    }
  })

  it('covers dev net mode, shutdown cleanup, and default helpers', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn().mockResolvedValue(undefined)

    class NetDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createFullServer(): FullDevServer {
        return {start, stop}
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    const errorStop = vi.fn().mockResolvedValue(undefined)
    class HandledDevError extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createFullServer(): FullDevServer {
        return {
          start: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.DOCKER_NOT_AVAILABLE, {suggestion: 'start docker'})),
          stop: errorStop,
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const sandboxShutdownStop = vi.fn().mockResolvedValue(undefined)
    class ShutdownSandboxDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          stop: sandboxShutdownStop,
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(
        _json: boolean,
        shutdown: () => Promise<void>,
      ): Promise<void> {
        await shutdown()
        await shutdown()
      }
    }

    const netShutdownStop = vi.fn().mockResolvedValue(undefined)
    class ShutdownNetDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createFullServer(): FullDevServer {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          stop: netShutdownStop,
        }
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(
        _json: boolean,
        shutdown: () => Promise<void>,
      ): Promise<void> {
        await shutdown()
      }
    }

    class JsonDefaultsNetDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createFullServer(): FullDevServer {
        return {start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined)}
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    class JsonDefaultsSandboxDev extends Dev {
      protected override createRunner(): ProcessRunner {
        return createRunner()
      }

      protected override createSdk(): DamlSdk {
        return createSdk()
      }

      protected override createSandboxServer(): DevServer {
        return {start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined)}
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return {
          ...createConfig(),
          parties: undefined,
        }
      }

      protected override async waitForShutdown(): Promise<void> {}
    }

    class UnexpectedDevError extends Dev {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('dev boom')
      }
    }

    class DevHarness extends Dev {
      public callCleanupInteractiveInput(json: boolean) {
        return this.cleanupInteractiveInput(json)
      }

      public callCreateFullServer(deps: Parameters<Dev['createFullServer']>[0]) {
        return this.createFullServer(deps)
      }

      public callCreateSandboxServer(deps: Parameters<Dev['createSandboxServer']>[0]) {
        return this.createSandboxServer(deps)
      }

      public callGetProjectDir() {
        return this.getProjectDir()
      }

      public callIsManagedPortInUse(port: number) {
        return this.isManagedPortInUse(port)
      }

      public async callLoadProjectConfig() {
        return this.loadProjectConfig()
      }

      public async callWaitForShutdown(
        json: boolean,
        shutdown: () => Promise<void>,
        shutdownPromise: Promise<void>,
      ) {
        return this.waitForShutdown(json, shutdown, shutdownPromise)
      }

      public async run(): Promise<void> {}
    }

    const net = await captureOutput(() => NetDev.run([
      '--net',
      '--base-port',
      '21000',
      '--topology',
      'demo',
      '--json',
    ], {root: CLI_ROOT}))
    expect(net.error).toBeUndefined()
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      basePort: 21000,
      projectDir: process.cwd(),
      topologyName: 'demo',
    }))
    expect(parseJson(net.stdout)).toEqual(expect.objectContaining({
      data: {
        mode: 'net',
        parties: ['Alice'],
        status: 'running',
        topology: 'demo',
      },
      success: true,
    }))

    const handled = await captureOutput(() => HandledDevError.run(['--net', '--json'], {root: CLI_ROOT}))
    expect(handled.error).toBeDefined()
    expect(errorStop).toHaveBeenCalledTimes(1)
    expect(parseJson(handled.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.DOCKER_NOT_AVAILABLE}),
      success: false,
    }))

    const sandboxShutdown = await captureOutput(() => ShutdownSandboxDev.run([], {root: CLI_ROOT}))
    expect(sandboxShutdown.error).toBeUndefined()
    expect(sandboxShutdownStop).toHaveBeenCalledTimes(1)

    const netShutdown = await captureOutput(() => ShutdownNetDev.run(['--net'], {root: CLI_ROOT}))
    expect(netShutdown.error).toBeUndefined()
    expect(netShutdownStop).toHaveBeenCalledTimes(1)

    const jsonDefaultsNet = await captureOutput(() => JsonDefaultsNetDev.run(['--net', '--json'], {root: CLI_ROOT}))
    expect(jsonDefaultsNet.error).toBeUndefined()
    expect(jsonDefaultsNet.stdout).toContain('"parties":[]')
    expect(jsonDefaultsNet.stdout).toContain('"topology":"default"')

    const jsonDefaultsSandbox = await captureOutput(() => JsonDefaultsSandboxDev.run(['--json'], {root: CLI_ROOT}))
    expect(jsonDefaultsSandbox.error).toBeUndefined()
    expect(jsonDefaultsSandbox.stdout).toContain('"parties":[]')

    await expect(UnexpectedDevError.run(['--json'], {root: CLI_ROOT})).rejects.toThrow('dev boom')

    let capturedFullDeps: Parameters<typeof fullDevServerModule.createFullDevServer>[0] | undefined
    let capturedSandboxDeps: Parameters<typeof devServerModule.createDevServer>[0] | undefined
    vi.spyOn(fullDevServerModule, 'createFullDevServer').mockImplementation((deps) => {
      capturedFullDeps = deps
      return {start: vi.fn(), stop: vi.fn()} as never
    })
    vi.spyOn(devServerModule, 'createDevServer').mockImplementation((deps) => {
      capturedSandboxDeps = deps
      return {start: vi.fn(), stop: vi.fn()} as never
    })
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    const portSpy = vi.spyOn(runtimeSupportModule, 'isTcpPortInUse').mockResolvedValue(true)

    const harness = new DevHarness([], {} as never)
    const sdk = createSdk()
    const docker = {composeDown: vi.fn(), composePs: vi.fn(), composeUp: vi.fn()} as never
    harness.callCreateFullServer({
      cantonImage: 'image',
      config: createConfig(),
      docker,
      output: {result: vi.fn()} as never,
      sdk,
    })
    harness.callCreateSandboxServer({
      config: createConfig(),
      output: {result: vi.fn()} as never,
      sdk,
    })

    const helperDir = fs.mkdtempSync(path.join(tmpdir(), 'cantonctl-dev-helper-'))
    const helperFile = path.join(helperDir, 'helper.txt')
    const helperDir2 = path.join(helperDir, 'nested')
    fs.mkdirSync(helperDir2)

    try {
      await capturedFullDeps?.build('/repo')
      await capturedFullDeps?.mkdir(helperDir2)
      await capturedFullDeps?.writeFile(helperFile, 'hello')
      await expect(capturedFullDeps?.readFile(helperFile)).resolves.toEqual(Buffer.from('hello'))
      await capturedFullDeps?.rmdir(helperDir2)
      const fullWatcher = capturedFullDeps?.watch(helperDir, {})

      expect(capturedSandboxDeps?.isPortInUse).toBeDefined()
      await expect(capturedSandboxDeps!.isPortInUse!(7575)).resolves.toBe(true)
      await expect(capturedSandboxDeps?.readFile(helperFile)).resolves.toEqual(Buffer.from('hello'))
      const sandboxWatcher = capturedSandboxDeps?.watch(helperDir, {})

      const restoreStdinTty = setProcessStdinTty(true)
      const originalSetRawMode = (process.stdin as {setRawMode?: (value: boolean) => void}).setRawMode
      const originalResume = process.stdin.resume.bind(process.stdin)
      const originalPause = process.stdin.pause.bind(process.stdin)
      const originalOn = process.stdin.on.bind(process.stdin)
      const setRawMode = vi.fn()
      const resume = vi.fn()
      const pause = vi.fn()

      ;(process.stdin as {setRawMode?: (value: boolean) => void}).setRawMode = setRawMode
      process.stdin.resume = resume as typeof process.stdin.resume
      process.stdin.pause = pause as typeof process.stdin.pause
      process.stdin.on = vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => {
            handler(Buffer.from('x'))
            handler(Buffer.from('q'))
          }, 0)
        }

        return process.stdin
      }) as unknown as typeof process.stdin.on

      try {
        let resolveShutdownPromise: (() => void) | null = null
        const shutdownPromise = new Promise<void>((resolve) => {
          resolveShutdownPromise = resolve
        })
        const shutdown = vi.fn().mockImplementation(async () => {
          resolveShutdownPromise?.()
        })

        await harness.callWaitForShutdown(false, shutdown, shutdownPromise)
        expect(setRawMode).toHaveBeenCalledWith(true)
        expect(resume).toHaveBeenCalledTimes(1)

        harness.callCleanupInteractiveInput(false)
        expect(setRawMode).toHaveBeenCalledWith(false)
        expect(pause).toHaveBeenCalledTimes(1)
      } finally {
        restoreStdinTty()
        ;(process.stdin as {setRawMode?: (value: boolean) => void}).setRawMode = originalSetRawMode
        process.stdin.resume = originalResume
        process.stdin.pause = originalPause
        process.stdin.on = originalOn
      }

      await expect(
        harness.callWaitForShutdown(true, vi.fn(), Promise.resolve()),
      ).resolves.toBeUndefined()

      expect(harness.callGetProjectDir()).toBe(process.cwd())
      await expect(harness.callIsManagedPortInUse(7575)).resolves.toBe(true)
      await expect(harness.callLoadProjectConfig()).resolves.toEqual(createConfig())
      await fullWatcher?.close()
      await sandboxWatcher?.close()
      expect(loadConfigSpy).toHaveBeenCalledTimes(1)
      expect(portSpy).toHaveBeenCalledWith(7575)
    } finally {
      fs.rmSync(helperDir, {force: true, recursive: true})
    }
  })
})
