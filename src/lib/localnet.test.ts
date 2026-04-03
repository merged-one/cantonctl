import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import {describe, expect, it, vi} from 'vitest'

import {createLocalnet, parseLocalnetStatusOutput} from './localnet.js'
import {createLocalnetWorkspaceDetector} from './localnet-workspace.js'
import type {ProcessRunner} from './process-runner.js'

const FIXTURE_ROOT = path.resolve(process.cwd(), 'test/fixtures/localnet-workspace')
const QUICKSTART_FIXTURE = path.join(FIXTURE_ROOT, 'quickstart')
const INVALID_FIXTURE = path.join(FIXTURE_ROOT, 'missing-localnet-module')

const STATUS_OUTPUT = `NAME      IMAGE         COMMAND         SERVICE   CREATED          STATUS                    PORTS
canton    canton:0.5.3  "/entrypoint.sh"  canton    12 seconds ago  Up 10 seconds (healthy)  0.0.0.0:4975->4975/tcp
splice    splice:0.5.3  "/entrypoint.sh"  splice    12 seconds ago  Up 10 seconds (healthy)  0.0.0.0:4903->4903/tcp
nginx     nginx:1.27    "nginx -g ..."    nginx     12 seconds ago  Up 10 seconds            127.0.0.1:4000->4000/tcp
`

interface MockResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

function createDetector() {
  return createLocalnetWorkspaceDetector({
    access: (filePath: string) => fs.access(filePath),
    readFile: (filePath: string) => fs.readFile(filePath, 'utf8'),
  })
}

function createMockRunner(): ProcessRunner {
  return {
    run: vi.fn().mockResolvedValue({exitCode: 0, stderr: '', stdout: STATUS_OUTPUT}),
    spawn: vi.fn(),
    which: vi.fn().mockResolvedValue('/usr/bin/make'),
  }
}

function createOkResponse(body = 'ready'): MockResponse {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(body),
  }
}

describe('LocalNet workspace detection', () => {
  it('detects an official quickstart-style workspace and discovers service URLs', async () => {
    const detector = createDetector()

    const workspace = await detector.detect(QUICKSTART_FIXTURE)

    expect(workspace.composeFilePath).toBe(path.join(QUICKSTART_FIXTURE, 'compose.yaml'))
    expect(workspace.makeTargets).toEqual({
      down: 'stop',
      status: 'status',
      up: 'start',
    })
    expect(workspace.services).toEqual({
      ledger: 'http://canton.localhost:4000/v2',
      scan: 'http://scan.localhost:4000/api/scan',
      validator: 'http://wallet.localhost:4000/api/validator',
      wallet: 'http://wallet.localhost:4000',
    })
    expect(workspace.profiles['app-provider'].health.validatorReadyz).toBe(
      'http://127.0.0.1:3903/api/validator/readyz',
    )
    expect(workspace.profiles['app-user'].urls.wallet).toBe('http://wallet.localhost:2000')
  })

  it('rejects workspaces that do not contain the official LocalNet module layout', async () => {
    const detector = createDetector()

    await expect(detector.detect(INVALID_FIXTURE)).rejects.toMatchObject({
      code: 'E3006',
    })
  })
})

