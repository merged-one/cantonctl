import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type {AddressInfo} from 'node:net'

import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import Preflight from '../../src/commands/preflight.js'
import {createInMemoryBackend} from '../../src/lib/credential-store.js'
import {createPreflightChecks} from '../../src/lib/preflight/checks.js'
import {createProfileRuntimeResolver} from '../../src/lib/profile-runtime.js'

const CLI_ROOT = process.cwd()

interface MockRequest {
  method: string
  pathname: string
}

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
  handler: (request: MockRequest) => {body: unknown; status?: number},
): Promise<MockServer> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const result = handler({
      method: request.method ?? 'GET',
      pathname: url.pathname,
    })

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
  command: typeof Preflight,
  args: string[],
): Promise<{error?: Error; stderr: string; stdout: string}> {
  const cwd = process.cwd
  const spy = Object.defineProperty(process, 'cwd', {
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
    void spy
  }
}

function createTestPreflightCommand(env: Record<string, string | undefined>, egressIp?: string): typeof Preflight {
  return class TestPreflight extends Preflight {
    protected override createPreflight() {
      return createPreflightChecks({
        createProfileRuntimeResolver: () => createProfileRuntimeResolver({
          createBackendWithFallback: async () => ({backend: createInMemoryBackend(), isKeychain: false}),
          env,
        }),
        lookupEgressIp: async () => egressIp,
      })
    }
  }
}

describe('preflight E2E', () => {
  let failingScanServer: MockServer
  let healthyScanServer: MockServer
  let workDir: string

  beforeAll(async () => {
    healthyScanServer = await startServer((request) => {
      if (request.pathname === '/v0/dso') {
        return {body: {sv_party_id: 'sv::1'}}
      }

      return {body: {error: 'not found'}, status: 404}
    })

    failingScanServer = await startServer((request) => {
      if (request.pathname === '/v0/dso') {
        return {body: {error: 'unavailable'}, status: 503}
      }

      return {body: {error: 'not found'}, status: 404}
    })

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-preflight-'))
  })

  afterAll(async () => {
    await healthyScanServer?.close()
    await failingScanServer?.close()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('passes for a remote-validator profile with auth material and stable/public scan reachability', async () => {
    const projectDir = path.join(workDir, 'pass')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-devnet

project:
  name: preflight-pass
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${healthyScanServer.url}
    ledger:
      url: https://ledger.devnet.example.com
    scan:
      url: ${healthyScanServer.url}
    validator:
      url: ${healthyScanServer.url}
`,
    )

    const CommandHarness = createTestPreflightCommand({
      CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET: 'operator-token',
      CANTONCTL_JWT_SPLICE_DEVNET: 'jwt-token',
    }, '203.0.113.10')
    const result = await runInProject(projectDir, CommandHarness, ['--profile', 'splice-devnet', '--json'])
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      egressIp: '203.0.113.10',
      network: expect.objectContaining({
        name: 'splice-devnet',
        resetExpectation: 'resets-expected',
        tier: 'devnet',
      }),
      profile: expect.objectContaining({kind: 'remote-validator', name: 'splice-devnet'}),
    }))
    expect(json.data).toEqual(expect.objectContaining({
      checks: expect.arrayContaining([
        expect.objectContaining({name: 'App credential material', status: 'pass'}),
        expect.objectContaining({name: 'Operator credential material', status: 'pass'}),
        expect.objectContaining({name: 'Scan reachability', status: 'pass'}),
      ]),
    }))
  })

  it('fails when auth/profile coherence is incomplete', async () => {
    const projectDir = path.join(workDir, 'missing-auth')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-devnet

project:
  name: preflight-missing-auth
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${healthyScanServer.url}
    ledger:
      url: https://ledger.devnet.example.com
    scan:
      url: ${healthyScanServer.url}
`,
    )

    const CommandHarness = createTestPreflightCommand({}, '203.0.113.10')
    const result = await runInProject(projectDir, CommandHarness, ['--profile', 'splice-devnet', '--json'])
    const json = parseJson(result.stdout)

    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      checks: expect.arrayContaining([
        expect.objectContaining({name: 'App credential material', status: 'fail'}),
        expect.objectContaining({name: 'Operator credential material', status: 'fail'}),
      ]),
    }))
  })

  it('fails when scan reachability checks cannot reach the configured scan endpoint', async () => {
    const projectDir = path.join(workDir, 'scan-fail')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

default-profile: splice-devnet

project:
  name: preflight-scan-fail
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${failingScanServer.url}
    ledger:
      url: https://ledger.devnet.example.com
    scan:
      url: ${failingScanServer.url}
`,
    )

    const CommandHarness = createTestPreflightCommand({
      CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET: 'operator-token',
      CANTONCTL_JWT_SPLICE_DEVNET: 'jwt-token',
    }, '203.0.113.10')
    const result = await runInProject(projectDir, CommandHarness, ['--profile', 'splice-devnet', '--json'])
    const json = parseJson(result.stdout)

    expect(json.success).toBe(false)
    expect(json.data).toEqual(expect.objectContaining({
      checks: expect.arrayContaining([
        expect.objectContaining({name: 'Scan reachability', status: 'fail'}),
      ]),
    }))
  })

  it('surfaces different reset expectations for DevNet, TestNet, and MainNet profiles', async () => {
    const projectDir = path.join(workDir, 'tiers')
    fs.mkdirSync(projectDir, {recursive: true})
    writeConfig(
      projectDir,
      `version: 1

project:
  name: preflight-tiers
  sdk-version: "3.4.11"

profiles:
  splice-devnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${healthyScanServer.url}
    ledger:
      url: https://ledger.devnet.example.com
    scan:
      url: ${healthyScanServer.url}
  splice-testnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${healthyScanServer.url}
    ledger:
      url: https://ledger.testnet.example.com
    scan:
      url: ${healthyScanServer.url}
  splice-mainnet:
    kind: remote-validator
    auth:
      kind: jwt
      url: ${healthyScanServer.url}
    ledger:
      url: https://ledger.mainnet.example.com
    scan:
      url: ${healthyScanServer.url}
`,
    )

    const CommandHarness = createTestPreflightCommand({
      CANTONCTL_OPERATOR_TOKEN_SPLICE_DEVNET: 'devnet-operator-token',
      CANTONCTL_OPERATOR_TOKEN_SPLICE_TESTNET: 'testnet-operator-token',
      CANTONCTL_OPERATOR_TOKEN_SPLICE_MAINNET: 'mainnet-operator-token',
      CANTONCTL_JWT_SPLICE_DEVNET: 'devnet-token',
      CANTONCTL_JWT_SPLICE_TESTNET: 'testnet-token',
      CANTONCTL_JWT_SPLICE_MAINNET: 'mainnet-token',
    }, '203.0.113.10')

    const devnet = parseJson((await runInProject(projectDir, CommandHarness, ['--profile', 'splice-devnet', '--json'])).stdout)
    const testnet = parseJson((await runInProject(projectDir, CommandHarness, ['--profile', 'splice-testnet', '--json'])).stdout)
    const mainnet = parseJson((await runInProject(projectDir, CommandHarness, ['--profile', 'splice-mainnet', '--json'])).stdout)

    expect(devnet.data).toEqual(expect.objectContaining({
      network: expect.objectContaining({resetExpectation: 'resets-expected', tier: 'devnet'}),
    }))
    expect(testnet.data).toEqual(expect.objectContaining({
      network: expect.objectContaining({resetExpectation: 'resets-expected', tier: 'testnet'}),
    }))
    expect(mainnet.data).toEqual(expect.objectContaining({
      network: expect.objectContaining({resetExpectation: 'no-resets-expected', tier: 'mainnet'}),
    }))
  })
})
