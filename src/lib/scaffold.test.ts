import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'

import type {ProcessRunner} from './process-runner.js'
import {
  type ScaffoldFileSystem,
  type ScaffoldResult,
  type Template,
  generateConfig,
  generateDamlSource,
  generateDamlTest,
  scaffoldProject,
} from './scaffold.js'
import {CantonctlError, ErrorCode} from './errors.js'
import {loadConfig, type ConfigFileSystem} from './config.js'

// ---------------------------------------------------------------------------
// Mock filesystem that records all writes
// ---------------------------------------------------------------------------

interface WrittenFile {
  path: string
  content: string
}

function createMockScaffoldFs(existing: Set<string> = new Set()): ScaffoldFileSystem & {
  written: WrittenFile[]
  dirs: string[]
} {
  const written: WrittenFile[] = []
  const dirs: string[] = []
  return {
    dirs,
    existsSync(p: string) {
      return existing.has(p)
    },
    mkdirSync(p: string, _opts?: {recursive?: boolean}) {
      dirs.push(p)
    },
    writeFileSync(p: string, content: string) {
      written.push({content, path: p})
    },
    written,
  }
}

function createMockRunner(): ProcessRunner & {
  run: ReturnType<typeof vi.fn>
  spawn: ReturnType<typeof vi.fn>
  which: ReturnType<typeof vi.fn>
} {
  return {
    run: vi.fn<ProcessRunner['run']>(),
    spawn: vi.fn<ProcessRunner['spawn']>(),
    which: vi.fn<ProcessRunner['which']>(),
  }
}

// ---------------------------------------------------------------------------
// scaffoldProject
// ---------------------------------------------------------------------------

