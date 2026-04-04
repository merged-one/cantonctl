/**
 * @module test/e2e/dev-full
 *
 * End-to-end tests for `cantonctl dev --full` (multi-node Docker topology).
 *
 * These tests start a real Canton Docker topology via Docker Compose, verify
 * health polling across multiple participants, and test party provisioning.
 *
 * Prerequisites:
 *   - Docker + Docker Compose v2 installed and running
 *   - Canton Docker image pulled locally (CI pre-pulls; local devs: docker pull <image>)
 *   - Supported SDK CLI on PATH (`dpm` current, `daml` legacy) + Java 21+
 *
 * Skip conditions:
 *   - Tests are skipped if Docker, the Canton image, or a supported SDK CLI is not available.
 *   - This prevents local `npm test` from failing on machines without Docker.
 *
 * Port scheme:
 *   Uses basePort: 20000 to avoid conflicts with sandbox E2E tests (5xxx/7xxx).
 *   - Synchronizer: admin=20001, publicApi=20002
 *   - participant1: admin=20011, ledgerApi=20012, jsonApi=20013
 *   - participant2: admin=20021, ledgerApi=20022, jsonApi=20023
 *
 * CI parity:
 *   - GitHub Actions: runs in dedicated `e2e-docker-tests` job on `ubuntu-latest`
 *     (native Docker, no DinD). Image is pre-pulled and cached.
 *   - Local: `./scripts/ci-local.sh e2e-docker` or `npm run test:e2e:docker`
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {watch} from 'chokidar'

import {createDamlSdk} from '../../src/lib/daml.js'
import {createFullDevServer, type FullDevServer} from '../../src/lib/dev-server-full.js'
import {createDockerManager} from '../../src/lib/docker.js'
import {createSandboxToken} from '../../src/lib/jwt.js'
import {createLedgerClient} from '../../src/lib/ledger-client.js'
import type {OutputWriter} from '../../src/lib/output.js'
import {createProcessRunner} from '../../src/lib/process-runner.js'
import {scaffoldProject} from '../../src/lib/scaffold.js'
import {CANTON_IMAGE, createE2eTempDir, hasCantonImage, hasDocker, hasSdk, SDK_VERSION} from './helpers.js'

// ---------------------------------------------------------------------------
// Skip guards — layered detection
// ---------------------------------------------------------------------------

const DOCKER_AVAILABLE = hasDocker()
const IMAGE_AVAILABLE = DOCKER_AVAILABLE && hasCantonImage()
const SDK_AVAILABLE = hasSdk()
const CAN_RUN = DOCKER_AVAILABLE && IMAGE_AVAILABLE && SDK_AVAILABLE

if (!DOCKER_AVAILABLE) console.log('SKIP: Docker not available')
else if (!IMAGE_AVAILABLE) console.log(`SKIP: Canton image not found locally. Run: docker pull ${CANTON_IMAGE}`)
else if (!SDK_AVAILABLE) console.log('SKIP: supported SDK CLI not available')

const describeIfReady = CAN_RUN ? describe : describe.skip

// ---------------------------------------------------------------------------
// Test output capture
// ---------------------------------------------------------------------------

function createTestOutput(): OutputWriter & {messages: string[]} {
  const messages: string[] = []
  return {
    error: (msg: string) => { messages.push(`ERROR: ${msg}`) },
    info: (msg: string) => { messages.push(`INFO: ${msg}`) },
    log: (msg: string) => { messages.push(`LOG: ${msg}`) },
    messages,
    result: () => {},
    spinner: () => ({fail: () => {}, start: () => {}, stop: () => {}, succeed: () => {}}),
    success: (msg: string) => { messages.push(`SUCCESS: ${msg}`) },
    table: () => {},
    warn: (msg: string) => { messages.push(`WARN: ${msg}`) },
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_PORT = 20_000
const PARTICIPANT1_JSON_API = 20_013
const PARTICIPANT2_JSON_API = 20_023
const DOCKER_TEST_HOST = process.env.CANTONCTL_E2E_DOCKER_HOST ?? 'localhost'
const TOPOLOGY_CONTAINER_NAME = 'fulldev-test-canton-1'

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describeIfReady('dev --full E2E: multi-node Docker topology', () => {
  let workDir: string
  let projectDir: string
  let server: FullDevServer | null = null
  let output: OutputWriter & {messages: string[]}

  beforeAll(async () => {
    // Create temp workspace
    workDir = createE2eTempDir('cantonctl-e2e-dev-full-')
    projectDir = path.join(workDir, 'fulldev-test')

    // Scaffold a project with two parties on different roles
    scaffoldProject({dir: projectDir, name: 'fulldev-test', template: 'basic'})

    // Fix SDK version in daml.yaml
    const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
    fs.writeFileSync(
      path.join(projectDir, 'daml.yaml'),
      damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
    )

    // Write cantonctl.yaml with two parties (exercises multi-participant assignment)
    const cantonYaml = [
      'version: 1',
      'project:',
      '  name: fulldev-test',
      `  sdk-version: "${SDK_VERSION}"`,
      '  template: basic',
      'parties:',
      '  - name: Alice',
      '    role: operator',
      '  - name: Bob',
      '    role: participant',
      'networks:',
      '  local:',
      '    type: sandbox',
      '    port: 5001',
      '    json-api-port: 7575',
    ].join('\n')
    fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), cantonYaml)
  }, 30_000)

  afterAll(async () => {
    // Layer 1: In-test cleanup
    if (server) {
      try {
        await server.stop()
      } catch (err) {
        console.error('Server stop failed:', err)
      }

      server = null
    }

    // Layer 2: Fallback Docker cleanup (catches leaked containers)
    const configDir = path.join(projectDir, '.cantonctl')
    const composeFile = path.join(configDir, 'docker-compose.yml')
    if (fs.existsSync(composeFile)) {
      try {
        const {execSync} = await import('node:child_process')
        execSync(`docker compose -f "${composeFile}" down --remove-orphans --timeout 10`, {
          stdio: 'pipe',
          timeout: 30_000,
        })
      } catch {
        // Best-effort cleanup
      }
    }

    // Layer 3: Clean temp directory
    try {
      fs.rmSync(workDir, {recursive: true, force: true})
    } catch {
      // Non-fatal
    }
  }, 60_000)

  it('starts topology, all participants become healthy, and provisions parties', async () => {
    output = createTestOutput()
    const runner = createProcessRunner()
    const sdk = createDamlSdk({runner})
    const docker = createDockerManager({output, runner})

    const {loadConfig} = await import('../../src/lib/config.js')
    const config = await loadConfig({dir: projectDir})

    server = createFullDevServer({
      build: async (dir: string) => { await sdk.build({projectDir: dir}) },
      cantonImage: CANTON_IMAGE,
      config,
      createClient: (options) => createLedgerClient({
        ...options,
        baseUrl: options.baseUrl.replace('localhost', DOCKER_TEST_HOST),
      }),
      createToken: createSandboxToken,
      docker,
      findDarFile: async (dir: string) => {
        try {
          const entries = await fs.promises.readdir(dir)
          const dar = entries.find(e => e.endsWith('.dar'))
          return dar ? path.join(dir, dar) : null
        } catch { return null }
      },
      mkdir: (dir: string) => fs.promises.mkdir(dir, {recursive: true}).then(() => undefined),
      output,
      readFile: (p: string) => fs.promises.readFile(p),
      rmdir: (dir: string) => fs.promises.rm(dir, {force: true, recursive: true}),
      watch: (paths, opts) => watch(paths, opts),
      writeFile: (p: string, content: string) => fs.promises.writeFile(p, content, 'utf8'),
    })

    // Start the topology — this generates configs, starts Docker Compose,
    // polls health for all participants, and provisions parties.
    await server.start({
      basePort: BASE_PORT,
      debounceMs: 500,
      healthRetryDelayMs: 3_000,
      healthTimeoutMs: 180_000,
      projectDir,
    })

    // -----------------------------------------------------------------------
    // Verify: topology generated and Docker started
    // -----------------------------------------------------------------------
    expect(output.messages.some(m => m.includes('Generating multi-node topology'))).toBe(true)
    expect(output.messages.some(m => m.includes('Starting multi-node Canton topology'))).toBe(true)

    // Verify: .cantonctl/ config directory was created
    const configDir = path.join(projectDir, '.cantonctl')
    expect(fs.existsSync(path.join(configDir, 'docker-compose.yml'))).toBe(true)
    expect(fs.existsSync(path.join(configDir, 'canton.conf'))).toBe(true)
    expect(fs.existsSync(path.join(configDir, 'bootstrap.canton'))).toBe(true)

    // -----------------------------------------------------------------------
    // Verify: both participants are healthy
    // -----------------------------------------------------------------------
    expect(output.messages.some(m => m.includes('participant1') && m.includes('healthy'))).toBe(true)
    expect(output.messages.some(m => m.includes('participant2') && m.includes('healthy'))).toBe(true)

    // -----------------------------------------------------------------------
    // Verify: party provisioning was attempted on correct participants
    // -----------------------------------------------------------------------
    expect(output.messages.some(m => m.includes('Provisioning parties on participant1'))).toBe(true)
    expect(output.messages.some(m => m.includes('Provisioning parties on participant2'))).toBe(true)

    // Alice (operator) → participant1, Bob (participant) → participant2
    // We check that party names appear in provisioning output
    const partyMessages = output.messages.filter(m => m.includes('Alice') || m.includes('Bob'))
    expect(partyMessages.length).toBeGreaterThan(0)

    // -----------------------------------------------------------------------
    // Verify: JSON API is reachable on both participants via HTTP
    // -----------------------------------------------------------------------
    const token = await createSandboxToken({
      actAs: ['Alice', 'Bob'],
      admin: true,
      applicationId: 'e2e-test',
      readAs: ['Alice', 'Bob'],
    })

    const response1 = await fetch(`http://${DOCKER_TEST_HOST}:${PARTICIPANT1_JSON_API}/v2/version`, {
      headers: {Authorization: `Bearer ${token}`},
    })
    expect(response1.ok).toBe(true)
    const body1 = await response1.json() as Record<string, unknown>
    expect(body1.version).toBeDefined()

    const response2 = await fetch(`http://${DOCKER_TEST_HOST}:${PARTICIPANT2_JSON_API}/v2/version`, {
      headers: {Authorization: `Bearer ${token}`},
    })
    expect(response2.ok).toBe(true)
    const body2 = await response2.json() as Record<string, unknown>
    expect(body2.version).toBeDefined()
  }, 240_000) // 4 min: image load + container startup + health polling

  it('shuts down cleanly (containers removed, ports freed, configs cleaned up)', async () => {
    // server was started in the previous test
    expect(server).not.toBeNull()

    await server!.stop()
    const stoppedServer = server
    server = null // Prevent afterAll double-stop

    // Wait for containers to fully stop and ports to release
    await new Promise(r => setTimeout(r, 3_000))

    // -----------------------------------------------------------------------
    // Verify: Docker containers are gone
    // -----------------------------------------------------------------------
    const {execSync} = await import('node:child_process')
    const psOutput = execSync('docker ps --format "{{.Names}}"', {stdio: 'pipe'}).toString()
    expect(psOutput).not.toContain(TOPOLOGY_CONTAINER_NAME)

    // -----------------------------------------------------------------------
    // Verify: ports are freed (fetch should fail with connection refused)
    // -----------------------------------------------------------------------
    for (const port of [PARTICIPANT1_JSON_API, PARTICIPANT2_JSON_API]) {
      let reachable = true
      try {
        await fetch(`http://${DOCKER_TEST_HOST}:${port}/v2/version`, {
          signal: AbortSignal.timeout(2_000),
        })
      } catch {
        reachable = false
      }

      expect(reachable).toBe(false)
    }

    // -----------------------------------------------------------------------
    // Verify: .cantonctl/ config directory was cleaned up
    // -----------------------------------------------------------------------
    const configDir = path.join(projectDir, '.cantonctl')
    expect(fs.existsSync(configDir)).toBe(false)
  }, 60_000)
})
