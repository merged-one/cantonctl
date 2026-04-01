import {describe, expect, it, vi} from 'vitest'

import type {Builder, BuildResult} from './builder.js'
import type {CantonctlConfig} from './config.js'
import {createDeployer, type DeployerDeps, type DeployOptions} from './deployer.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {LedgerClient} from './ledger-client.js'
import type {OutputWriter} from './output.js'
import {createPluginHookManager} from './plugin-hooks.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockBuilder(): Builder & {
  build: ReturnType<typeof vi.fn>
  buildWithCodegen: ReturnType<typeof vi.fn>
  watch: ReturnType<typeof vi.fn>
} {
  return {
    build: vi.fn<Builder['build']>().mockResolvedValue({
      darPath: '/project/.daml/dist/my-app-1.0.0.dar',
      durationMs: 100,
      success: true,
    } as BuildResult),
    buildWithCodegen: vi.fn<Builder['buildWithCodegen']>(),
    watch: vi.fn<Builder['watch']>(),
  }
}

function createMockLedgerClient(): LedgerClient & {
  allocateParty: ReturnType<typeof vi.fn>
  getActiveContracts: ReturnType<typeof vi.fn>
  getParties: ReturnType<typeof vi.fn>
  getVersion: ReturnType<typeof vi.fn>
  submitAndWait: ReturnType<typeof vi.fn>
  uploadDar: ReturnType<typeof vi.fn>
} {
  return {
    allocateParty: vi.fn(),
    getActiveContracts: vi.fn(),
    getParties: vi.fn(),
    getLedgerEnd: vi.fn().mockResolvedValue({offset: 0}),
    getVersion: vi.fn().mockResolvedValue({version: '3.4.9'}),
    submitAndWait: vi.fn(),
    uploadDar: vi.fn().mockResolvedValue({mainPackageId: 'pkg-abc123'}),
  }
}

function createMockOutput(): OutputWriter {
  return {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    result: vi.fn(),
    spinner: vi.fn().mockReturnValue({fail: vi.fn(), stop: vi.fn(), succeed: vi.fn()}),
    success: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
  }
}

const DEFAULT_CONFIG: CantonctlConfig = {
  networks: {
    local: {
      'json-api-port': 7575,
      port: 5001,
      type: 'sandbox',
    },
    devnet: {
      type: 'remote',
      url: 'https://devnet.example.com',
    },
  },
  parties: [
    {name: 'Alice', role: 'operator'},
    {name: 'Bob', role: 'participant'},
  ],
  project: {
    name: 'my-app',
    'sdk-version': '3.4.9',
  },
  version: 1,
}

function createDefaultDeps(overrides: Partial<DeployerDeps> = {}): DeployerDeps & {
  mockBuilder: ReturnType<typeof createMockBuilder>
  mockClient: ReturnType<typeof createMockLedgerClient>
  mockOutput: OutputWriter
} {
  const mockBuilder = createMockBuilder()
  const mockClient = createMockLedgerClient()
  const mockOutput = createMockOutput()

  const deps: DeployerDeps = {
    builder: mockBuilder,
    config: DEFAULT_CONFIG,
    createLedgerClient: vi.fn().mockReturnValue(mockClient),
    createToken: vi.fn().mockResolvedValue('mock-jwt-token'),
    fs: {readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))},
    output: mockOutput,
    ...overrides,
  }

  return {...deps, mockBuilder, mockClient, mockOutput}
}

