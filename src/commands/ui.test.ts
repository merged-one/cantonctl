import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {captureOutput} from '@oclif/test'
import {describe, expect, it, vi} from 'vitest'

import {CantonctlError, ErrorCode} from '../lib/errors.js'
import type {UiController} from '../lib/ui/controller.js'
import type {UiServer} from '../lib/ui/server.js'

import Ui from './ui.js'

const CLI_ROOT = process.cwd()

function createStubController(): UiController {
  return {
    getChecks: vi.fn(async () => ({
      auth: {authenticated: true, envVarName: 'JWT', mode: 'bearer-token', source: 'stored', warnings: []},
      canary: {checks: [], selectedSuites: [], skippedSuites: [], success: true},
      compatibility: {checks: [], failed: 0, passed: 1, warned: 0},
      doctor: {checks: [], failed: 0, passed: 1, warned: 0},
      preflight: {
        checks: [],
        network: {checklist: [], name: 'local', reminders: [], resetExpectation: 'local-only', tier: 'local'},
        success: true,
      },
      profile: {kind: 'sandbox', name: 'sandbox'},
      readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
    } as never)),
    getMap: vi.fn(async () => ({
      autoPoll: false,
      edges: [],
      findings: [],
      groups: [],
      mode: 'sandbox',
      nodes: [],
      overlays: ['health', 'parties', 'ports', 'auth', 'checks'],
      profile: {kind: 'sandbox', name: 'sandbox'},
      summary: {
        detail: 'Sandbox profile on local.',
        headline: 'Mapped surfaces healthy',
        readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
      },
    } as never)),
    getOverview: vi.fn(async () => ({
      advisories: [],
      environmentPath: [],
      profile: {kind: 'sandbox', name: 'sandbox'},
      readiness: {failed: 0, passed: 1, skipped: 0, success: true, warned: 0},
      services: [],
    } as never)),
    getProfiles: vi.fn(async () => ({
      profiles: [],
      selected: {
        auth: {authenticated: true, mode: 'bearer-token', source: 'stored', warnings: []},
        experimental: false,
        imports: {},
        json: {},
        kind: 'sandbox',
        name: 'sandbox',
        networkMappings: [],
        networkName: 'local',
        services: [],
        validation: {detail: 'valid', valid: true},
        yaml: 'profiles: {}',
      },
    } as never)),
    getRuntime: vi.fn(async () => ({autoPoll: false, mode: 'sandbox', profile: {kind: 'sandbox', name: 'sandbox'}} as never)),
    getSession: vi.fn(async ({requestedProfile}: {requestedProfile?: string} = {}) => ({
      configPath: '/repo/cantonctl.yaml',
      defaultProfile: 'sandbox',
      profiles: [],
      project: {name: 'demo', sdkVersion: '3.4.11'},
      requestedProfile,
      selectedProfile: requestedProfile ?? 'sandbox',
      storageKey: 'cantonctl-ui:/repo/cantonctl.yaml',
    })),
    getSupport: vi.fn(async () => ({defaults: {diagnosticsOutputDir: '/tmp', exportTargets: ['dapp-sdk']}, profile: {kind: 'sandbox', name: 'sandbox'}} as never)),
  }
}

