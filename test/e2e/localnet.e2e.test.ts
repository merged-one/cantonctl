import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import LocalnetDown from '../../src/commands/localnet/down.js'
import LocalnetStatus from '../../src/commands/localnet/status.js'
import LocalnetUp from '../../src/commands/localnet/up.js'
import {createLocalnet} from '../../src/lib/localnet.js'
import {createLocalnetWorkspaceDetector} from '../../src/lib/localnet-workspace.js'
import type {ProcessRunner} from '../../src/lib/process-runner.js'

const CLI_ROOT = process.cwd()
const QUICKSTART_FIXTURE = path.resolve(process.cwd(), 'test/fixtures/localnet-workspace/quickstart')
const READYZ_PORT = 48903

const STATUS_OUTPUT = `NAME      IMAGE         COMMAND         SERVICE   CREATED          STATUS                    PORTS
canton    canton:0.5.3  "/entrypoint.sh"  canton    12 seconds ago  Up 10 seconds (healthy)  0.0.0.0:4975->4975/tcp
splice    splice:0.5.3  "/entrypoint.sh"  splice    12 seconds ago  Up 10 seconds (healthy)  0.0.0.0:4903->4903/tcp
nginx     nginx:1.27    "nginx -g ..."    nginx     12 seconds ago  Up 10 seconds            127.0.0.1:4100->4100/tcp
`

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

function createRunner(): ProcessRunner {
  return {
    run: vi.fn().mockImplementation(async (_cmd: string, args: string[]) => {
      const target = args[0]
      if (target === 'start') return {exitCode: 0, stderr: '', stdout: 'starting localnet'}
      if (target === 'status') return {exitCode: 0, stderr: '', stdout: STATUS_OUTPUT}
      if (target === 'stop') return {exitCode: 0, stderr: '', stdout: 'stopping localnet'}
      return {exitCode: 1, stderr: `unexpected target ${target}`, stdout: ''}
    }),
    spawn: vi.fn(),
    which: vi.fn().mockResolvedValue('/usr/bin/make'),
  }
}

describe('localnet wrapper E2E', () => {
  let readyzServer: http.Server
  let runner: ProcessRunner
  let workspaceDir: string
  let workDir: string

  beforeAll(async () => {
    readyzServer = http.createServer((_request, response) => {
      response.statusCode = 200
      response.end('ready')
    })
    await new Promise<void>((resolve, reject) => {
      readyzServer.once('error', reject)
      readyzServer.listen(READYZ_PORT, '127.0.0.1', () => resolve())
    })

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-localnet-'))
    workspaceDir = path.join(workDir, 'workspace')
    fs.cpSync(QUICKSTART_FIXTURE, workspaceDir, {recursive: true})
    fs.writeFileSync(
      path.join(workspaceDir, '.env.local'),
      [
        'HOST_BIND_IP=127.0.0.1',
        'VALIDATOR_ADMIN_API_PORT_SUFFIX=8903',
        'APP_USER_UI_PORT=2100',
        'APP_PROVIDER_UI_PORT=3100',
        'SV_UI_PORT=4100',
      ].join('\n'),
      'utf8',
    )

    runner = createRunner()
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => readyzServer.close(error => error ? reject(error) : resolve()))
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('boots the wrapper and reports healthy validator readyz plus discovered stable service URLs', async () => {
    const detector = createLocalnetWorkspaceDetector({
      access: (filePath: string) => fs.promises.access(filePath),
      readFile: (filePath: string) => fs.promises.readFile(filePath, 'utf8'),
    })
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch: (url: string) => fetch(url),
      runner,
    })

    class TestLocalnetUp extends LocalnetUp {
      protected override createLocalnet() {
        return localnet
      }
    }

    const result = await captureOutput(() => TestLocalnetUp.run([
      '--json',
      '--workspace',
      workspaceDir,
    ], {root: CLI_ROOT}))

    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      selectedProfile: 'sv',
      services: expect.objectContaining({
        ledger: {url: 'http://canton.localhost:4100/v2'},
        scan: {url: 'http://scan.localhost:4100/api/scan'},
        validator: {url: 'http://wallet.localhost:4100/api/validator'},
        wallet: {url: 'http://wallet.localhost:4100'},
      }),
      workspace: workspaceDir,
    }))
    expect(json.data).toEqual(expect.objectContaining({
      health: {
        validatorReadyz: {
          body: 'ready',
          healthy: true,
          status: 200,
          url: 'http://127.0.0.1:48903/api/validator/readyz',
        },
      },
    }))
    expect(runner.run).toHaveBeenNthCalledWith(
      1,
      'make',
      ['start'],
      {cwd: workspaceDir, ignoreExitCode: true},
    )
    expect(runner.run).toHaveBeenNthCalledWith(
      2,
      'make',
      ['status'],
      {cwd: workspaceDir, ignoreExitCode: true},
    )
  })

  it('reports status and delegates shutdown to the upstream stop target', async () => {
    const detector = createLocalnetWorkspaceDetector({
      access: (filePath: string) => fs.promises.access(filePath),
      readFile: (filePath: string) => fs.promises.readFile(filePath, 'utf8'),
    })
    const localnet = createLocalnet({
      detectWorkspace: (workspace: string) => detector.detect(workspace),
      fetch: (url: string) => fetch(url),
      runner,
    })

    class TestLocalnetStatus extends LocalnetStatus {
      protected override createLocalnet() {
        return localnet
      }
    }

    class TestLocalnetDown extends LocalnetDown {
      protected override createLocalnet() {
        return localnet
      }
    }

    const statusResult = await captureOutput(() => TestLocalnetStatus.run([
      '--json',
      '--workspace',
      workspaceDir,
    ], {root: CLI_ROOT}))
    expect(statusResult.error).toBeUndefined()

    const statusJson = parseJson(statusResult.stdout)
    expect(statusJson.success).toBe(true)
    expect(statusJson.data).toEqual(expect.objectContaining({
      selectedProfile: 'sv',
      workspace: workspaceDir,
    }))

    const downResult = await captureOutput(() => TestLocalnetDown.run([
      '--json',
      '--workspace',
      workspaceDir,
    ], {root: CLI_ROOT}))
    expect(downResult.error).toBeUndefined()

    const downJson = parseJson(downResult.stdout)
    expect(downJson.success).toBe(true)
    expect(downJson.data).toEqual({
      target: 'stop',
      workspace: workspaceDir,
    })
    expect(runner.run).toHaveBeenLastCalledWith(
      'make',
      ['stop'],
      {cwd: workspaceDir, ignoreExitCode: true},
    )
  })
})
