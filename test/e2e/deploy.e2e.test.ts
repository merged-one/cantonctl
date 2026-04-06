/**
 * E2E tests for `cantonctl deploy` (Deployer module).
 * Tests run against real Daml SDK and Canton sandbox.
 *
 * Prerequisites: supported SDK CLI on PATH (`dpm` current, `daml` legacy), Java 21+
 * Skip condition: Tests are skipped if no supported SDK CLI is available.
 *
 * All tests share a single sandbox to avoid startup overhead.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

import {createBuilder} from '../../src/lib/builder.js'
import {createDamlSdk} from '../../src/lib/daml.js'
import {createDeployer} from '../../src/lib/deployer.js'
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

const CANTON_PORT = 5031
const JSON_API_PORT = 7601

async function findDarFile(dir: string): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(dir)
    const dar = entries.find(e => e.endsWith('.dar'))
    return dar ? path.join(dir, dar) : null
  } catch {
    return null
  }
}

async function getFileMtime(filePath: string): Promise<number | null> {
  try {
    return (await fs.promises.stat(filePath)).mtimeMs
  } catch {
    return null
  }
}

async function getDamlSourceMtime(dir: string): Promise<number> {
  let newest = 0
  try {
    const entries = await fs.promises.readdir(dir, {withFileTypes: true})
    for (const e of entries) {
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) {
        const s = await getDamlSourceMtime(fp)
        if (s > newest) newest = s
      } else if (e.name.endsWith('.daml')) {
        const s = await fs.promises.stat(fp)
        if (s.mtimeMs > newest) newest = s.mtimeMs
      }
    }
  } catch { /* empty */ }
  return newest
}

const SDK_AVAILABLE = hasSdk()
const describeWithSdk = SDK_AVAILABLE ? describe : describe.skip

// ---------------------------------------------------------------------------
// Shared sandbox
// ---------------------------------------------------------------------------

let workDir: string
let devServer: DevServer
let projectDir: string

const out = createOutput({json: true})
const runner = createProcessRunner()
const sdk = createDamlSdk({runner})

const CONFIG = {
  'default-profile': 'sandbox',
  networkProfiles: {local: 'sandbox'},
  networks: {local: {'json-api-port': JSON_API_PORT, port: CANTON_PORT, type: 'sandbox' as const}},
  parties: [{name: 'Alice', role: 'operator' as const}],
  profiles: {
    sandbox: {
      experimental: false,
      kind: 'sandbox' as const,
      name: 'sandbox',
      services: {
        auth: {kind: 'shared-secret' as const},
        ledger: {'json-api-port': JSON_API_PORT, port: CANTON_PORT},
      },
    },
  },
  project: {name: 'deploy-e2e', 'sdk-version': SDK_VERSION},
  version: 1,
}

describeWithSdk('deploy E2E', () => {
  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-deploy-'))
    projectDir = path.join(workDir, 'project')
    await scaffoldProject({dir: projectDir, name: 'deploy-e2e', template: 'splice-dapp-sdk'})

    devServer = createDevServer({
      config: CONFIG,
      createClient: createLedgerClient,
      createToken: createSandboxToken,
      findDarFile,
      readFile: (p: string) => fs.promises.readFile(p),
      watch: () => ({close: async () => {}, on() { return this }}),
      isPortInUse: async () => false,
      output: out,
      sdk,
    })

    await devServer.start({jsonApiPort: JSON_API_PORT, port: CANTON_PORT, projectDir})

    // Pre-build the DAR so individual tests don't wait for compilation
    const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, sdk})
    await builder.build({projectDir})
  }, 120_000)

  afterAll(async () => {
    await devServer?.stop()
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('deploy plan resolves the DAR without contacting the runtime', async () => {
    const createLedgerClientSpy = vi.fn((opts: Parameters<typeof createLedgerClient>[0]) => createLedgerClient(opts))
    const deployer = createDeployer({
      config: CONFIG,
      createLedgerClient: createLedgerClientSpy,
      createToken: createSandboxToken,
      fs: {readFile: (p: string) => fs.promises.readFile(p)},
      findDarFile,
    })

    const result = await deployer.deploy({mode: 'plan', profileName: 'sandbox', projectDir})

    expect(createLedgerClientSpy).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.mode).toBe('plan')
    expect(result.artifact).toEqual(expect.objectContaining({
      darPath: expect.stringContaining('.dar'),
      source: 'auto-detected',
    }))
    expect(result.steps.map(step => step.status)).toEqual(['completed', 'ready', 'ready', 'ready'])
  }, 60_000)

  it('deploy --dry-run resolves the DAR and runs read-only preflight', async () => {
    const deployer = createDeployer({
      config: CONFIG,
      createLedgerClient,
      createToken: createSandboxToken,
      fs: {readFile: (p: string) => fs.promises.readFile(p)},
      findDarFile,
    })

    const result = await deployer.deploy({dryRun: true, profileName: 'sandbox', projectDir})

    expect(result.success).toBe(true)
    expect(result.mode).toBe('dry-run')
    expect(result.targets).toEqual([
      expect.objectContaining({packageId: null, status: 'dry-run'}),
    ])
    expect(result.steps.map(step => step.status)).toEqual(['completed', 'completed', 'dry-run', 'pending'])
  }, 60_000)

  it('deploy apply reaches the upload stage against sandbox', async () => {
    const deployer = createDeployer({
      config: CONFIG,
      createLedgerClient,
      createToken: createSandboxToken,
      fs: {readFile: (p: string) => fs.promises.readFile(p)},
      findDarFile,
    })

    const result = await deployer.deploy({profileName: 'sandbox', projectDir})

    expect(result.artifact.darPath).toEqual(expect.stringContaining('.dar'))
    expect(result.steps[0]?.status).toBe('completed')
    expect(result.steps[1]?.status).toBe('completed')
    expect(['completed', 'failed']).toContain(result.steps[2]?.status)
    expect(result.targets[0]).toEqual(expect.objectContaining({
      label: 'sandbox',
      packageId: result.success ? expect.any(String) : null,
    }))
  }, 60_000)

  it('deploy with --dar uses the explicit artifact path', async () => {
    const builder = createBuilder({findDarFile, getDamlSourceMtime, getFileMtime, sdk})
    const buildResult = await builder.build({projectDir})
    expect(buildResult.darPath).toBeTruthy()

    const deployer = createDeployer({
      config: CONFIG,
      createLedgerClient,
      createToken: createSandboxToken,
      fs: {readFile: (p: string) => fs.promises.readFile(p)},
      findDarFile,
    })

    const result = await deployer.deploy({
      darPath: buildResult.darPath!,
      mode: 'plan',
      profileName: 'sandbox',
      projectDir,
    })

    expect(result.success).toBe(true)
    expect(result.artifact).toEqual({
      darPath: buildResult.darPath!,
      sizeBytes: expect.any(Number),
      source: 'explicit',
    })
  }, 60_000)
})