describe('ui command', () => {
  it('starts the control center and opens the browser by default', async () => {
    const openBrowser = vi.fn()
    const stop = vi.fn().mockResolvedValue(undefined)

    class TestUi extends Ui {
      protected override createUiServer() {
        return {
          start: vi.fn().mockResolvedValue({
            host: '127.0.0.1',
            port: 4780,
            url: 'http://127.0.0.1:4780',
          }),
          stop,
        }
      }

      protected override async openBrowser(url: string): Promise<void> {
        openBrowser(url)
      }

      protected override async waitForShutdown(server: ReturnType<TestUi['createUiServer']>): Promise<void> {
        await server.stop()
      }
    }

    const result = await captureOutput(() => TestUi.run(['--profile', 'splice-devnet'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('http://127.0.0.1:4780/?profile=splice-devnet')
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4780/?profile=splice-devnet')
    expect(stop).toHaveBeenCalled()
  })

  it('respects --no-open and preserves port wiring', async () => {
    const openBrowser = vi.fn()

    class TestUi extends Ui {
      protected override createUiServer(requestedProfile?: string) {
        expect(requestedProfile).toBe('sandbox')
        return {
          start: vi.fn().mockResolvedValue({
            host: '127.0.0.1',
            port: 4999,
            url: 'http://127.0.0.1:4999',
          }),
          stop: vi.fn().mockResolvedValue(undefined),
        }
      }

      protected override async openBrowser(url: string): Promise<void> {
        openBrowser(url)
      }

      protected override async waitForShutdown(): Promise<void> {
        return
      }
    }

    const result = await captureOutput(() => TestUi.run(['--profile', 'sandbox', '--port', '4999', '--no-open'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('http://127.0.0.1:4999/?profile=sandbox')
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('prints the base control-center URL when no profile is requested', async () => {
    class TestUi extends Ui {
      protected override createUiServer() {
        return {
          start: vi.fn().mockResolvedValue({
            host: '127.0.0.1',
            port: 4680,
            url: 'http://127.0.0.1:4680',
          }),
          stop: vi.fn().mockResolvedValue(undefined),
        }
      }

      protected override async waitForShutdown(): Promise<void> {
        return
      }
    }

    const result = await captureOutput(() => TestUi.run(['--no-open'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Control center: http://127.0.0.1:4680')
    expect(result.stdout).not.toContain('?profile=')
  })

  it('formats CantonctlError failures through the oclif error path', async () => {
    class TestUi extends Ui {
      protected override createUiServer(): UiServer {
        throw new CantonctlError(ErrorCode.SANDBOX_PORT_IN_USE, {
          suggestion: 'Pick another port.',
        })
      }
    }

    const result = await captureOutput(() => TestUi.run([], {root: CLI_ROOT}))
    expect(result.error?.message).toContain('Error E3002: The requested port is already in use.')
    expect(result.error?.message).toContain('Suggestion: Pick another port.')
  })

  it('rethrows unexpected startup failures after the command wrapper inspects them', async () => {
    class TestUi extends Ui {
      protected override createUiServer(): UiServer {
        throw new Error('unexpected boom')
      }
    }

    const result = await captureOutput(() => TestUi.run([], {root: CLI_ROOT}))
    expect(result.error?.message).toBe('unexpected boom')
  })

  it('wraps session selection when a requested profile is provided', async () => {
    const controller = createStubController()

    class TestUi extends Ui {
      public exposeCreateUiControllerWithProfile(requestedProfile?: string): UiController {
        return super.createUiControllerWithProfile(requestedProfile)
      }

      protected override createUiController(): UiController {
        return controller
      }
    }

    const command = new TestUi([], {} as never)
    const wrapped = command.exposeCreateUiControllerWithProfile('splice-devnet')
    await wrapped.getSession()
    expect(controller.getSession).toHaveBeenCalledWith({requestedProfile: 'splice-devnet'})

    await wrapped.getSession({requestedProfile: 'sandbox'})
    expect(controller.getSession).toHaveBeenCalledWith({requestedProfile: 'sandbox'})

    const passthrough = command.exposeCreateUiControllerWithProfile()
    expect(passthrough).toBe(controller)
  })

  it('creates the default controller shape when no override is provided', () => {
    class TestUi extends Ui {
      public exposeCreateUiController(): UiController {
        return super.createUiController()
      }
    }

    const controller = new TestUi([], {} as never).exposeCreateUiController()
    expect(controller).toEqual(expect.objectContaining({
      getChecks: expect.any(Function),
      getMap: expect.any(Function),
      getOverview: expect.any(Function),
      getProfiles: expect.any(Function),
      getRuntime: expect.any(Function),
      getSession: expect.any(Function),
      getSupport: expect.any(Function),
    }))
  })

  it('chooses the correct browser opener per platform without spawning a real process', async () => {
    const cases: Array<{args: string[]; command: string; platform: NodeJS.Platform}> = [
      {args: ['http://127.0.0.1:4680'], command: 'open', platform: 'darwin'},
      {args: ['/c', 'start', '', 'http://127.0.0.1:4680'], command: 'cmd', platform: 'win32'},
      {args: ['http://127.0.0.1:4680'], command: 'xdg-open', platform: 'linux'},
    ]

    for (const scenario of cases) {
      class TestUi extends Ui {
        spawned: {args: string[]; command: string} | undefined

        public async exposeOpenBrowser(url: string): Promise<void> {
          await super.openBrowser(url)
        }

        protected override platform(): NodeJS.Platform {
          return scenario.platform
        }

        protected override async spawnDetached(command: string, args: string[]): Promise<void> {
          this.spawned = {args, command}
        }
      }

      const command = new TestUi([], {} as never)
      await command.exposeOpenBrowser('http://127.0.0.1:4680')
      expect(command.spawned).toEqual({
        args: scenario.args,
        command: scenario.command,
      })
    }
  })

  it('uses the default platform, signal registration, and detached spawn helpers', async () => {
    class TestUi extends Ui {
      public exposeOnceSignal(signal: NodeJS.Signals, handler: () => void): void {
        super.onceSignal(signal, handler)
      }

      public exposePlatform(): NodeJS.Platform {
        return super.platform()
      }

      public async exposeSpawnDetached(command: string, args: string[]): Promise<void> {
        await super.spawnDetached(command, args)
      }
    }

    const command = new TestUi([], {} as never)
    expect(command.exposePlatform()).toBe(process.platform)

    const signal = 'SIGUSR2' as NodeJS.Signals
    const before = process.listeners(signal)
    command.exposeOnceSignal(signal, () => undefined)
    const after = process.listeners(signal)
    expect(after.length).toBe(before.length + 1)
    const wrapped = after.at(-1)
    if (wrapped) {
      process.removeListener(signal, wrapped as (...args: any[]) => void)
    }

    await expect(command.exposeSpawnDetached(process.execPath, ['-e', 'process.exit(0)'])).resolves.toBeUndefined()
    await expect(command.exposeSpawnDetached('/definitely-missing-command', [])).resolves.toBeUndefined()
  })

  it('stops the server when a registered signal fires and propagates stop failures', async () => {
    class TestUi extends Ui {
      handlers = new Map<NodeJS.Signals, () => void>()

      public async exposeWaitForShutdown(server: UiServer, signal: NodeJS.Signals): Promise<void> {
        const waiting = super.waitForShutdown(server)
        this.handlers.get(signal)?.()
        return waiting
      }

      protected override onceSignal(signal: NodeJS.Signals, handler: () => void): void {
        this.handlers.set(signal, handler)
      }
    }

    const command = new TestUi([], {} as never)
    const stop = vi.fn().mockResolvedValue(undefined)
    await command.exposeWaitForShutdown({start: vi.fn() as never, stop}, 'SIGINT')
    expect(stop).toHaveBeenCalledTimes(1)
    expect([...command.handlers.keys()]).toEqual(['SIGINT', 'SIGTERM'])

    const failing = new TestUi([], {} as never)
    const failure = new Error('stop failed')
    await expect(failing.exposeWaitForShutdown({start: vi.fn() as never, stop: vi.fn().mockRejectedValue(failure)}, 'SIGTERM')).rejects.toThrow('stop failed')
  })

  it('creates a default UI server from the resolved asset directory', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cantonctl-ui-command-'))
    const distDir = path.join(tempDir, 'dist', 'ui')
    await fs.mkdir(distDir, {recursive: true})
    await fs.writeFile(path.join(distDir, 'index.html'), '<!doctype html><html><head></head><body>shell</body></html>', 'utf8')

    class TestUi extends Ui {
      public exposeCreateUiServer(requestedProfile?: string): UiServer {
        return super.createUiServer(requestedProfile)
      }

      protected override createUiController(): UiController {
        return createStubController()
      }
    }

    const previousCwd = process.cwd()
    process.chdir(tempDir)
    try {
      const command = new TestUi([], {} as never)
      const server = command.exposeCreateUiServer('sandbox')
      const started = await server.start({port: 0})
      expect(started.url.startsWith('http://127.0.0.1:')).toBe(true)
      await server.stop()
    } finally {
      process.chdir(previousCwd)
      await fs.rm(tempDir, {force: true, recursive: true})
    }
  })
})
