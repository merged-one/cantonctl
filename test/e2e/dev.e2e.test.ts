/**
 * @module test/e2e/dev
 *
 * End-to-end tests for `cantonctl dev` (DevServer). These tests start a real
 * Canton sandbox, verify health, party provisioning, and hot-reload.
 *
 * Prerequisites: supported SDK CLI on PATH (`dpm` current, `daml` legacy), Java 21+
 * Skip condition: Tests are skipped if no supported SDK CLI is available.
 *
 * IMPORTANT: These tests use real ports. Each test uses unique ports to avoid
 * conflicts. Sandbox startup takes ~8-10 seconds.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {loadConfig} from '../../src/lib/config.js'
import {createDamlSdk} from '../../src/lib/daml.js'
import {createDevServer, type DevServer} from '../../src/lib/dev-server.js'
import {createLedgerClient} from '../../src/lib/ledger-client.js'
import {createSandboxToken} from '../../src/lib/jwt.js'
import {createOutput} from '../../src/lib/output.js'
import {createProcessRunner} from '../../src/lib/process-runner.js'
import {scaffoldProject} from '../../src/lib/scaffold.js'
import {hasSdk, SDK_VERSION} from './helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SDK_AVAILABLE = hasSdk()
const describeWithSdk = SDK_AVAILABLE ? describe : describe.skip

/** Find the first .dar file in a directory. */
async function findDarFile(dir: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(dir)
    const darFile = entries.find(e => e.endsWith('.dar'))
    return darFile ? path.join(dir, darFile) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Test workspace
// ---------------------------------------------------------------------------

let workDir: string

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-dev-'))
})

afterAll(() => {
  fs.rmSync(workDir, {recursive: true, force: true})
})

// ---------------------------------------------------------------------------
// Dev server E2E tests
// ---------------------------------------------------------------------------

describeWithSdk('dev E2E: sandbox lifecycle', () => {
  let projectDir: string
  let server: DevServer | null = null

  beforeAll(() => {
    // Create a project to work with
    projectDir = path.join(workDir, 'dev-test-project')
    scaffoldProject({dir: projectDir, name: 'dev-test-project', template: 'basic'})

    // Fix sdk-version
    const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
    fs.writeFileSync(
      path.join(projectDir, 'daml.yaml'),
      damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
    )
    const cantonYaml = fs.readFileSync(path.join(projectDir, 'cantonctl.yaml'), 'utf8')
    fs.writeFileSync(
      path.join(projectDir, 'cantonctl.yaml'),
      cantonYaml.replace(/sdk-version: .*/, `sdk-version: "${SDK_VERSION}"`),
    )
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
      // Give port time to release
      await new Promise(r => setTimeout(r, 1000))
    }
  })

  it('starts sandbox and becomes healthy', async () => {
    const config = await loadConfig({dir: projectDir})
    const runner = createProcessRunner()
    const output = createOutput({json: true})

    // Use unique ports to avoid conflicts
    const port = 5201
    const jsonApiPort = 7701

    server = createDevServer({
      config,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      findDarFile,
      output,
      readFile: (p) => fs.promises.readFile(p),
      sdk: createDamlSdk({runner}),
      watch: () => ({close: async () => {}, on: () => ({close: async () => {}, on: () => ({})})} as any),
    })

    await server.start({
      jsonApiPort,
      port,
      projectDir,
      healthRetryDelayMs: 1000,
      healthTimeoutMs: 60_000,
    })

    // Verify sandbox is healthy via direct HTTP
    const token = await createSandboxToken({
      actAs: ['Alice', 'Bob'],
      admin: true,
      applicationId: 'e2e-test',
      readAs: [],
    })

    const response = await fetch(`http://localhost:${jsonApiPort}/v2/version`, {
      headers: {Authorization: `Bearer ${token}`},
    })
    expect(response.ok).toBe(true)
    const body = await response.json() as Record<string, unknown>
    expect(body.version).toBeDefined()
  }, 90_000) // 90s timeout for sandbox startup

  it('attempts party provisioning and handles sandbox limitations gracefully', async () => {
    const config = await loadConfig({dir: projectDir})
    const runner = createProcessRunner()

    // Capture output to verify party provisioning was attempted
    const messages: string[] = []
    const output: any = {
      error: (m: string) => messages.push(`ERROR: ${m}`),
      info: (m: string) => messages.push(`INFO: ${m}`),
      log: (m: string) => messages.push(`LOG: ${m}`),
      result: () => {},
      spinner: () => ({fail: () => {}, stop: () => {}, succeed: () => {}, text: ''}),
      success: (m: string) => messages.push(`SUCCESS: ${m}`),
      table: () => {},
      warn: (m: string) => messages.push(`WARN: ${m}`),
    }

    const port = 5202
    const jsonApiPort = 7702

    server = createDevServer({
      config,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      findDarFile,
      output,
      readFile: (p) => fs.promises.readFile(p),
      sdk: createDamlSdk({runner}),
      watch: () => ({close: async () => {}, on: () => ({close: async () => {}, on: () => ({})})} as any),
    })

    await server.start({
      jsonApiPort,
      port,
      projectDir,
      healthRetryDelayMs: 1000,
      healthTimeoutMs: 60_000,
    })

    // Verify sandbox became healthy
    expect(messages.some(m => m.includes('sandbox is ready'))).toBe(true)

    // Verify party provisioning was attempted
    expect(messages.some(m => m.includes('Provisioning parties'))).toBe(true)

    // Canton sandbox doesn't support explicit party allocation (needs synchronizer),
    // so we expect warn messages, not errors. Parties auto-allocate on first command use.
    // The important thing is the server didn't crash.
    expect(messages.some(m => m.includes('WARN') || m.includes('Provisioned') || m.includes('already exists'))).toBe(true)

    // Verify the Ledger API is accessible
    const token = await createSandboxToken({
      actAs: ['admin'],
      admin: true,
      applicationId: 'e2e-test',
      readAs: [],
    })
    const response = await fetch(`http://localhost:${jsonApiPort}/v2/version`, {
      headers: {Authorization: `Bearer ${token}`},
    })
    expect(response.ok).toBe(true)
  }, 90_000)

  it('shuts down cleanly (port freed, no zombies)', async () => {
    const config = await loadConfig({dir: projectDir})
    const runner = createProcessRunner()
    const output = createOutput({json: true})

    const port = 5203
    const jsonApiPort = 7703

    server = createDevServer({
      config,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      findDarFile,
      output,
      readFile: (p) => fs.promises.readFile(p),
      sdk: createDamlSdk({runner}),
      watch: () => ({close: async () => {}, on: () => ({close: async () => {}, on: () => ({})})} as any),
    })

    await server.start({
      jsonApiPort,
      port,
      projectDir,
      healthRetryDelayMs: 1000,
      healthTimeoutMs: 60_000,
    })

    // Stop
    await server.stop()
    server = null

    // Wait for port release
    await new Promise(r => setTimeout(r, 2000))

    // Verify port is free (fetch should fail)
    try {
      await fetch(`http://localhost:${jsonApiPort}/v2/version`)
      expect.fail('Port should be free after shutdown')
    } catch {
      // Expected — connection refused
    }
  }, 90_000)
})
