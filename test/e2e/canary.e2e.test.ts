import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import CanaryStablePublic from '../../src/commands/canary/stable-public.js'
import {createCanaryRunner} from '../../src/lib/canary/run.js'
import {createInMemoryBackend} from '../../src/lib/credential-store.js'
import {createProfileRuntimeResolver} from '../../src/lib/profile-runtime.js'

const CLI_ROOT = process.cwd()

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

async function startServer(failing = false): Promise<{close(): Promise<void>; url: string}> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    let body: unknown = {error: 'not found'}
    let status = 404

    if (url.pathname === '/v0/dso') {
      body = failing ? {error: 'unavailable'} : {sv_party_id: 'sv::1'}
      status = failing ? 503 : 200
    } else if (url.pathname === '/v0/entry/all') {
      body = {entries: []}
      status = 200
    } else if (url.pathname === '/v1/tokens') {
      body = failing ? {error: 'token-down'} : {tokens: []}
      status = failing ? 503 : 200
    } else if (url.pathname === '/v0/wallet/buy-traffic-requests/cantonctl-canary/status') {
      body = {error: 'not found'}
      status = 404
    }

    response.statusCode = status
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
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
  command: typeof CanaryStablePublic,
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

function createHarness(env: Record<string, string | undefined>): typeof CanaryStablePublic {
  return class TestCanaryStablePublic extends CanaryStablePublic {
    protected override createRunner() {
      return createCanaryRunner({
        createProfileRuntimeResolver: () => createProfileRuntimeResolver({
          createBackendWithFallback: async () => ({backend: createInMemoryBackend(), isKeychain: false}),
          env,
        }),
      })
    }
  }
}

describe('stable-public canary E2E', () => {
  let failingServer: {close(): Promise<void>; url: string}
  let healthyServer: {close(): Promise<void>; url: string}
  let projectDir: string
  let workDir: string

  beforeAll(async () => {
    healthyServer = await startServer(false)
    failingServer = await startServer(true)
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-canary-'))
    projectDir = path.join(workDir, 'project')
    fs.mkdirSync(projectDir, {recursive: true})
  })

  afterAll(async () => {
    await healthyServer?.close()
    await failingServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('runs a scan-only canary suite', async () => {
    fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), `version: 1

project:
  name: canary-e2e
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${healthyServer.url}
    scan:
      url: ${healthyServer.url}
    tokenStandard:
      url: ${healthyServer.url}
    validator:
      url: ${healthyServer.url}
    ans:
      url: ${healthyServer.url}
`, 'utf8')

    const Harness = createHarness({CANTONCTL_JWT_SPLICE_DEVNET: 'jwt-token'})
    const result = await runInProject(projectDir, Harness, ['--profile', 'splice-devnet', '--suite', 'scan', '--json'])
    expect(result.error).toBeUndefined()
    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      checks: [expect.objectContaining({suite: 'scan', status: 'pass'})],
    }))
  })

  it('runs the full stable/public canary suite', async () => {
    const Harness = createHarness({CANTONCTL_JWT_SPLICE_DEVNET: 'jwt-token'})
    const result = await runInProject(projectDir, Harness, ['--profile', 'splice-devnet', '--json'])
    expect(result.error).toBeUndefined()
    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data.checks).toHaveLength(4)
  })

  it('fails with CI-friendly summaries when a default suite breaks', async () => {
    fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), `version: 1

project:
  name: canary-e2e
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${failingServer.url}
    scan:
      url: ${failingServer.url}
    tokenStandard:
      url: ${failingServer.url}
    validator:
      url: ${failingServer.url}
`, 'utf8')

    const Harness = createHarness({CANTONCTL_JWT_SPLICE_DEVNET: 'jwt-token'})
    const result = await runInProject(projectDir, Harness, ['--profile', 'splice-devnet', '--json'])
    const json = parseJson(result.stdout)
    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      checks: expect.arrayContaining([
        expect.objectContaining({suite: 'scan', status: 'fail'}),
        expect.objectContaining({suite: 'token-standard', status: 'fail'}),
      ]),
    }))
  })
})

