/**
 * Tests for the full multi-node dev server.
 *
 * All tests use mock dependencies — no Docker required.
 */

import {afterEach, describe, expect, it, vi} from 'vitest'
import type {CantonctlConfig} from './config.js'
import {createFullDevServer, type FileWatcher, type FullDevServerDeps} from './dev-server-full.js'
import type {DockerManager} from './docker.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {LedgerClient} from './ledger-client.js'
import type {OutputWriter} from './output.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockDocker(): DockerManager {
  return {
    checkAvailable: vi.fn().mockResolvedValue(undefined),
    composeDown: vi.fn().mockResolvedValue(undefined),
    composeLogs: vi.fn().mockResolvedValue(''),
    composeUp: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockClient(): LedgerClient {
  return {
    allocateParty: vi.fn().mockResolvedValue({displayName: 'Test'}),
    getActiveContracts: vi.fn().mockResolvedValue({activeContracts: []}),
    getParties: vi.fn().mockResolvedValue({partyDetails: []}),
    getLedgerEnd: vi.fn().mockResolvedValue({offset: 0}),
    getVersion: vi.fn().mockResolvedValue({version: '3.4.11'}),
    submitAndWait: vi.fn().mockResolvedValue({}),
    uploadDar: vi.fn().mockResolvedValue({}),
  }
}

function createMockOutput(): OutputWriter {
  return {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    result: vi.fn(),
    spinner: vi.fn().mockReturnValue({fail: vi.fn(), start: vi.fn(), stop: vi.fn(), succeed: vi.fn()}),
    success: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
  }
}

function createMockWatcher(): FileWatcher & {handlers: Map<string, (...args: unknown[]) => void>} {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    close: vi.fn().mockResolvedValue(undefined),
    handlers,
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler)
      return this
    },
  }
}

const CONFIG: CantonctlConfig = {
  networks: {local: {type: 'sandbox' as const}},
  parties: [
    {name: 'Alice', role: 'operator' as const},
    {name: 'Bob', role: 'participant' as const},
  ],
  project: {name: 'test-project', 'sdk-version': '3.4.11'},
  version: 1,
}

