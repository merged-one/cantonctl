import {describe, expect, it, vi} from 'vitest'

import type {DamlSdk, SdkCommandResult, SdkInfo} from './daml.js'
import type {LedgerClient} from './ledger-client.js'
import type {OutputWriter} from './output.js'
import type {SpawnedProcess} from './process-runner.js'
import {type DevServer, type DevServerDeps, type DevServerOptions, createDevServer} from './dev-server.js'
import {CantonctlError, ErrorCode} from './errors.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockSdk(): DamlSdk & {
  build: ReturnType<typeof vi.fn>
  codegen: ReturnType<typeof vi.fn>
  detect: ReturnType<typeof vi.fn>
  startSandbox: ReturnType<typeof vi.fn>
  test: ReturnType<typeof vi.fn>
} {
  return {
    build: vi.fn<DamlSdk['build']>(),
    codegen: vi.fn<DamlSdk['codegen']>(),
    detect: vi.fn<DamlSdk['detect']>(),
    startSandbox: vi.fn<DamlSdk['startSandbox']>(),
    test: vi.fn<DamlSdk['test']>(),
  }
}

function createMockClient(): LedgerClient & {
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
    getVersion: vi.fn(),
    submitAndWait: vi.fn(),
    uploadDar: vi.fn(),
  }
}

function createMockOutput(): OutputWriter {
  return {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    result: vi.fn(),
    spinner: vi.fn().mockReturnValue({fail: vi.fn(), stop: vi.fn(), succeed: vi.fn(), text: ''}),
    success: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
  }
}

function createMockProcess(): SpawnedProcess & {_exitCallbacks: Array<(code: number | null) => void>} {
  const exitCallbacks: Array<(code: number | null) => void> = []
  return {
    _exitCallbacks: exitCallbacks,
    kill: vi.fn(),
    onExit(cb: (code: number | null) => void) { exitCallbacks.push(cb) },
    pid: 12345,
    stderr: null,
    stdout: null,
  }
}

interface MockWatcher {
  close: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  handlers: Record<string, Function>
}

function createMockWatcher(): MockWatcher {
  const handlers: Record<string, Function> = {}
  return {
    close: vi.fn().mockResolvedValue(undefined),
    handlers,
    on: vi.fn().mockImplementation((event: string, handler: Function) => {
      handlers[event] = handler
      return {close: vi.fn(), handlers, on: vi.fn()}
    }),
  }
}

function createDefaultDeps(overrides: Partial<DevServerDeps> = {}): DevServerDeps {
  const sdk = createMockSdk()
  const client = createMockClient()
  const output = createMockOutput()
  const mockProc = createMockProcess()
  const watcher = createMockWatcher()

  sdk.detect.mockResolvedValue({path: '/usr/local/bin/dpm', tool: 'dpm', version: 'dpm 3.4.9'} as SdkInfo)
  sdk.startSandbox.mockResolvedValue(mockProc)
  sdk.build.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'built', success: true} as SdkCommandResult)
  client.getVersion.mockResolvedValue({version: '3.4.9'})
  client.getParties.mockResolvedValue({partyDetails: []})
  client.allocateParty.mockImplementation(async (params: {displayName: string}) => ({
    partyDetails: {displayName: params.displayName, identifier: `${params.displayName}::1234`, isLocal: true},
  }))
  client.uploadDar.mockResolvedValue({mainPackageId: 'pkg-123'})

  return {
    config: {
      parties: [
        {name: 'Alice', role: 'operator' as const},
        {name: 'Bob', role: 'participant' as const},
      ],
      project: {name: 'test-project', 'sdk-version': '3.4.9'},
      version: 1,
    },
    createClient: () => client,
    createToken: vi.fn().mockResolvedValue('mock-jwt-token'),
    findDarFile: vi.fn().mockResolvedValue('/project/.daml/dist/test-project-1.0.0.dar'),
    output,
    readFile: vi.fn().mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
    sdk,
    watch: vi.fn().mockReturnValue(watcher),
    ...overrides,
  }
}