const defaultOpts: DeployOptions = {
  network: 'local',
  projectDir: '/project',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Deployer', () => {
  describe('deploy()', () => {
    it('runs full 6-step pipeline for local deploy', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      const result = await deployer.deploy(defaultOpts)

      expect(result.success).toBe(true)
      expect(result.network).toBe('local')
      expect(result.mainPackageId).toBe('pkg-abc123')
      expect(result.darPath).toBe('/project/.daml/dist/my-app-1.0.0.dar')
      expect(result.dryRun).toBe(false)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('calls builder.build when no --dar provided', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(deps.mockBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({projectDir: '/project'}),
      )
    })

    it('skips build when --dar path is provided', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy({...defaultOpts, darPath: '/custom/my.dar'})

      expect(deps.mockBuilder.build).not.toHaveBeenCalled()
      expect(deps.fs.readFile).toHaveBeenCalledWith('/custom/my.dar')
    })

    it('generates token with config parties', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(deps.createToken).toHaveBeenCalledWith({
        actAs: ['Alice', 'Bob'],
        admin: true,
        applicationId: 'cantonctl',
        readAs: ['Alice', 'Bob'],
      })
    })

    it('uses --party override for actAs', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy({...defaultOpts, party: 'Charlie'})

      expect(deps.createToken).toHaveBeenCalledWith(
        expect.objectContaining({actAs: ['Charlie']}),
      )
    })

    it('creates ledger client with correct baseUrl and token', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(deps.createLedgerClient).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:7575',
        token: 'mock-jwt-token',
      })
    })

    it('uses network url when available', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy({...defaultOpts, network: 'devnet'})

      expect(deps.createLedgerClient).toHaveBeenCalledWith(
        expect.objectContaining({baseUrl: 'https://devnet.example.com'}),
      )
    })

    it('calls getVersion for pre-flight check', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(deps.mockClient.getVersion).toHaveBeenCalled()
    })

    it('uploads DAR bytes to ledger', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(deps.mockClient.uploadDar).toHaveBeenCalledWith(
        new Uint8Array([1, 2, 3]),
        undefined,
      )
    })

    it('outputs progress messages', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(deps.mockOutput.info).toHaveBeenCalledWith('[1/6] Validating configuration...')
      expect(deps.mockOutput.info).toHaveBeenCalledWith('[2/6] Building .dar package...')
      expect(deps.mockOutput.info).toHaveBeenCalledWith('[5/6] Uploading .dar...')
      expect(deps.mockOutput.info).toHaveBeenCalledWith('[6/6] Verifying deployment...')
      expect(deps.mockOutput.success).toHaveBeenCalledWith('Deployed successfully to local')
    })
  })

  describe('--dry-run', () => {
    it('stops after pre-flight checks', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      const result = await deployer.deploy({...defaultOpts, dryRun: true})

      expect(result.success).toBe(true)
      expect(result.dryRun).toBe(true)
      expect(result.mainPackageId).toBeNull()
      expect(deps.mockClient.uploadDar).not.toHaveBeenCalled()
    })

    it('still validates config and builds', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      await deployer.deploy({...defaultOpts, dryRun: true})

      expect(deps.mockBuilder.build).toHaveBeenCalled()
      expect(deps.mockClient.getVersion).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('throws CONFIG_SCHEMA_VIOLATION for unknown network', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)

      await expect(deployer.deploy({...defaultOpts, network: 'unknown'}))
        .rejects.toThrow(CantonctlError)

      try {
        await deployer.deploy({...defaultOpts, network: 'unknown'})
      } catch (err) {
        expect(err).toBeInstanceOf(CantonctlError)
        expect((err as CantonctlError).code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
      }
    })

    it('throws BUILD_DAR_NOT_FOUND when build produces no DAR', async () => {
      const deps = createDefaultDeps({
        builder: {
          build: vi.fn().mockResolvedValue({darPath: null, durationMs: 50, success: true}),
          buildWithCodegen: vi.fn(),
          watch: vi.fn(),
        },
      })
      const deployer = createDeployer(deps)

      await expect(deployer.deploy(defaultOpts)).rejects.toThrow(CantonctlError)

      try {
        await deployer.deploy(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.BUILD_DAR_NOT_FOUND)
      }
    })

    it('throws BUILD_DAR_NOT_FOUND when DAR file cannot be read', async () => {
      const deps = createDefaultDeps({
        fs: {readFile: vi.fn().mockRejectedValue(new Error('ENOENT'))},
      })
      const deployer = createDeployer(deps)

      await expect(deployer.deploy(defaultOpts)).rejects.toThrow(CantonctlError)

      try {
        await deployer.deploy(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.BUILD_DAR_NOT_FOUND)
      }
    })

    it('throws DEPLOY_AUTH_FAILED when token creation fails', async () => {
      const deps = createDefaultDeps({
        createToken: vi.fn().mockRejectedValue(new Error('auth error')),
      })
      const deployer = createDeployer(deps)

      await expect(deployer.deploy(defaultOpts)).rejects.toThrow(CantonctlError)

      try {
        await deployer.deploy(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.DEPLOY_AUTH_FAILED)
      }
    })

    it('throws DEPLOY_NETWORK_UNREACHABLE when pre-flight fails', async () => {
      const mockClient = createMockLedgerClient()
      mockClient.getVersion.mockRejectedValue(
        new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED, {
          suggestion: 'Cannot connect',
        }),
      )
      const deps = createDefaultDeps({
        createLedgerClient: vi.fn().mockReturnValue(mockClient),
      })
      const deployer = createDeployer(deps)

      await expect(deployer.deploy(defaultOpts)).rejects.toThrow(CantonctlError)

      try {
        await deployer.deploy(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.DEPLOY_NETWORK_UNREACHABLE)
      }
    })

    it('throws DEPLOY_UPLOAD_FAILED when upload is rejected', async () => {
      const mockClient = createMockLedgerClient()
      mockClient.uploadDar.mockRejectedValue(
        new CantonctlError(ErrorCode.DEPLOY_UPLOAD_FAILED, {
          context: {status: 400},
          suggestion: 'Upload rejected',
        }),
      )
      const deps = createDefaultDeps({
        createLedgerClient: vi.fn().mockReturnValue(mockClient),
      })
      const deployer = createDeployer(deps)

      await expect(deployer.deploy(defaultOpts)).rejects.toThrow(CantonctlError)

      try {
        await deployer.deploy(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.DEPLOY_UPLOAD_FAILED)
      }
    })

    it('throws DEPLOY_PACKAGE_EXISTS on 409 conflict', async () => {
      const mockClient = createMockLedgerClient()
      mockClient.uploadDar.mockRejectedValue(
        new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED, {
          context: {status: 409},
          suggestion: 'Conflict',
        }),
      )
      const deps = createDefaultDeps({
        createLedgerClient: vi.fn().mockReturnValue(mockClient),
      })
      const deployer = createDeployer(deps)

      await expect(deployer.deploy(defaultOpts)).rejects.toThrow(CantonctlError)

      try {
        await deployer.deploy(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.DEPLOY_PACKAGE_EXISTS)
      }
    })

    it('uses fallback actAs when no parties configured', async () => {
      const deps = createDefaultDeps({
        config: {...DEFAULT_CONFIG, parties: []},
      })
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(deps.createToken).toHaveBeenCalledWith(
        expect.objectContaining({actAs: ['admin']}),
      )
    })
  })

  describe('plugin hooks', () => {
    it('emits beforeDeploy and afterDeploy hooks', async () => {
      const hooks = createPluginHookManager()
      const events: string[] = []
      hooks.register('beforeDeploy', async () => { events.push('before') })
      hooks.register('afterDeploy', async () => { events.push('after') })

      const deps = createDefaultDeps({hooks})
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(events).toEqual(['before', 'after'])
    })

    it('emits afterDeploy with context', async () => {
      const hooks = createPluginHookManager()
      let ctx: Record<string, unknown> = {}
      hooks.register('afterDeploy', async (c) => { ctx = c })

      const deps = createDefaultDeps({hooks})
      const deployer = createDeployer(deps)
      await deployer.deploy(defaultOpts)

      expect(ctx.network).toBe('local')
      expect(ctx.mainPackageId).toBe('pkg-abc123')
      expect(ctx.darPath).toBe('/project/.daml/dist/my-app-1.0.0.dar')
    })

    it('does not emit afterDeploy on dry run', async () => {
      const hooks = createPluginHookManager()
      const events: string[] = []
      hooks.register('beforeDeploy', async () => { events.push('before') })
      hooks.register('afterDeploy', async () => { events.push('after') })

      const deps = createDefaultDeps({hooks})
      const deployer = createDeployer(deps)
      await deployer.deploy({...defaultOpts, dryRun: true})

      expect(events).toEqual(['before'])
    })

    it('works without hooks (optional)', async () => {
      const deps = createDefaultDeps()
      const deployer = createDeployer(deps)
      const result = await deployer.deploy(defaultOpts)
      expect(result.success).toBe(true)
    })
  })
})