describe('scaffoldProject', () => {
  it('creates project directory structure for basic template', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'basic'})
    expect(fs.dirs).toContain('/projects/my-app')
    expect(fs.dirs).toContain(path.join('/projects/my-app', 'daml'))
    expect(fs.dirs).toContain(path.join('/projects/my-app', 'test'))
    expect(fs.dirs).toContain(path.join('/projects/my-app', 'scripts'))
  })

  it('creates frontend directories for token template', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'token'})
    expect(fs.dirs).toContain(path.join('/projects/my-app', 'frontend'))
    expect(fs.dirs).toContain(path.join('/projects/my-app', 'frontend', 'src'))
  })

  it('creates frontend directories for zenith-evm template', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'zenith-evm'})
    expect(fs.dirs).toContain(path.join('/projects/my-app', 'frontend'))
  })

  it('writes cantonctl.yaml, daml.yaml, Main.daml, test, .gitignore', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'basic'})
    const paths = fs.written.map(f => f.path)
    expect(paths).toContain(path.join('/projects/my-app', 'cantonctl.yaml'))
    expect(paths).toContain(path.join('/projects/my-app', 'daml.yaml'))
    expect(paths).toContain(path.join('/projects/my-app', 'daml', 'Main.daml'))
    expect(paths).toContain(path.join('/projects/my-app', 'test', 'Main.test.daml'))
    expect(paths).toContain(path.join('/projects/my-app', '.gitignore'))
  })

  it('throws CantonctlError if directory already exists', () => {
    const fs = createMockScaffoldFs(new Set(['/projects/my-app']))
    expect(() => scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'basic'}))
      .toThrow(CantonctlError)
    try {
      scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'basic'})
    } catch (err) {
      const e = err as CantonctlError
      expect(e.code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
      expect(e.suggestion).toContain('my-app')
    }
  })

  it('returns result with created files list', () => {
    const fs = createMockScaffoldFs()
    const result = scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'basic'})
    expect(result.projectDir).toBe('/projects/my-app')
    expect(result.template).toBe('basic')
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('creates api-service specific files', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-api', fs, name: 'my-api', template: 'api-service'})
    const paths = fs.written.map(f => f.path)
    // Should have server directory and package.json
    expect(paths.some(p => p.includes('server'))).toBe(true)
    expect(paths.some(p => p.includes('package.json'))).toBe(true)
  })

  it('creates zenith-evm specific files', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-evm', fs, name: 'my-evm', template: 'zenith-evm'})
    const paths = fs.written.map(f => f.path)
    // Should have contracts/ directory with Solidity and hardhat config
    expect(paths.some(p => p.includes('.sol'))).toBe(true)
    expect(paths.some(p => p.includes('hardhat.config'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// generateConfig
// ---------------------------------------------------------------------------

describe('generateConfig', () => {
  it('produces valid YAML that passes schema validation', () => {
    for (const template of ['basic', 'token', 'defi-amm', 'api-service', 'zenith-evm'] as Template[]) {
      const yaml = generateConfig('test-project', template)
      // Verify it passes the Zod schema by loading through config module
      const configFs: ConfigFileSystem = {
        existsSync: (p: string) => p === '/project/cantonctl.yaml',
        readFileSync: () => yaml,
      }
      // Should not throw
      expect(async () => await loadConfig({dir: '/project', fs: configFs})).not.toThrow()
    }
  })

  it('includes project name and sdk-version', () => {
    const yaml = generateConfig('my-app', 'basic')
    expect(yaml).toContain('name: my-app')
    expect(yaml).toContain('sdk-version:')
  })

  it('includes template name', () => {
    const yaml = generateConfig('my-app', 'token')
    expect(yaml).toContain('template: token')
  })

  it('includes default parties (Alice and Bob)', () => {
    const yaml = generateConfig('my-app', 'basic')
    expect(yaml).toContain('Alice')
    expect(yaml).toContain('Bob')
  })

  it('includes local sandbox network', () => {
    const yaml = generateConfig('my-app', 'basic')
    expect(yaml).toContain('sandbox')
    expect(yaml).toContain('5001')
    expect(yaml).toContain('7575')
  })
})

// ---------------------------------------------------------------------------
// generateDamlSource
// ---------------------------------------------------------------------------

describe('generateDamlSource', () => {
  it('generates Hello template for basic', () => {
    const source = generateDamlSource('basic')
    expect(source).toContain('template Hello')
    expect(source).toContain('signatory owner')
    expect(source).toContain('choice UpdateMessage')
  })

  it('generates Token template with Transfer/Burn/Mint for token', () => {
    const source = generateDamlSource('token')
    expect(source).toContain('template Token')
    expect(source).toContain('choice Transfer')
    expect(source).toContain('choice Burn')
    expect(source).toContain('choice Mint')
  })

  it('generates LiquidityPool for defi-amm', () => {
    const source = generateDamlSource('defi-amm')
    expect(source).toContain('template LiquidityPool')
    expect(source).toContain('choice AddLiquidity')
    expect(source).toContain('choice Swap')
  })

  it('generates API service Daml contract for api-service', () => {
    const source = generateDamlSource('api-service')
    expect(source).toContain('module Main where')
    expect(source).toContain('template')
    expect(source).toContain('signatory')
  })

  it('generates Zenith bridge Daml contract for zenith-evm', () => {
    const source = generateDamlSource('zenith-evm')
    expect(source).toContain('module Main where')
    expect(source).toContain('template')
    expect(source).toContain('signatory')
  })
})

// ---------------------------------------------------------------------------
// generateDamlTest
// ---------------------------------------------------------------------------

describe('generateDamlTest', () => {
  it('generates tests for basic template', () => {
    const test = generateDamlTest('basic')
    expect(test).toContain('import Main')
    expect(test).toContain('import Daml.Script')
    expect(test).toContain('testCreate')
    expect(test).toContain('testUpdate')
  })

  it('generates tests for token template', () => {
    const test = generateDamlTest('token')
    expect(test).toContain('testMint')
    expect(test).toContain('testTransfer')
    expect(test).toContain('testCannotOverTransfer')
    expect(test).toContain('testBurn')
  })

  it('generates tests for defi-amm template', () => {
    const test = generateDamlTest('defi-amm')
    expect(test).toContain('import Main')
    expect(test).toContain('LiquidityPool')
  })

  it('generates tests for api-service template', () => {
    const test = generateDamlTest('api-service')
    expect(test).toContain('import Main')
    expect(test).toContain('import Daml.Script')
  })

  it('generates tests for zenith-evm template', () => {
    const test = generateDamlTest('zenith-evm')
    expect(test).toContain('import Main')
    expect(test).toContain('import Daml.Script')
  })
})

// ---------------------------------------------------------------------------
// Community template (--from)
// ---------------------------------------------------------------------------

describe('scaffoldFromUrl', () => {
  it('clones repo and validates manifest exists', async () => {
    const {scaffoldFromUrl} = await import('./scaffold.js')
    const runner = createMockRunner()
    runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: ''})

    const fs = createMockScaffoldFs()
    // Simulate the cloned repo having a cantonctl-template.yaml
    const existsSet = new Set<string>()
    const fsWithManifest: ScaffoldFileSystem = {
      ...fs,
      existsSync(p: string) {
        // After clone, the manifest should exist
        if (p.includes('cantonctl-template.yaml')) return true
        return existsSet.has(p)
      },
    }

    await scaffoldFromUrl({
      dir: '/projects/my-app',
      fs: fsWithManifest,
      runner,
      url: 'https://github.com/user/my-template',
    })

    expect(runner.run).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['clone']),
      expect.anything(),
    )
  })

  it('throws if cloned repo has no cantonctl-template.yaml', async () => {
    const {scaffoldFromUrl} = await import('./scaffold.js')
    const runner = createMockRunner()
    runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: ''})

    const fs = createMockScaffoldFs()

    await expect(scaffoldFromUrl({
      dir: '/projects/my-app',
      fs,
      runner,
      url: 'https://github.com/user/bad-template',
    })).rejects.toThrow(CantonctlError)
  })

  it('throws if git clone fails', async () => {
    const {scaffoldFromUrl} = await import('./scaffold.js')
    const runner = createMockRunner()
    runner.run.mockResolvedValue({exitCode: 128, stderr: 'fatal: repository not found', stdout: ''})

    const fs = createMockScaffoldFs()

    await expect(scaffoldFromUrl({
      dir: '/projects/my-app',
      fs,
      runner,
      url: 'https://github.com/user/nonexistent',
    })).rejects.toThrow(CantonctlError)
  })
})