describe('LocalNet runtime wrapper', () => {
  it('parses docker compose ps style status output', () => {
    expect(parseLocalnetStatusOutput(STATUS_OUTPUT)).toEqual([
      {
        healthy: true,
        name: 'canton',
        ports: '0.0.0.0:4975->4975/tcp',
        service: 'canton',
        status: 'Up 10 seconds (healthy)',
      },
      {
        healthy: true,
        name: 'splice',
        ports: '0.0.0.0:4903->4903/tcp',
        service: 'splice',
        status: 'Up 10 seconds (healthy)',
      },
      {
        healthy: null,
        name: 'nginx',
        ports: '127.0.0.1:4000->4000/tcp',
        service: 'nginx',
        status: 'Up 10 seconds',
      },
    ])
  })

  it('checks validator readyz and returns discovered URLs in status()', async () => {
    const detector = createDetector()
    const runner = createMockRunner()
    const fetch = vi.fn().mockResolvedValue(createOkResponse())
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch,
      runner,
    })

    const result = await localnet.status({workspace: QUICKSTART_FIXTURE})

    expect(runner.run).toHaveBeenCalledWith(
      'make',
      ['status'],
      {cwd: QUICKSTART_FIXTURE, ignoreExitCode: true},
    )
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4903/api/validator/readyz')
    expect(result.health.validatorReadyz).toEqual({
      body: 'ready',
      healthy: true,
      status: 200,
      url: 'http://127.0.0.1:4903/api/validator/readyz',
    })
    expect(result.services.scan?.url).toBe('http://scan.localhost:4000/api/scan')
  })

  it('runs the upstream start target and passes through the profile hint on up()', async () => {
    const detector = createDetector()
    const runner = createMockRunner()
    ;(runner.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({exitCode: 0, stderr: '', stdout: 'started'})
      .mockResolvedValueOnce({exitCode: 0, stderr: '', stdout: STATUS_OUTPUT})

    const fetch = vi.fn().mockResolvedValue(createOkResponse())
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch,
      runner,
    })

    const result = await localnet.up({
      profile: 'app-provider',
      workspace: QUICKSTART_FIXTURE,
    })

    expect(runner.run).toHaveBeenNthCalledWith(
      1,
      'make',
      ['start', 'PROFILE=app-provider'],
      {cwd: QUICKSTART_FIXTURE, ignoreExitCode: true},
    )
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3903/api/validator/readyz')
    expect(result.selectedProfile).toBe('app-provider')
    expect(result.services.wallet.url).toBe('http://wallet.localhost:3000')
  })

  it('runs the upstream stop target on down()', async () => {
    const detector = createDetector()
    const runner = createMockRunner()
    ;(runner.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce({exitCode: 0, stderr: '', stdout: 'stopped'})
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch: vi.fn(),
      runner,
    })

    const result = await localnet.down({workspace: QUICKSTART_FIXTURE})

    expect(runner.run).toHaveBeenCalledWith(
      'make',
      ['stop'],
      {cwd: QUICKSTART_FIXTURE, ignoreExitCode: true},
    )
    expect(result.target).toBe('stop')
    expect(result.workspace.root).toBe(QUICKSTART_FIXTURE)
  })

  it('defaults to the sv profile when an unknown profile hint is passed', async () => {
    const detector = createDetector()
    const runner = createMockRunner()
    const fetch = vi.fn().mockResolvedValue(createOkResponse())
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch,
      runner,
    })

    const result = await localnet.status({
      profile: 'unknown-profile',
      workspace: QUICKSTART_FIXTURE,
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4903/api/validator/readyz')
    expect(result.selectedProfile).toBe('sv')
  })

  it('returns unhealthy validator status when the readyz probe throws', async () => {
    const detector = createDetector()
    const runner = createMockRunner()
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch: vi.fn().mockRejectedValue(new Error('connection refused')),
      runner,
    })

    const result = await localnet.status({workspace: QUICKSTART_FIXTURE})

    expect(result.health.validatorReadyz).toEqual({
      body: 'connection refused',
      healthy: false,
      status: 0,
      url: 'http://127.0.0.1:4903/api/validator/readyz',
    })
  })

  it('rejects LocalNet commands when make is unavailable', async () => {
    const detector = createDetector()
    const runner: ProcessRunner = {
      run: vi.fn(),
      spawn: vi.fn(),
      which: vi.fn().mockResolvedValue(null),
    }
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch: vi.fn(),
      runner,
    })

    await expect(localnet.status({workspace: QUICKSTART_FIXTURE})).rejects.toMatchObject({
      code: 'E3007',
    })
  })

  it('rejects LocalNet commands when the upstream make target fails', async () => {
    const detector = createDetector()
    const runner: ProcessRunner = {
      run: vi.fn().mockResolvedValue({exitCode: 2, stderr: 'boom', stdout: 'failed'}),
      spawn: vi.fn(),
      which: vi.fn().mockResolvedValue('/usr/bin/make'),
    }
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch: vi.fn(),
      runner,
    })

    await expect(localnet.up({workspace: QUICKSTART_FIXTURE})).rejects.toMatchObject({
      code: 'E3007',
      context: expect.objectContaining({
        exitCode: 2,
        stderr: 'boom',
        stdout: 'failed',
        target: 'start',
      }),
    })
  })
})
