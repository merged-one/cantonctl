/**
 * @module test/e2e/topology-net
 *
 * Docker-backed end-to-end coverage for named local topologies and the
 * manifest-backed workbench topology APIs.
 *
 * This suite exercises the real runtime behind:
 * - `cantonctl topology show`
 * - `cantonctl topology export`
 * - `cantonctl dev --net --topology <name>`
 * - `cantonctl playground --net --topology <name>`
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import {captureOutput} from '@oclif/test'
import {watch} from 'chokidar'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import Dev from '../../src/commands/dev.js'
import Playground from '../../src/commands/playground.js'
import TopologyExport from '../../src/commands/topology/export.js'
import TopologyShow from '../../src/commands/topology/show.js'
import type {Builder} from '../../src/lib/builder.js'
import {loadConfig, type CantonctlConfig} from '../../src/lib/config.js'
import type {DamlSdk} from '../../src/lib/daml.js'
import {createFullDevServer, type FullDevServer} from '../../src/lib/dev-server-full.js'
import type {DockerManager} from '../../src/lib/docker.js'
import {createSandboxToken} from '../../src/lib/jwt.js'
import {createLedgerClient} from '../../src/lib/ledger-client.js'
import type {OutputWriter} from '../../src/lib/output.js'
import {findDarFile} from '../../src/lib/runtime-support.js'
import {scaffoldProject} from '../../src/lib/scaffold.js'
import {createServeServer, type ServeServer} from '../../src/lib/serve.js'
import type {TestRunner} from '../../src/lib/test-runner.js'
import {createE2eTempDir, CANTON_IMAGE, hasCantonImage, hasDocker, hasSdk, SDK_VERSION} from './helpers.js'

const DOCKER_AVAILABLE = hasDocker()
const IMAGE_AVAILABLE = DOCKER_AVAILABLE && hasCantonImage()
const SDK_AVAILABLE = hasSdk()
const CAN_RUN = DOCKER_AVAILABLE && IMAGE_AVAILABLE && SDK_AVAILABLE

if (!DOCKER_AVAILABLE) console.log('SKIP: Docker not available')
else if (!IMAGE_AVAILABLE) console.log(`SKIP: Canton image not found locally. Run: docker pull ${CANTON_IMAGE}`)
else if (!SDK_AVAILABLE) console.log('SKIP: supported SDK CLI not available')

const describeIfReady = CAN_RUN ? describe : describe.skip

const CLI_ROOT = process.cwd()
const DOCKER_TEST_HOST = process.env.CANTONCTL_E2E_DOCKER_HOST ?? 'localhost'
const TOPOLOGY_NAME = 'triad'
const BASE_PORT = 21_000
const PLAYGROUND_PORT = 4_301
const PROJECT_NAME = 'topology-net-test'

const PARTICIPANTS = [
  {jsonApi: 21_013, name: 'alpha', parties: ['Alice']},
  {jsonApi: 21_023, name: 'beta', parties: ['Bob']},
  {jsonApi: 21_033, name: 'gamma', parties: ['Carol']},
] as const

function withDockerHost(baseUrl: string): string {
  return baseUrl.replace('localhost', DOCKER_TEST_HOST)
}

function writeTopologyFixture(projectDir: string): void {
  scaffoldProject({dir: projectDir, name: PROJECT_NAME, template: 'basic'})

  const damlYamlPath = path.join(projectDir, 'daml.yaml')
  const damlYaml = fs.readFileSync(damlYamlPath, 'utf8')
  fs.writeFileSync(
    damlYamlPath,
    damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
  )

  const cantonYaml = [
    'version: 1',
    'project:',
    `  name: ${PROJECT_NAME}`,
    `  sdk-version: "${SDK_VERSION}"`,
    '  template: basic',
    'parties:',
    '  - name: Alice',
    '    role: operator',
    '  - name: Bob',
    '    role: participant',
    '  - name: Carol',
    '    role: observer',
    'topologies:',
    `  ${TOPOLOGY_NAME}:`,
    '    kind: canton-multi',
    `    base-port: ${BASE_PORT}`,
    `    canton-image: ${CANTON_IMAGE}`,
    '    participants:',
    '      - name: alpha',
    '        parties: [Alice]',
    '      - name: beta',
    '        parties: [Bob]',
    '      - name: gamma',
    '        parties: [Carol]',
  ].join('\n')

  fs.writeFileSync(path.join(projectDir, 'cantonctl.yaml'), cantonYaml)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${await response.text()}`)
  }

  return response.json() as Promise<T>
}

async function fetchJsonWithRetry<T>(url: string, timeoutMs = 20_000, delayMs = 1_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      return await fetchJson<T>(url)
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`)
}

function createNamedTopologyFullServer(config: CantonctlConfig, deps: {
  docker: DockerManager
  output: OutputWriter
  sdk: DamlSdk
}): FullDevServer {
  return createFullDevServer({
    build: async (projectDir: string): Promise<void> => { await deps.sdk.build({projectDir}) },
    cantonImage: CANTON_IMAGE,
    config,
    createClient: (options) => createLedgerClient({
      ...options,
      baseUrl: withDockerHost(options.baseUrl),
    }),
    createToken: createSandboxToken,
    docker: deps.docker,
    findDarFile,
    mkdir: (dir: string) => fs.promises.mkdir(dir, {recursive: true}).then(() => undefined),
    output: deps.output,
    readFile: (filePath: string) => fs.promises.readFile(filePath),
    rmdir: (dir: string) => fs.promises.rm(dir, {force: true, recursive: true}),
    watch: (paths, opts) => watch(paths, opts),
    writeFile: (filePath: string, content: string) => fs.promises.writeFile(filePath, content, 'utf8'),
  })
}

describeIfReady('topology net E2E: named and varied local topologies', () => {
  let workDir: string
  let projectDir: string

  beforeAll(() => {
    workDir = createE2eTempDir('cantonctl-e2e-topology-net-')
    projectDir = path.join(workDir, PROJECT_NAME)
    writeTopologyFixture(projectDir)
  }, 30_000)

  afterAll(() => {
    fs.rmSync(workDir, {force: true, recursive: true})
  })

  it('topology show and export resolve the named triad fixture from disk', async () => {
    class TestTopologyShow extends TopologyShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return loadConfig({dir: projectDir})
      }
    }

    class TestTopologyExport extends TopologyExport {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return loadConfig({dir: projectDir})
      }
    }

    const showResult = await captureOutput(() => TestTopologyShow.run(['--topology', TOPOLOGY_NAME, '--json'], {root: CLI_ROOT}))
    expect(showResult.error).toBeUndefined()
    const showJson = JSON.parse(showResult.stdout) as {
      data: {
        metadata: {'base-port': number; mode: string; selectedBy: string; topologyName: string}
        participants: Array<{name: string; parties: string[]; ports: {jsonApi: number}}>
      }
      success: boolean
    }

    expect(showJson.success).toBe(true)
    expect(showJson.data.metadata).toEqual(expect.objectContaining({
      'base-port': BASE_PORT,
      mode: 'net',
      selectedBy: 'named',
      topologyName: TOPOLOGY_NAME,
    }))
    expect(showJson.data.participants.map(participant => participant.name)).toEqual(['alpha', 'beta', 'gamma'])

    const exportDir = path.join(workDir, 'topology-export')
    const exportResult = await captureOutput(() => TestTopologyExport.run([
      '--topology',
      TOPOLOGY_NAME,
      '--out-dir',
      exportDir,
      '--json',
    ], {root: CLI_ROOT}))
    expect(exportResult.error).toBeUndefined()

    const exportedManifest = JSON.parse(
      fs.readFileSync(path.join(exportDir, 'topology.json'), 'utf8'),
    ) as {
      metadata: {'base-port': number; topologyName: string}
      participants: Array<{name: string; ports: {jsonApi: number}}>
    }

    expect(exportedManifest.metadata).toEqual(expect.objectContaining({
      'base-port': BASE_PORT,
      topologyName: TOPOLOGY_NAME,
    }))
    expect(exportedManifest.participants.map(participant => participant.name)).toEqual(['alpha', 'beta', 'gamma'])
    expect(fs.readFileSync(path.join(exportDir, 'bootstrap.canton'), 'utf8')).toContain('gamma')
  })

  it('dev --net --topology starts and stops a named three-participant topology', async () => {
    class TestDev extends Dev {
      protected override createFullServer(deps: {
        cantonImage: string
        config: CantonctlConfig
        docker: DockerManager
        output: OutputWriter
        sdk: DamlSdk
      }): FullDevServer {
        return createNamedTopologyFullServer(deps.config, deps)
      }

      protected override getProjectDir(): string {
        return projectDir
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return loadConfig({dir: projectDir})
      }

      protected override async waitForShutdown(
        _json: boolean,
        shutdown: () => Promise<void>,
        shutdownPromise: Promise<void>,
      ): Promise<void> {
        try {
          const manifest = JSON.parse(
            fs.readFileSync(path.join(projectDir, '.cantonctl', 'topology.json'), 'utf8'),
          ) as {
            metadata: {selectedBy: string; topologyName: string}
            participants: Array<{name: string; parties: string[]; ports: {jsonApi: number}}>
          }

          expect(manifest.metadata).toEqual(expect.objectContaining({
            selectedBy: 'named',
            topologyName: TOPOLOGY_NAME,
          }))
          expect(manifest.participants.map(participant => participant.name)).toEqual(['alpha', 'beta', 'gamma'])

          for (const participant of PARTICIPANTS) {
            const version = await fetchJsonWithRetry<{version: string}>(
              `http://${DOCKER_TEST_HOST}:${participant.jsonApi}/v2/version`,
            )
            expect(version.version).toBeTruthy()
          }
        } finally {
          await shutdown()
          await shutdownPromise
        }
      }
    }

    const result = await captureOutput(() => TestDev.run(['--net', '--topology', TOPOLOGY_NAME], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain(`Topology "${TOPOLOGY_NAME}": 3 participants + 1 synchronizer`)
    expect(result.stdout).toContain('alpha')
    expect(result.stdout).toContain('beta')
    expect(result.stdout).toContain('gamma')
    expect(fs.existsSync(path.join(projectDir, '.cantonctl'))).toBe(false)
  }, 240_000)

  it('playground --net --topology exposes the selected manifest and three participant statuses', async () => {
    class TestPlayground extends Playground {
      protected override createFullServer(deps: {
        cantonImage: string
        config: CantonctlConfig
        docker: DockerManager
        output: OutputWriter
        sdk: DamlSdk
      }): FullDevServer {
        return createNamedTopologyFullServer(deps.config, deps)
      }

      protected override createServeServer(deps: {
        builder: Builder
        output: OutputWriter
        testRunner: TestRunner
      }): ServeServer {
        return createServeServer({
          builder: deps.builder,
          createLedgerClient: (options) => createLedgerClient({
            ...options,
            baseUrl: withDockerHost(options.baseUrl),
          }),
          createToken: createSandboxToken,
          output: deps.output,
          testRunner: deps.testRunner,
        })
      }

      protected override getProjectDir(): string {
        return projectDir
      }

      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return loadConfig({dir: projectDir})
      }

      protected override openBrowser(_url: string): void {
        // No-op in E2E; browser launch is not part of the runtime contract.
      }

      protected override resolveStaticDir(): string | undefined {
        return undefined
      }

      protected override async waitForShutdown(shutdown: () => Promise<void>): Promise<void> {
        try {
          const topology = await fetchJsonWithRetry<{
            mode: string
            selection: {selectedBy: string; topologyName: string} | null
            topology: {
              participants: Array<{name: string; parties: string[]; ports: {jsonApi: number}}>
            } | null
          }>(`http://localhost:${PLAYGROUND_PORT}/api/topology`)

          expect(topology.mode).toBe('net')
          expect(topology.selection).toEqual(expect.objectContaining({
            selectedBy: 'named',
            topologyName: TOPOLOGY_NAME,
          }))
          expect(topology.topology?.participants.map(participant => participant.name)).toEqual(['alpha', 'beta', 'gamma'])

          const status = await fetchJsonWithRetry<{
            participants: Array<{healthy: boolean; name: string; port: number}>
          }>(`http://localhost:${PLAYGROUND_PORT}/api/topology/status`)

          expect(status.participants).toHaveLength(3)
          expect(status.participants.map(participant => participant.name)).toEqual(['alpha', 'beta', 'gamma'])
          expect(status.participants.every(participant => participant.healthy)).toBe(true)
        } finally {
          await shutdown()
        }
      }
    }

    const result = await captureOutput(() => TestPlayground.run([
      '--net',
      '--topology',
      TOPOLOGY_NAME,
      '--no-open',
      '--port',
      String(PLAYGROUND_PORT),
    ], {root: CLI_ROOT}))

    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain(`Local Canton net topology ready (${TOPOLOGY_NAME})`)
    expect(result.stdout).toContain(`Playground:  http://localhost:${PLAYGROUND_PORT}`)
    expect(fs.existsSync(path.join(projectDir, '.cantonctl'))).toBe(false)
  }, 240_000)
})
