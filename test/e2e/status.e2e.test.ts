/**
 * E2E tests for `cantonctl status` (LedgerClient queries).
 * Tests verify health checks and party listing against a real sandbox.
 *
 * Prerequisites: supported SDK CLI on PATH (`dpm` current, `daml` legacy), Java 21+
 * All tests share a single sandbox to avoid startup overhead.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {captureOutput} from '@oclif/test'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import Status from '../../src/commands/status.js'
import {createDamlSdk} from '../../src/lib/daml.js'
import {createDevServer, type DevServer} from '../../src/lib/dev-server.js'
import {createSandboxToken} from '../../src/lib/jwt.js'
import {createLedgerClient} from '../../src/lib/ledger-client.js'
import {createOutput} from '../../src/lib/output.js'
import {createProcessRunner} from '../../src/lib/process-runner.js'
import {scaffoldProject} from '../../src/lib/scaffold.js'
import {hasSdk, SDK_VERSION} from './helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CANTON_PORT = 5041
const JSON_API_PORT = 7611

const SDK_AVAILABLE = hasSdk()
const describeWithSdk = SDK_AVAILABLE ? describe : describe.skip
const CLI_ROOT = process.cwd()

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
    fs.writeFileSync(
      path.join(projectDir, 'cantonctl.yaml'),
      `version: 1

project:
  name: status-e2e
  sdk-version: "${SDK_VERSION}"

parties:
  - name: Alice
    role: operator
  - name: Bob
    role: participant

networks:
  local:
    type: sandbox
    port: ${CANTON_PORT}
    json-api-port: ${JSON_API_PORT}
`,
    )

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

  it('status --json reports profile-aware services against the running sandbox', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(path.join(workDir, 'project'))

    try {
      const result = await captureOutput(() => Status.run(['--json'], {root: CLI_ROOT}))
      expect(result.error).toBeUndefined()

      const json = JSON.parse(result.stdout) as {
        data: {
          healthy: boolean
          profile?: {kind: string; name: string}
          services?: Array<{endpoint?: string; name: string; status: string}>
          version?: string
        }
        success: boolean
      }

      expect(json.success).toBe(true)
      expect(json.data.healthy).toBe(true)
      expect(json.data.profile).toEqual(expect.objectContaining({
        kind: 'sandbox',
        name: 'local',
      }))
      expect(json.data.services).toEqual(expect.arrayContaining([
        expect.objectContaining({
          endpoint: `http://localhost:${JSON_API_PORT}`,
          name: 'ledger',
          status: 'healthy',
        }),
      ]))
      expect(json.data.version).toBeTruthy()
    } finally {
      cwdSpy.mockRestore()
    }
  }, 30_000)
})