const defaultOpts: DevServerOptions = {
  debounceMs: 0, // Disable debounce in tests for immediate execution
  healthRetryDelayMs: 10,
  healthTimeoutMs: 5000,
  jsonApiPort: 7575,
  port: 5001,
  projectDir: '/project',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DevServer', () => {
  describe('start()', () => {
    it('detects SDK before starting sandbox', async () => {
      const deps = createDefaultDeps()
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(deps.sdk.detect).toHaveBeenCalled()
    })

    it('starts sandbox via DamlSdk with correct port args', async () => {
      const deps = createDefaultDeps()
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(deps.sdk.startSandbox).toHaveBeenCalledWith(
        expect.objectContaining({jsonApiPort: 7575, port: 5001}),
      )
    })

    it('polls health endpoint until sandbox is ready', async () => {
      const client = createMockClient()
      let callCount = 0
      client.getVersion.mockImplementation(async () => {
        callCount++
        if (callCount < 3) throw new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED)
        return {version: '3.4.9'}
      })
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({partyDetails: {}})

      const deps = createDefaultDeps({createClient: () => client})
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(callCount).toBe(3)
    })

    it('throws SANDBOX_HEALTH_TIMEOUT if health check never succeeds', async () => {
      const client = createMockClient()
      client.getVersion.mockRejectedValue(new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED))

      const deps = createDefaultDeps({createClient: () => client})
      const server = createDevServer(deps)

      await expect(server.start({...defaultOpts, healthTimeoutMs: 100}))
        .rejects.toThrow(CantonctlError)

      try {
        await server.start({...defaultOpts, healthTimeoutMs: 100})
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.SANDBOX_HEALTH_TIMEOUT)
      }
    })

    it('generates JWT token for sandbox auth', async () => {
      const deps = createDefaultDeps()
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(deps.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          actAs: expect.arrayContaining(['Alice', 'Bob']),
          admin: true,
          applicationId: 'cantonctl',
        }),
      )
    })

    it('provisions parties from config', async () => {
      const client = createMockClient()
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({
        partyDetails: {displayName: 'Alice', identifier: 'Alice::1234'},
      })

      const deps = createDefaultDeps({createClient: () => client})
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(client.allocateParty).toHaveBeenCalledWith(
        expect.objectContaining({displayName: 'Alice'}),
      )
      expect(client.allocateParty).toHaveBeenCalledWith(
        expect.objectContaining({displayName: 'Bob'}),
      )
    })

    it('skips already-existing parties (idempotent provisioning)', async () => {
      const client = createMockClient()
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({
        partyDetails: [{displayName: 'Alice', identifier: 'Alice::1234'}],
      })
      client.allocateParty.mockResolvedValue({partyDetails: {}})

      const output = createMockOutput()
      const deps = createDefaultDeps({createClient: () => client, output})
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      // Alice already exists — should not allocate
      expect(client.allocateParty).not.toHaveBeenCalledWith(
        expect.objectContaining({displayName: 'Alice'}),
      )
      // Bob should be allocated
      expect(client.allocateParty).toHaveBeenCalledWith(
        expect.objectContaining({displayName: 'Bob'}),
      )
      expect(output.info).toHaveBeenCalledWith(expect.stringContaining('already exists'))
    })

    it('starts file watcher on daml/ directory', async () => {
      const deps = createDefaultDeps()
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(deps.watch).toHaveBeenCalledWith(
        expect.stringContaining('daml'),
        expect.anything(),
      )
    })

    it('displays status after startup', async () => {
      const deps = createDefaultDeps()
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(deps.output.success).toHaveBeenCalledWith(expect.stringContaining('sandbox'))
    })

    it('handles getParties failure gracefully during provisioning', async () => {
      const client = createMockClient()
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockRejectedValue(new Error('not supported'))
      client.allocateParty.mockResolvedValue({partyDetails: {}})

      const deps = createDefaultDeps({createClient: () => client})
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      // Should still attempt allocation even if listing failed
      expect(client.allocateParty).toHaveBeenCalledTimes(2)
    })

    it('warns when allocateParty fails', async () => {
      const client = createMockClient()
      const output = createMockOutput()
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockRejectedValue(new Error('allocation error'))

      const deps = createDefaultDeps({createClient: () => client, output})
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to provision'))
    })

    it('skips party provisioning when config has no parties', async () => {
      const client = createMockClient()
      client.getVersion.mockResolvedValue({version: '3.4.9'})

      const deps = createDefaultDeps({
        config: {
          project: {name: 'test', 'sdk-version': '3.4.9'},
          version: 1,
        },
        createClient: () => client,
      })
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(client.allocateParty).not.toHaveBeenCalled()
    })

    it('respects AbortSignal on start', async () => {
      const deps = createDefaultDeps()
      const controller = new AbortController()
      controller.abort()

      const server = createDevServer(deps)
      await expect(server.start({...defaultOpts, signal: controller.signal}))
        .rejects.toThrow()
    })
  })

  describe('port checking', () => {
    it('throws SANDBOX_PORT_IN_USE if Canton port is occupied', async () => {
      const deps = createDefaultDeps({
        isPortInUse: vi.fn().mockImplementation(async (port: number) => port === 5001),
      })
      const server = createDevServer(deps)

      await expect(server.start(defaultOpts)).rejects.toThrow(CantonctlError)
      try {
        await server.start(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).code).toBe(ErrorCode.SANDBOX_PORT_IN_USE)
        expect((err as CantonctlError).context.port).toBe(5001)
      }
    })

    it('throws SANDBOX_PORT_IN_USE if JSON API port is occupied', async () => {
      const deps = createDefaultDeps({
        isPortInUse: vi.fn().mockImplementation(async (port: number) => port === 7575),
      })
      const server = createDevServer(deps)

      await expect(server.start(defaultOpts)).rejects.toThrow(CantonctlError)
      try {
        await server.start(defaultOpts)
      } catch (err) {
        expect((err as CantonctlError).context.port).toBe(7575)
      }
    })

    it('proceeds when ports are free', async () => {
      const deps = createDefaultDeps({
        isPortInUse: vi.fn().mockResolvedValue(false),
      })
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      expect(deps.sdk.startSandbox).toHaveBeenCalled()
    })

    it('skips port check when isPortInUse is not provided', async () => {
      const deps = createDefaultDeps()
      delete (deps as Partial<DevServerDeps>).isPortInUse
      const server = createDevServer(deps)
      // Should not throw even without port checking
      await server.start(defaultOpts)
    })
  })

  describe('sandbox process exit detection', () => {
    it('throws SANDBOX_START_FAILED if sandbox exits during health polling', async () => {
      const mockProc = createMockProcess()
      const sdk = createMockSdk()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(mockProc)

      const client = createMockClient()
      let healthCallCount = 0
      client.getVersion.mockImplementation(async () => {
        healthCallCount++
        // After first health check, simulate sandbox exit
        if (healthCallCount === 1) {
          for (const cb of mockProc._exitCallbacks) cb(1)
        }

        throw new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED)
      })

      const deps = createDefaultDeps({createClient: () => client, sdk})
      const server = createDevServer(deps)

      try {
        await server.start({...defaultOpts, healthTimeoutMs: 5000})
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(CantonctlError)
        expect((err as CantonctlError).code).toBe(ErrorCode.SANDBOX_START_FAILED)
      }
    })
  })

  describe('stop()', () => {
    it('kills sandbox process', async () => {
      const mockProc = createMockProcess()
      const sdk = createMockSdk()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(mockProc)

      const deps = createDefaultDeps({sdk})
      const server = createDevServer(deps)
      await server.start(defaultOpts)
      await server.stop()

      expect(mockProc.kill).toHaveBeenCalled()
    })

    it('closes file watcher', async () => {
      const watcher = createMockWatcher()
      const deps = createDefaultDeps({watch: vi.fn().mockReturnValue(watcher)})
      const server = createDevServer(deps)
      await server.start(defaultOpts)
      await server.stop()

      expect(watcher.close).toHaveBeenCalled()
    })

    it('is safe to call stop() without start()', async () => {
      const deps = createDefaultDeps()
      const server = createDevServer(deps)
      await server.stop()
    })
  })

  describe('hot-reload', () => {
    it('rebuilds and uploads DAR on .daml file change', async () => {
      vi.useFakeTimers()
      const watcher = createMockWatcher()
      const sdk = createMockSdk()
      const client = createMockClient()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(createMockProcess())
      sdk.build.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'built', success: true})
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({partyDetails: {}})
      client.uploadDar.mockResolvedValue({mainPackageId: 'pkg-456'})

      const findDarFile = vi.fn().mockResolvedValue('/project/.daml/dist/app-1.0.0.dar')
      const readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))

      const deps = createDefaultDeps({
        createClient: () => client,
        findDarFile,
        readFile,
        sdk,
        watch: vi.fn().mockReturnValue(watcher),
      })
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      // Simulate .daml file change — triggers debounced handler
      watcher.handlers.change('/project/daml/Main.daml')
      await vi.runAllTimersAsync()

      expect(sdk.build).toHaveBeenCalledWith(
        expect.objectContaining({projectDir: '/project'}),
      )
      expect(findDarFile).toHaveBeenCalled()
      expect(readFile).toHaveBeenCalledWith('/project/.daml/dist/app-1.0.0.dar')
      expect(client.uploadDar).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('ignores non-.daml file changes', async () => {
      vi.useFakeTimers()
      const watcher = createMockWatcher()
      const sdk = createMockSdk()
      const client = createMockClient()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(createMockProcess())
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({partyDetails: {}})

      const deps = createDefaultDeps({
        createClient: () => client,
        sdk,
        watch: vi.fn().mockReturnValue(watcher),
      })
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      watcher.handlers.change('/project/daml/.DS_Store')
      await vi.runAllTimersAsync()

      expect(sdk.build).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('handles missing .dar gracefully', async () => {
      vi.useFakeTimers()
      const watcher = createMockWatcher()
      const sdk = createMockSdk()
      const client = createMockClient()
      const output = createMockOutput()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(createMockProcess())
      sdk.build.mockResolvedValue({exitCode: 0, stderr: '', stdout: 'built', success: true})
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({partyDetails: {}})

      const deps = createDefaultDeps({
        createClient: () => client,
        findDarFile: vi.fn().mockResolvedValue(null),
        output,
        sdk,
        watch: vi.fn().mockReturnValue(watcher),
      })
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      watcher.handlers.change('/project/daml/Main.daml')
      await vi.runAllTimersAsync()

      expect(output.info).toHaveBeenCalledWith(expect.stringContaining('no .dar'))
      vi.useRealTimers()
    })

    it('reports build errors without crashing', async () => {
      vi.useFakeTimers()
      const watcher = createMockWatcher()
      const sdk = createMockSdk()
      const client = createMockClient()
      const output = createMockOutput()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(createMockProcess())
      sdk.build.mockRejectedValue(new CantonctlError(ErrorCode.BUILD_DAML_ERROR, {
        context: {stderr: 'syntax error'},
      }))
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({partyDetails: {}})

      const deps = createDefaultDeps({
        createClient: () => client,
        output,
        sdk,
        watch: vi.fn().mockReturnValue(watcher),
      })
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      watcher.handlers.change('/project/daml/Main.daml')
      await vi.runAllTimersAsync()

      expect(output.error).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('queues rebuild if one is already in progress', async () => {
      const watcher = createMockWatcher()
      const sdk = createMockSdk()
      const client = createMockClient()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(createMockProcess())
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({partyDetails: {}})
      client.uploadDar.mockResolvedValue({mainPackageId: 'pkg'})

      let buildCallCount = 0
      let resolveFirstBuild: (() => void) | null = null
      sdk.build.mockImplementation(async () => {
        buildCallCount++
        if (buildCallCount === 1) {
          // First build blocks until we release it
          await new Promise<void>(resolve => { resolveFirstBuild = resolve })
        }

        return {exitCode: 0, stderr: '', stdout: 'built', success: true}
      })

      // Use debounceMs: 0 — the change handler calls triggerReload directly via setTimeout(fn, 0)
      const deps = createDefaultDeps({
        createClient: () => client,
        sdk,
        watch: vi.fn().mockReturnValue(watcher),
      })
      const server = createDevServer(deps)
      await server.start({...defaultOpts, debounceMs: 0})

      // Trigger first change — starts build 1 which blocks
      watcher.handlers.change('/project/daml/Main.daml')
      // Give the setTimeout(fn, 0) time to fire
      await new Promise(r => setTimeout(r, 10))
      expect(buildCallCount).toBe(1)

      // Trigger second change while build 1 is in progress — should queue
      watcher.handlers.change('/project/daml/Other.daml')
      await new Promise(r => setTimeout(r, 10))

      // Release build 1 — should trigger queued build 2
      resolveFirstBuild!()
      await new Promise(r => setTimeout(r, 50))

      expect(buildCallCount).toBe(2)
    })

    it('stop() clears pending debounce timer', async () => {
      const watcher = createMockWatcher()
      const sdk = createMockSdk()
      const client = createMockClient()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(createMockProcess())
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({partyDetails: {}})

      const deps = createDefaultDeps({
        createClient: () => client,
        sdk,
        watch: vi.fn().mockReturnValue(watcher),
      })
      const server = createDevServer(deps)
      // Use a real (but short) debounce so the timer is pending
      await server.start({...defaultOpts, debounceMs: 5000})

      // Trigger change — sets debounce timer
      watcher.handlers.change('/project/daml/Main.daml')

      // Stop immediately — should clear the pending timer without error
      await server.stop()

      // Build should NOT have been called (timer was cleared)
      expect(sdk.build).not.toHaveBeenCalled()
    })

    it('handles non-CantonctlError in build (generic Error)', async () => {
      vi.useFakeTimers()
      const watcher = createMockWatcher()
      const sdk = createMockSdk()
      const client = createMockClient()
      const output = createMockOutput()
      sdk.detect.mockResolvedValue({path: '/bin/dpm', tool: 'dpm', version: '3.4.9'})
      sdk.startSandbox.mockResolvedValue(createMockProcess())
      sdk.build.mockRejectedValue(new Error('unexpected crash'))
      client.getVersion.mockResolvedValue({version: '3.4.9'})
      client.getParties.mockResolvedValue({partyDetails: []})
      client.allocateParty.mockResolvedValue({partyDetails: {}})

      const deps = createDefaultDeps({
        createClient: () => client,
        output,
        sdk,
        watch: vi.fn().mockReturnValue(watcher),
      })
      const server = createDevServer(deps)
      await server.start(defaultOpts)

      watcher.handlers.change('/project/daml/Main.daml')
      await vi.runAllTimersAsync()

      expect(output.error).toHaveBeenCalledWith(expect.stringContaining('unexpected crash'))
      vi.useRealTimers()
    })
  })

  describe('pollHealth edge cases', () => {
    it('respects AbortSignal during health polling', async () => {
      const client = createMockClient()
      const controller = new AbortController()
      let callCount = 0
      client.getVersion.mockImplementation(async () => {
        callCount++
        if (callCount >= 2) controller.abort()
        throw new CantonctlError(ErrorCode.LEDGER_CONNECTION_FAILED)
      })

      const deps = createDefaultDeps({createClient: () => client})
      const server = createDevServer(deps)

      await expect(server.start({...defaultOpts, signal: controller.signal}))
        .rejects.toThrow()
    })
  })
})