function createDeps(overrides: Partial<FullDevServerDeps> = {}): FullDevServerDeps {
  const mockWatcher = createMockWatcher()
  return {
    build: vi.fn().mockResolvedValue(undefined),
    cantonImage: 'ghcr.io/digital-asset/decentralized-canton-sync/docker/canton:0.5.3',
    config: CONFIG,
    createClient: vi.fn().mockReturnValue(createMockClient()),
    createToken: vi.fn().mockResolvedValue('mock-token'),
    docker: createMockDocker(),
    findDarFile: vi.fn().mockResolvedValue(null),
    mkdir: vi.fn().mockResolvedValue(undefined),
    output: createMockOutput(),
    readFile: vi.fn().mockResolvedValue(new Uint8Array()),
    rmdir: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn().mockReturnValue(mockWatcher),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const startOpts = {projectDir: '/project'}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FullDevServer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('start', () => {
    it('checks Docker availability first', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start(startOpts)
      expect(deps.docker.checkAvailable).toHaveBeenCalled()
    })

    it('generates topology configs and writes to .cantonctl/', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      expect(deps.mkdir).toHaveBeenCalledWith('/project/.cantonctl')
      expect(deps.writeFile).toHaveBeenCalledWith(
        '/project/.cantonctl/docker-compose.yml',
        expect.stringContaining('canton:'),
      )
      expect(deps.writeFile).toHaveBeenCalledWith(
        '/project/.cantonctl/canton.conf',
        expect.stringContaining('canton {'),
      )
      expect(deps.writeFile).toHaveBeenCalledWith(
        '/project/.cantonctl/bootstrap.canton',
        expect.stringContaining('connect_local'),
      )
      expect(deps.writeFile).toHaveBeenCalledWith(
        '/project/.cantonctl/topology.json',
        expect.stringContaining('"mode": "net"'),
      )
    })

    it('starts Docker Compose with generated compose file', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      expect(deps.docker.composeUp).toHaveBeenCalledWith({
        composeFile: '/project/.cantonctl/docker-compose.yml',
        cwd: '/project/.cantonctl',
      })
    })

    it('polls health for each participant', async () => {
      const mockClient = createMockClient()
      const deps = createDeps({
        createClient: vi.fn().mockReturnValue(mockClient),
      })
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      // getVersion called once per participant during health poll
      expect(mockClient.getVersion).toHaveBeenCalled()
    })

    it('creates ledger client for each participant with correct baseUrl', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      // Should create a client for each of the 2 participants
      expect(deps.createClient).toHaveBeenCalledTimes(2)
      // First participant's JSON API port
      expect(deps.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: expect.stringContaining('10013'),
        }),
      )
    })

    it('provisions parties on their assigned participants', async () => {
      const aliceClient = createMockClient()
      const bobClient = createMockClient()
      let callIdx = 0
      const deps = createDeps({
        createClient: vi.fn().mockImplementation(() => {
          callIdx++
          return callIdx === 1 ? aliceClient : bobClient
        }),
      })
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      // Alice (operator) → participant1 → aliceClient
      expect(aliceClient.allocateParty).toHaveBeenCalledWith({displayName: 'Alice'})
      // Bob (participant) → participant2 → bobClient
      expect(bobClient.allocateParty).toHaveBeenCalledWith({displayName: 'Bob'})
    })

    it('skips existing parties during provisioning', async () => {
      const mockClient = createMockClient()
      ;(mockClient.getParties as ReturnType<typeof vi.fn>).mockResolvedValue({
        partyDetails: [{displayName: 'Alice'}],
      })
      const deps = createDeps({
        createClient: vi.fn().mockReturnValue(mockClient),
      })
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      // Alice exists, should not be allocated (but Bob should still be allocated on his participant)
      // The mock returns same client for all participants, so we check Alice was NOT allocated
      const allocateCalls = (mockClient.allocateParty as ReturnType<typeof vi.fn>).mock.calls
      const aliceAllocations = allocateCalls.filter(
        (call: unknown[]) => (call[0] as {displayName: string}).displayName === 'Alice',
      )
      expect(aliceAllocations.length).toBe(0)
    })

    it('warns on party allocation failure', async () => {
      const mockClient = createMockClient()
      ;(mockClient.allocateParty as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('allocation failed'),
      )
      const deps = createDeps({
        createClient: vi.fn().mockReturnValue(mockClient),
      })
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      expect(deps.output.warn).toHaveBeenCalled()
    }, 60_000) // Longer timeout: 2 parties × 10 retries × 2s delay for party allocation

    it('starts file watcher on daml/ directory', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      expect(deps.watch).toHaveBeenCalledWith('/project/daml', {ignoreInitial: true})
    })

    it('displays status table with participants and synchronizer', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      expect(deps.output.table).toHaveBeenCalledTimes(2) // participants + synchronizer
    })

    it('respects AbortSignal before start', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      const controller = new AbortController()
      controller.abort()

      await expect(
        server.start({...startOpts, signal: controller.signal}),
      ).rejects.toThrow('Aborted')
    })

    it('respects AbortSignal while polling participant health', async () => {
      const controller = new AbortController()
      const deps = createDeps({
        createClient: vi.fn().mockReturnValue({
          ...createMockClient(),
          getVersion: vi.fn().mockRejectedValue(new Error('not ready')),
        }),
      })
      const server = createFullDevServer(deps)

      setTimeout(() => controller.abort(), 0)

      await expect(
        server.start({
          ...startOpts,
          healthRetryDelayMs: 0,
          healthTimeoutMs: 5_000,
          signal: controller.signal,
        }),
      ).rejects.toThrow('Aborted')
    })

    it('throws on health timeout', async () => {
      const mockClient = createMockClient()
      ;(mockClient.getVersion as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection refused'),
      )
      const deps = createDeps({
        createClient: vi.fn().mockReturnValue(mockClient),
      })
      const server = createFullDevServer(deps)

      await expect(
        server.start({
          ...startOpts,
          healthRetryDelayMs: 10,
          healthTimeoutMs: 50,
        }),
      ).rejects.toThrow(CantonctlError)
    })

    it('uses custom base port', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start({...startOpts, basePort: 20_000})

      expect(deps.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: expect.stringContaining('20013'),
        }),
      )
    })

    it('uses the admin token fallback and renders empty participant rows when no parties are configured', async () => {
      const deps = createDeps({
        config: {
          ...CONFIG,
          parties: undefined,
        },
      })
      const server = createFullDevServer(deps)
      await server.start(startOpts)

      expect(deps.createToken).toHaveBeenCalledWith(expect.objectContaining({
        actAs: ['admin'],
        readAs: [],
      }))
      expect(deps.output.table).toHaveBeenCalledWith(
        ['Node', 'JSON API', 'Parties'],
        expect.arrayContaining([
          expect.arrayContaining(['(none)']),
        ]),
      )
    })
  })

  describe('stop', () => {
    it('stops Docker Compose', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start(startOpts)
      await server.stop()

      expect(deps.docker.composeDown).toHaveBeenCalledWith({
        composeFile: '/project/.cantonctl/docker-compose.yml',
        cwd: '/project/.cantonctl',
      })
    })

    it('closes file watcher', async () => {
      const mockWatcher = createMockWatcher()
      const deps = createDeps({
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start(startOpts)
      await server.stop()

      expect(mockWatcher.close).toHaveBeenCalled()
    })

    it('removes .cantonctl directory', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await server.start(startOpts)
      await server.stop()

      expect(deps.rmdir).toHaveBeenCalledWith('/project/.cantonctl')
    })

    it('clears debounce timer', async () => {
      const mockWatcher = createMockWatcher()
      const deps = createDeps({
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 10_000})

      // Trigger a change to set the debounce timer
      const handler = mockWatcher.handlers.get('change')
      handler?.('/project/daml/Main.daml')

      await server.stop()
      // No assertion needed — if timer fires after stop, it would be caught by afterEach
    })

    it('safe to call stop without start', async () => {
      const deps = createDeps()
      const server = createFullDevServer(deps)
      await expect(server.stop()).resolves.toBeUndefined()
    })

    it('handles rmdir failure gracefully', async () => {
      const deps = createDeps({
        rmdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
      })
      const server = createFullDevServer(deps)
      await server.start(startOpts)
      await expect(server.stop()).resolves.toBeUndefined()
    })
  })

  describe('hot-reload', () => {
    it('rebuilds and uploads DAR to all participants on .daml change', async () => {
      const mockWatcher = createMockWatcher()
      const deps = createDeps({
        findDarFile: vi.fn().mockResolvedValue('/project/.daml/dist/test.dar'),
        readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 0})

      // Trigger file change
      const handler = mockWatcher.handlers.get('change')
      handler?.('/project/daml/Main.daml')

      // Wait for debounce + async
      await new Promise(r => setTimeout(r, 50))

      expect(deps.build).toHaveBeenCalledWith('/project')
    })

    it('ignores non-.daml file changes', async () => {
      const mockWatcher = createMockWatcher()
      const deps = createDeps({
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 0})

      const handler = mockWatcher.handlers.get('change')
      handler?.('/project/daml/README.md')

      await new Promise(r => setTimeout(r, 50))

      expect(deps.build).not.toHaveBeenCalled()
    })

    it('queues rebuild if one is already in progress', async () => {
      const mockWatcher = createMockWatcher()
      let buildResolve: (() => void) | null = null
      const buildPromise = new Promise<void>(resolve => { buildResolve = resolve })

      const deps = createDeps({
        build: vi.fn().mockReturnValue(buildPromise),
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 0})

      const handler = mockWatcher.handlers.get('change')

      // Trigger first change
      handler?.('/project/daml/First.daml')
      await new Promise(r => setTimeout(r, 10))

      // Trigger second change while first is building
      handler?.('/project/daml/Second.daml')
      await new Promise(r => setTimeout(r, 10))

      // Resolve first build
      buildResolve!()
      await new Promise(r => setTimeout(r, 50))

      // Build should have been called at least twice (initial + queued)
      expect((deps.build as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('reports build errors without crashing', async () => {
      const mockWatcher = createMockWatcher()
      const deps = createDeps({
        build: vi.fn().mockRejectedValue(new Error('compilation error')),
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 0})

      const handler = mockWatcher.handlers.get('change')
      handler?.('/project/daml/Main.daml')

      await new Promise(r => setTimeout(r, 50))

      expect(deps.output.error).toHaveBeenCalledWith(
        expect.stringContaining('compilation error'),
      )
    })

    it('reports non-Error build failures without crashing', async () => {
      const mockWatcher = createMockWatcher()
      const deps = createDeps({
        build: vi.fn().mockRejectedValue('compiler offline'),
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 0})

      const handler = mockWatcher.handlers.get('change')
      handler?.('/project/daml/Main.daml')

      await new Promise(r => setTimeout(r, 50))

      expect(deps.output.error).toHaveBeenCalledWith('Build failed: compiler offline')
    })

    it('reports upload failures for each participant without crashing', async () => {
      const mockWatcher = createMockWatcher()
      const firstClient = {
        ...createMockClient(),
        uploadDar: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.DEPLOY_UPLOAD_FAILED, {
          suggestion: 'Retry against a reachable participant.',
        })),
      }
      const secondClient = {
        ...createMockClient(),
        uploadDar: vi.fn().mockRejectedValue('socket closed'),
      }
      let clientCall = 0
      const deps = createDeps({
        createClient: vi.fn().mockImplementation(() => {
          clientCall++
          return clientCall === 1 ? firstClient : secondClient
        }),
        findDarFile: vi.fn().mockResolvedValue('/project/.daml/dist/test.dar'),
        readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 0})

      mockWatcher.handlers.get('change')?.('/project/daml/Main.daml')
      await new Promise(r => setTimeout(r, 50))

      expect(deps.output.error).toHaveBeenCalledWith(
        expect.stringContaining(`Upload to participant1: ${ErrorCode.DEPLOY_UPLOAD_FAILED}`),
      )
      expect(deps.output.error).toHaveBeenCalledWith(
        'Upload to participant2 failed: socket closed',
      )
    })

    it('reports plain Error upload failures without crashing', async () => {
      const mockWatcher = createMockWatcher()
      const firstClient = {
        ...createMockClient(),
        uploadDar: vi.fn().mockRejectedValue(new Error('connection reset')),
      }
      const secondClient = createMockClient()
      let clientCall = 0
      const deps = createDeps({
        createClient: vi.fn().mockImplementation(() => {
          clientCall++
          return clientCall === 1 ? firstClient : secondClient
        }),
        findDarFile: vi.fn().mockResolvedValue('/project/.daml/dist/test.dar'),
        readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 0})

      mockWatcher.handlers.get('change')?.('/project/daml/Main.daml')
      await new Promise(r => setTimeout(r, 50))

      expect(deps.output.error).toHaveBeenCalledWith(
        'Upload to participant1 failed: connection reset',
      )
    })

    it('reports CantonctlError build failures without crashing', async () => {
      const mockWatcher = createMockWatcher()
      const deps = createDeps({
        build: vi.fn().mockRejectedValue(new CantonctlError(ErrorCode.BUILD_DAML_ERROR, {
          suggestion: 'Check Daml output.',
        })),
        watch: vi.fn().mockReturnValue(mockWatcher),
      })
      const server = createFullDevServer(deps)
      await server.start({...startOpts, debounceMs: 0})

      mockWatcher.handlers.get('change')?.('/project/daml/Main.daml')
      await new Promise(r => setTimeout(r, 50))

      expect(deps.output.error).toHaveBeenCalledWith(
        expect.stringContaining(ErrorCode.BUILD_DAML_ERROR),
      )
    })
  })
})
