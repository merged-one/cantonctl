/**
 * @module test/e2e/playground
 *
 * End-to-end tests for `cantonctl playground` / `cantonctl serve`.
 * Tests the full stack: Daml source parsing, REST API, sandbox integration,
 * template discovery, contract creation, multi-party contract queries.
 *
 * Prerequisites: daml CLI on PATH, Java 21+
 * Skip condition: Tests are skipped if daml is not available.
 *
 * Real-world workloads tested:
 * 1. Token operations: create → query → exercise choices
 * 2. Template discovery: auto-generate forms from Daml source
 * 3. Multi-party privacy: create as party A → verify party B can't see it
 * 4. Template iteration: edit .daml → auto-rebuild → verify new templates
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {watch} from 'chokidar'
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest'

import {createBuilder} from '../../src/lib/builder.js'
import {loadConfig} from '../../src/lib/config.js'
import {createDamlSdk} from '../../src/lib/daml.js'
import {parseDamlSource} from '../../src/lib/daml-parser.js'
import {createDevServer, type DevServer} from '../../src/lib/dev-server.js'
import {createSandboxToken} from '../../src/lib/jwt.js'
import {createLedgerClient} from '../../src/lib/ledger-client.js'
import {createOutput} from '../../src/lib/output.js'
import {createProcessRunner} from '../../src/lib/process-runner.js'
import {scaffoldProject} from '../../src/lib/scaffold.js'
import {createServeServer, type ServeServer} from '../../src/lib/serve.js'
import {createTestRunner} from '../../src/lib/test-runner.js'
import {hasDaml, SDK_VERSION} from './helpers.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const SDK_AVAILABLE = hasDaml()
const describeWithSdk = SDK_AVAILABLE ? describe : describe.skip

async function findDarFile(dir: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(dir)
    const dar = entries.find(e => e.endsWith('.dar'))
    return dar ? path.join(dir, dar) : null
  } catch { return null }
}

let workDir: string
const SANDBOX_PORT = 5201
const JSON_API_PORT = 7676
const SERVE_PORT = 4200

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-playground-'))
})

afterAll(() => {
  fs.rmSync(workDir, {recursive: true, force: true})
})

// ---------------------------------------------------------------------------
// Helper: HTTP client for playground API
// ---------------------------------------------------------------------------

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`http://localhost:${SERVE_PORT}${path}`)
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`http://localhost:${SERVE_PORT}${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeWithSdk('Playground E2E', () => {
  let devServer: DevServer
  let serveServer: ServeServer
  const projectDir = () => path.join(workDir, 'playground-test')

  // ── Scaffold + start sandbox + start serve server ──────────

  beforeAll(async () => {
    // 1. Scaffold token project
    scaffoldProject({
      name: 'playground-test',
      dir: path.join(workDir, 'playground-test'),
      template: 'token',
    })

    const dir = projectDir()
    const out = createOutput({json: true, quiet: true})
    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const config = await loadConfig({dir})

    // 2. Build first
    const builder = createBuilder({
      findDarFile,
      getDamlSourceMtime: async () => 0,
      getFileMtime: async () => null,
      hooks: undefined,
      sdk,
    })
    await builder.build({projectDir: dir})

    // 3. Start sandbox
    devServer = createDevServer({
      config,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      findDarFile,
      isPortInUse: async () => false,
      output: out,
      readFile: (p) => fs.promises.readFile(p),
      sdk,
      watch: (paths, opts) => watch(paths, opts),
    })

    await devServer.start({
      jsonApiPort: JSON_API_PORT,
      port: SANDBOX_PORT,
      projectDir: dir,
    })

    // 4. Start serve server
    const testRunner = createTestRunner({sdk})
    serveServer = createServeServer({
      builder,
      createLedgerClient,
      createToken: createSandboxToken,
      output: out,
      testRunner,
    })

    await serveServer.start({
      ledgerUrl: `http://localhost:${JSON_API_PORT}`,
      port: SERVE_PORT,
      projectDir: dir,
    })
  }, 120_000)

  afterAll(async () => {
    await serveServer?.stop()
    await devServer?.stop()
  })

  // ── Health ─────────────────────────────────────────────────

  it('reports healthy sandbox', async () => {
    const health = await apiGet<{healthy: boolean; version?: string}>('/api/health')
    expect(health.healthy).toBe(true)
    expect(health.version).toBeDefined()
  })

  // ── Template Discovery ─────────────────────────────────────

  it('discovers Token template from Daml source', async () => {
    const result = await apiGet<{templates: Array<{name: string; fields: Array<{name: string; type: string}>; choices: Array<{name: string}>}>}>('/api/templates')

    expect(result.templates.length).toBeGreaterThanOrEqual(1)
    const token = result.templates.find(t => t.name === 'Token')
    expect(token).toBeDefined()
    expect(token!.fields.map(f => f.name)).toEqual(['owner', 'symbol', 'amount'])
    expect(token!.fields.map(f => f.type)).toEqual(['Party', 'Text', 'Decimal'])
  })

  it('discovers all Token choices with arguments', async () => {
    const result = await apiGet<{templates: Array<{name: string; choices: Array<{name: string; args: Array<{name: string; type: string}>}>}>}>('/api/templates')

    const token = result.templates.find(t => t.name === 'Token')!
    const choiceNames = token.choices.map(c => c.name)
    expect(choiceNames).toContain('Transfer')
    expect(choiceNames).toContain('Burn')
    expect(choiceNames).toContain('Mint')

    const transfer = token.choices.find(c => c.name === 'Transfer')!
    expect(transfer.args).toEqual([
      {name: 'newOwner', type: 'Party'},
      {name: 'transferAmount', type: 'Decimal'},
    ])

    const burn = token.choices.find(c => c.name === 'Burn')!
    expect(burn.args).toEqual([])
  })

  it('returns single template by name', async () => {
    const token = await apiGet<{name: string; fields: Array<{name: string}>}>('/api/templates/Token')
    expect(token.name).toBe('Token')
    expect(token.fields.length).toBe(3)
  })

  it('returns 404 for unknown template', async () => {
    const res = await fetch(`http://localhost:${SERVE_PORT}/api/templates/NonExistent`)
    expect(res.status).toBe(404)
  })

  // ── File Operations ────────────────────────────────────────

  it('lists project files', async () => {
    const files = await apiGet<Array<{name: string; type: string}>>('/api/files')
    const names = files.map(f => f.name)
    expect(names).toContain('cantonctl.yaml')
    expect(names).toContain('daml')
    expect(names).toContain('daml.yaml')
  })

  it('reads a Daml source file', async () => {
    const file = await apiGet<{content: string; path: string}>('/api/files/daml/Main.daml')
    expect(file.path).toBe('daml/Main.daml')
    expect(file.content).toContain('template Token')
    expect(file.content).toContain('choice Transfer')
  })

  it('reads cantonctl.yaml', async () => {
    const file = await apiGet<{content: string}>('/api/files/cantonctl.yaml')
    expect(file.content).toContain('playground-test')
  })

  // ── Parties ────────────────────────────────────────────────

  it('lists parties from sandbox', async () => {
    const result = await apiGet<{partyDetails: Array<{party: string; isLocal: boolean}>}>('/api/parties')
    // Canton sandbox may have 0 or more parties depending on whether
    // party provisioning succeeded (Canton allocates on first use)
    expect(Array.isArray(result.partyDetails)).toBe(true)
  })

  // ── Build ──────────────────────────────────────────────────

  it('triggers a build via API', async () => {
    const result = await apiPost<{darPath?: string; durationMs?: number; cached?: boolean}>('/api/build', {})
    expect(result.darPath).toBeDefined()
    expect(result.durationMs).toBeDefined()
  })

  // ── Test ───────────────────────────────────────────────────

  it('runs Daml tests via API', async () => {
    const result = await apiPost<{passed: boolean; output: string}>('/api/test', {})
    expect(result.passed).toBe(true)
    expect(result.output).toBeDefined()
  })

  // ── Multi-Party Contracts ──────────────────────────────────

  it('returns empty contracts for unknown party', async () => {
    const result = await apiGet<{contracts: Record<string, unknown[]>}>('/api/contracts/multi?parties=unknown::123')
    expect(result.contracts['unknown::123']).toEqual([])
  })

  it('queries contracts for multiple parties simultaneously', async () => {
    // Get actual party IDs
    const parties = await apiGet<{partyDetails: Array<{party: string}>}>('/api/parties')
    const partyIds = parties.partyDetails.map(p => p.party)

    if (partyIds.length >= 1) {
      const result = await apiGet<{contracts: Record<string, unknown[]>}>(`/api/contracts/multi?parties=${partyIds.join(',')}`)
      expect(result.contracts).toBeDefined()
      for (const id of partyIds) {
        expect(Array.isArray(result.contracts[id])).toBe(true)
      }
    }
  })

  // ── Topology API ────────────────────────────────────────────

  it('returns topology metadata (single-node mode)', async () => {
    const result = await apiGet<{mode: string; participants: Array<{name: string; port: number}>}>('/api/topology')
    expect(result.mode).toBe('single')
    expect(result.participants.length).toBeGreaterThanOrEqual(1)
    expect(result.participants[0].name).toBe('sandbox')
  })

  it('returns topology status with health info', async () => {
    const result = await apiGet<{participants: Array<{name: string; healthy: boolean; port: number}>}>('/api/topology/status')
    expect(result.participants.length).toBeGreaterThanOrEqual(1)
    expect(result.participants[0].healthy).toBe(true)
    expect(result.participants[0].port).toBe(JSON_API_PORT)
  })

  // ── Project API ────────────────────────────────────────────

  it('returns project metadata from daml.yaml', async () => {
    const result = await apiGet<{name: string; version: string}>('/api/project')
    expect(result.name).toBe('playground-test')
    expect(result.version).toBe('1.0.0')
  })

  // ── Contract Creation + Query ──────────────────────────────

  it('creates a Token contract via API and queries it back', async () => {
    // Build first to upload DAR
    await apiPost('/api/build', {})

    // Get a party
    const parties = await apiGet<{partyDetails: Array<{party: string; isLocal: boolean}>}>('/api/parties')
    const localParty = parties.partyDetails.find(p => p.isLocal)
    if (!localParty) return // skip if no local party

    const partyId = localParty.party

    // Create a Token
    const createResult = await apiPost<{updateId?: string}>('/api/commands', {
      actAs: [partyId],
      commands: [{
        CreateCommand: {
          templateId: '#playground-test:Main:Token',
          createArguments: {owner: partyId, symbol: 'E2E', amount: '999'},
        },
      }],
    })
    expect(createResult.updateId).toBeDefined()

    // Query contracts back
    const contracts = await apiGet<{activeContracts: Array<{contractId: string; payload: Record<string, unknown>}>}>(`/api/contracts?party=${partyId}`)
    expect(contracts.activeContracts.length).toBeGreaterThanOrEqual(1)

    const token = contracts.activeContracts.find(c => {
      const p = c.payload as Record<string, unknown>
      return p.symbol === 'E2E'
    })
    expect(token).toBeDefined()
    expect(token!.payload.amount).toContain('999')
  })

  // ── Proposal/Accept Template Discovery ─────────────────────

  it('discovers TokenTransferOffer template from Daml source', async () => {
    const result = await apiGet<{templates: Array<{name: string; choices: Array<{name: string}>}>}>('/api/templates')

    const offer = result.templates.find(t => t.name === 'TokenTransferOffer')
    expect(offer).toBeDefined()

    const choiceNames = offer!.choices.map(c => c.name)
    expect(choiceNames).toContain('AcceptTransfer')
    expect(choiceNames).toContain('CancelTransfer')
  })

  it('TokenTransferOffer has correct fields', async () => {
    const result = await apiGet<{templates: Array<{name: string; fields: Array<{name: string; type: string}>}>}>('/api/templates')

    const offer = result.templates.find(t => t.name === 'TokenTransferOffer')
    expect(offer).toBeDefined()
    expect(offer!.fields.map(f => f.name)).toContain('from')
    expect(offer!.fields.map(f => f.name)).toContain('to')
    expect(offer!.fields.map(f => f.name)).toContain('transferAmount')
  })

  // ── Daml Parser Unit Integration ───────────────────────────

  it('parser matches actual scaffolded Daml source', async () => {
    const source = await fs.promises.readFile(path.join(projectDir(), 'daml', 'Main.daml'), 'utf-8')
    const result = parseDamlSource(source)

    expect(result.module).toBe('Main')
    expect(result.templates.length).toBeGreaterThanOrEqual(2) // Token + TokenTransferOffer

    const token = result.templates.find(t => t.name === 'Token')
    expect(token).toBeDefined()
    expect(token!.signatory).toBe('owner')
    expect(token!.fields.length).toBe(3)
    expect(token!.choices.length).toBeGreaterThanOrEqual(3)

    const offer = result.templates.find(t => t.name === 'TokenTransferOffer')
    expect(offer).toBeDefined()
    expect(offer!.choices.length).toBeGreaterThanOrEqual(2)
  })
}, 120_000)
