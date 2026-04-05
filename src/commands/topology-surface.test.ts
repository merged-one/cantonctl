import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {captureOutput} from '@oclif/test'
import {afterEach, describe, expect, it, vi} from 'vitest'

import * as configModule from '../lib/config.js'
import type {Builder} from '../lib/builder.js'
import type {CantonctlConfig} from '../lib/config.js'
import type {DamlSdk} from '../lib/daml.js'
import type {FullDevServer} from '../lib/dev-server-full.js'
import type {DockerManager} from '../lib/docker.js'
import {ErrorCode} from '../lib/errors.js'
import type {ProcessRunner} from '../lib/process-runner.js'
import * as topologyModule from '../lib/topology.js'
import Dev from './dev.js'
import TopologyExport from './topology/export.js'
import TopologyShow from './topology/show.js'

const CLI_ROOT = process.cwd()
const originalCwd = process.cwd()

function createConfig(): CantonctlConfig {
  return {
    'default-profile': 'sandbox',
    parties: [
      {name: 'Alice', role: 'operator'},
      {name: 'Bob', role: 'participant'},
    ],
    profiles: {
      sandbox: {
        experimental: false,
        kind: 'sandbox',
        name: 'sandbox',
        services: {
          ledger: {port: 5001, 'json-api-port': 7575},
        },
      },
      'splice-devnet': {
        experimental: false,
        kind: 'remote-validator',
        name: 'splice-devnet',
        services: {
          ledger: {url: 'https://ledger.example.com'},
        },
      },
    },
    project: {name: 'demo', 'sdk-version': '3.4.11'},
    topologies: {
      demo: {
        'base-port': 20_000,
        'canton-image': 'ghcr.io/example/canton:test',
        kind: 'canton-multi',
        participants: [
          {name: 'alpha', parties: ['Alice']},
          {name: 'beta', parties: ['Bob']},
          {name: 'gamma', parties: []},
        ],
      },
    },
    version: 1,
  }
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim()) as Record<string, unknown>
}

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  process.chdir(originalCwd)
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, {force: true, recursive: true})
  }
})

describe('topology command surface', () => {
  it('shows a named topology in json mode', async () => {
    class TestTopologyShow extends TopologyShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestTopologyShow.run(['--topology', 'demo', '--json'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      metadata: {
        'base-port': 20_000,
        'canton-image': 'ghcr.io/example/canton:test',
        mode: 'net',
        selectedBy: 'named',
        topologyName: 'demo',
      },
      participants: [
        expect.objectContaining({name: 'alpha', parties: ['Alice']}),
        expect.objectContaining({name: 'beta', parties: ['Bob']}),
        expect.objectContaining({name: 'gamma', parties: []}),
      ],
    }))
  })

  it('shows the default topology in human mode through the default config loader', async () => {
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())

    const result = await captureOutput(() => TopologyShow.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(loadConfigSpy).toHaveBeenCalled()
    expect(result.stdout).toContain('Topology: default (default)')
    expect(result.stdout).toContain('Mode: net')
    expect(result.stdout).toContain('Participant')
  })

  it('shows a named topology in human mode and renders empty-party participants', async () => {
    class TestTopologyShow extends TopologyShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestTopologyShow.run(['--topology', 'demo'], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(result.stdout).toContain('Topology: demo (named)')
    expect(result.stdout).toContain('(none)')
  })

  it('exports a named topology to disk', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'topology-export-'))
    tempDirs.push(outDir)

    class TestTopologyExport extends TopologyExport {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestTopologyExport.run([
      '--topology',
      'demo',
      '--out-dir',
      outDir,
      '--json',
    ], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()

    const json = parseJson(result.stdout)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(expect.objectContaining({
      outDir,
      topology: 'demo',
    }))

    await expect(fs.readFile(path.join(outDir, 'docker-compose.yml'), 'utf8')).resolves.toContain('services:')
    await expect(fs.readFile(path.join(outDir, 'canton.conf'), 'utf8')).resolves.toContain('participants {')
    await expect(fs.readFile(path.join(outDir, 'bootstrap.canton'), 'utf8')).resolves.toContain('connect_local')
    await expect(fs.readFile(path.join(outDir, 'topology.json'), 'utf8')).resolves.toContain('"topologyName": "demo"')
  })

  it('exports the default topology in human mode through the default config loader', async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'topology-export-human-'))
    tempDirs.push(workDir)
    const loadConfigSpy = vi.spyOn(configModule, 'loadConfig').mockResolvedValue(createConfig())
    process.chdir(workDir)

    const result = await captureOutput(() => TopologyExport.run([], {root: CLI_ROOT}))
    expect(result.error).toBeUndefined()
    expect(loadConfigSpy).toHaveBeenCalled()
    expect(result.stdout).toContain('Exported topology "default"')
    expect(result.stdout).toContain('docker-compose.yml')
    await expect(fs.readFile(path.join(workDir, '.cantonctl', 'export', 'default', 'topology.json'), 'utf8'))
      .resolves.toContain('"topologyName": "default"')
  })

  it('serializes missing-topology errors for topology show and export', async () => {
    class TestTopologyShow extends TopologyShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    class TestTopologyExport extends TopologyExport {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const showResult = await captureOutput(() => TestTopologyShow.run(['--topology', 'missing', '--json'], {root: CLI_ROOT}))
    const exportResult = await captureOutput(() => TestTopologyExport.run(['--topology', 'missing', '--json'], {root: CLI_ROOT}))

    expect(showResult.error).toBeDefined()
    expect(exportResult.error).toBeDefined()
    expect(parseJson(showResult.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))
    expect(parseJson(exportResult.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))
  })

  it('rethrows unexpected topology show and export failures', async () => {
    class BrokenTopologyShow extends TopologyShow {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('boom-show')
      }
    }

    class BrokenTopologyExport extends TopologyExport {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        throw new Error('boom-export')
      }
    }

    await expect(BrokenTopologyShow.run([], {root: CLI_ROOT})).rejects.toThrow('boom-show')
    await expect(BrokenTopologyExport.run([], {root: CLI_ROOT})).rejects.toThrow('boom-export')
  })

  it('rejects dev --topology without --net', async () => {
    class TestDev extends Dev {
      protected override async loadProjectConfig(): Promise<CantonctlConfig> {
        return createConfig()
      }
    }

    const result = await captureOutput(() => TestDev.run(['--json', '--topology', 'demo'], {root: CLI_ROOT}))
    expect(result.error).toBeDefined()
    expect(parseJson(result.stdout)).toEqual(expect.objectContaining({
      error: expect.objectContaining({code: ErrorCode.CONFIG_SCHEMA_VIOLATION}),
      success: false,
    }))
  })

})
