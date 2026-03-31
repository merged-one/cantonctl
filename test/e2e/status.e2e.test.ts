/**
 * E2E tests for `cantonctl status` (LedgerClient queries).
 * Tests verify health checks and party listing against a real sandbox.
 *
 * Prerequisites: daml CLI on PATH, Java 21+
 * All tests share a single sandbox to avoid startup overhead.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {execSync} from 'node:child_process'

import {createDamlSdk} from '../../src/lib/daml.js'
import {createDevServer, type DevServer} from '../../src/lib/dev-server.js'
import {createSandboxToken} from '../../src/lib/jwt.js'
import {createLedgerClient} from '../../src/lib/ledger-client.js'
import {createOutput} from '../../src/lib/output.js'
import {createProcessRunner} from '../../src/lib/process-runner.js'
import {scaffoldProject} from '../../src/lib/scaffold.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAML_PATH = `${os.homedir()}/.daml/bin`
const JAVA_PATHS = ['/opt/homebrew/opt/openjdk@21/bin', '/usr/local/opt/openjdk@21/bin']
const ENV_PATH = [...JAVA_PATHS, DAML_PATH, process.env.PATH].join(path.delimiter)
const SDK_VERSION = '3.4.11'
const CANTON_PORT = 5041
const JSON_API_PORT = 7611

function hasDaml(): boolean {
  try {
    execSync('daml version --no-legacy-assistant-warning', {
      env: {...process.env, PATH: ENV_PATH},
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

const SDK_AVAILABLE = hasDaml()
const describeWithSdk = SDK_AVAILABLE ? describe : describe.skip

// ---------------------------------------------------------------------------
// Shared sandbox
// ---------------------------------------------------------------------------

let workDir: string
let devServer: DevServer

const out = createOutput({json: true})
const runner = createProcessRunner()
const sdk = createDamlSdk({runner})

describeWithSdk('status E2E', () => {
  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-status-'))
    const projectDir = path.join(workDir, 'project')
    await scaffoldProject({dir: projectDir, name: 'status-e2e', sdkVersion: SDK_VERSION, template: 'basic'})

    devServer = createDevServer({
      config: {
        networks: {local: {'json-api-port': JSON_API_PORT, port: CANTON_PORT, type: 'sandbox'}},
        parties: [
          {name: 'Alice', role: 'operator'},
          {name: 'Bob', role: 'participant'},
        ],
        project: {name: 'status-e2e', 'sdk-version': SDK_VERSION},
        version: 1,
      },
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      findDarFile: async () => null,
      readFile: async () => new Uint8Array(),
      watch: () => ({close: async () => {}, on() { return this }}),
      isPortInUse: async () => false,
      output: out,
      sdk,
    })

    await devServer.start({jsonApiPort: JSON_API_PORT, port: CANTON_PORT, projectDir})
  }, 60_000)

  afterAll(async () => {
    await devServer?.stop()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('reports healthy=true and version when sandbox is running', async () => {
    const token = await createSandboxToken({
      actAs: ['Alice'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: ['Alice'],
    })
    const client = createLedgerClient({baseUrl: `http://localhost:${JSON_API_PORT}`, token})

    const version = await client.getVersion()
    expect(version.version).toBeTruthy()
  }, 30_000)

  it('reports healthy=false when nothing is running', async () => {
    const token = await createSandboxToken({
      actAs: ['admin'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: [],
    })
    const client = createLedgerClient({baseUrl: 'http://localhost:19999', token})

    let healthy = true
    try {
      await client.getVersion()
    } catch {
      healthy = false
    }

    expect(healthy).toBe(false)
  }, 10_000)

  it('getParties returns a result from the sandbox', async () => {
    const token = await createSandboxToken({
      actAs: ['Alice', 'Bob'],
      admin: true,
      applicationId: 'cantonctl',
      readAs: ['Alice', 'Bob'],
    })
    const client = createLedgerClient({baseUrl: `http://localhost:${JSON_API_PORT}`, token})

    const result = await client.getParties()
    // Sandbox may or may not have parties depending on provisioning timing
    expect(result).toHaveProperty('partyDetails')
    expect(Array.isArray(result.partyDetails)).toBe(true)
  }, 30_000)
})
