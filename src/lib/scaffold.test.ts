import * as path from 'node:path'
import * as nodeFs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {describe, expect, it, vi} from 'vitest'

import {loadConfig, type ConfigFileSystem} from './config.js'
import {CantonctlError, ErrorCode} from './errors.js'
import type {ProcessRunner} from './process-runner.js'
import {
  type ScaffoldFileSystem,
  generateConfig,
  generateDamlSource,
  generateDamlTest,
  scaffoldProject,
  type Template,
} from './scaffold.js'
import {getUpstreamSource} from './upstream/manifest.js'

const BUILTIN_TEMPLATES: Template[] = [
  'basic',
  'token',
  'defi-amm',
  'api-service',
  'zenith-evm',
  'splice-token-app',
  'splice-scan-reader',
  'splice-dapp-sdk',
]

const PINNED_SDK_VERSION = (() => {
  const source = getUpstreamSource('canton-json-ledger-api-openapi').source
  const version = source.kind === 'git' ? source.ref : source.version
  return version.replace(/^v/, '').split('-')[0]
})()

const TEMPLATE_ROOT = fileURLToPath(new URL('../../assets/templates/', import.meta.url))

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

async function loadGeneratedConfig(yaml: string) {
  const configFs: ConfigFileSystem = {
    existsSync: (p: string) => p === '/project/cantonctl.yaml',
    readFileSync: () => yaml,
  }

  return loadConfig({dir: '/project', fs: configFs})
}

function getWrittenFile(
  fs: ReturnType<typeof createMockScaffoldFs>,
  relPath: string,
): WrittenFile {
  const writtenFile = fs.written.find(file => file.path === path.join('/projects/my-app', relPath))
  expect(writtenFile).toBeDefined()
  return writtenFile!
}

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
      expect(e.code).toBe(ErrorCode.CONFIG_DIRECTORY_EXISTS)
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
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'api-service'})
    const paths = fs.written.map(f => f.path)
    expect(paths).toContain(path.join('/projects/my-app', 'server', 'package.json'))
    expect(paths).toContain(path.join('/projects/my-app', 'server', 'src', 'server.ts'))
    expect(paths).toContain(path.join('/projects/my-app', 'server', 'tsconfig.json'))
  })

  it('creates zenith-evm specific files', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'zenith-evm'})
    const paths = fs.written.map(f => f.path)
    expect(paths).toContain(path.join('/projects/my-app', 'contracts', 'Token.sol'))
    expect(paths).toContain(path.join('/projects/my-app', 'hardhat.config.ts'))
    expect(paths).toContain(path.join('/projects/my-app', 'package.json'))
  })

  it('creates stable token-standard starter files for splice-token-app', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-token-app'})

    const paths = fs.written.map(f => f.path)
    expect(paths).toContain(path.join('/projects/my-app', 'frontend', 'package.json'))
    expect(paths).toContain(path.join('/projects/my-app', 'frontend', 'src', 'token-client.ts'))

    const client = getWrittenFile(fs, path.join('frontend', 'src', 'token-client.ts')).content
    expect(client).toContain('transfer-instruction')
    expect(client).toContain('holdings')
    expect(client).not.toContain('validator-internal')
    expect(client).not.toContain('burn-mint')
  })

  it('creates stable scan reader files for splice-scan-reader', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-scan-reader'})

    const paths = fs.written.map(f => f.path)
    expect(paths).toContain(path.join('/projects/my-app', 'scripts', 'read-scan-updates.mjs'))

    const reader = getWrittenFile(fs, path.join('scripts', 'read-scan-updates.mjs')).content
    expect(reader).toContain('/v2/updates')
    expect(reader).not.toContain('validator-internal')
  })

  it('creates dapp sdk starter files using public packages for splice-dapp-sdk', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-dapp-sdk'})

    const paths = fs.written.map(f => f.path)
    expect(paths).toContain(path.join('/projects/my-app', 'frontend', 'package.json'))
    expect(paths).toContain(path.join('/projects/my-app', 'frontend', 'src', 'wallet.ts'))

    const packageJson = getWrittenFile(fs, path.join('frontend', 'package.json')).content
    expect(packageJson).toContain('@canton-network/dapp-sdk')
    expect(packageJson).toContain('@canton-network/wallet-sdk')
    expect(packageJson).not.toContain('validator-internal')
  })

  it('throws when bundled template files are missing', () => {
    const filesPath = path.join(TEMPLATE_ROOT, 'basic', 'files')
    const backupPath = `${filesPath}.tmp-test`
    nodeFs.renameSync(filesPath, backupPath)

    try {
      expect(() => scaffoldProject({
        dir: '/projects/my-app',
        fs: createMockScaffoldFs(),
        name: 'my-app',
        template: 'basic',
      })).toThrow(CantonctlError)
    } finally {
      nodeFs.renameSync(backupPath, filesPath)
    }
  })

  it('ignores non-file entries while walking bundled template files', () => {
    const symlinkPath = path.join(TEMPLATE_ROOT, 'basic', 'files', 'symlink.tmp-test')
    nodeFs.symlinkSync(path.join(TEMPLATE_ROOT, 'basic', 'files', 'daml', 'Main.daml'), symlinkPath)

    try {
      const fs = createMockScaffoldFs()
      const result = scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'basic'})
      expect(result.files).not.toContain('symlink.tmp-test')
    } finally {
      nodeFs.unlinkSync(symlinkPath)
    }
  })
})

describe('generateConfig', () => {
  it('produces valid YAML that passes schema validation', async () => {
    for (const template of BUILTIN_TEMPLATES) {
      const config = await loadGeneratedConfig(generateConfig('test-project', template))
      expect(config.project.name).toBe('test-project')
      expect(config.project.template).toBe(template)
    }
  })

  it('uses the pinned upstream manifest SDK version and profile-based runtime model', async () => {
    const yaml = generateConfig('my-app', 'basic')
    expect(yaml).toContain(`sdk-version: "${PINNED_SDK_VERSION}"`)
    expect(yaml).toContain('default-profile: sandbox')
    expect(yaml).toContain('profiles:')
    expect(yaml).toContain('kind: sandbox')
    expect(yaml).toContain('profile: sandbox')

    const config = await loadGeneratedConfig(yaml)
    expect(config.project.name).toBe('my-app')
    expect(config.project['sdk-version']).toBe(PINNED_SDK_VERSION)
    expect(config['default-profile']).toBe('sandbox')
    expect(config.networkProfiles?.local).toBe('sandbox')
    expect(config.profiles?.sandbox.kind).toBe('sandbox')
    expect(config.profiles?.sandbox.services.ledger).toEqual({
      port: 5001,
      'json-api-port': 7575,
    })
  })

  it('includes default parties (Alice and Bob)', () => {
    const yaml = generateConfig('my-app', 'basic')
    expect(yaml).toContain('Alice')
    expect(yaml).toContain('Bob')
  })

  it('includes a stable remote validator profile for splice-token-app', async () => {
    const yaml = generateConfig('my-app', 'splice-token-app')
    expect(yaml).toContain('splice-devnet:')
    expect(yaml).toContain('kind: remote-validator')
    expect(yaml).toContain('tokenStandard:')
    expect(yaml).toContain('scan:')
    expect(yaml).toContain('validator:')

    const config = await loadGeneratedConfig(yaml)
    expect(config.networkProfiles?.devnet).toBe('splice-devnet')
    expect(config.profiles?.['splice-devnet']).toMatchObject({
      kind: 'remote-validator',
      services: {
        auth: {kind: 'oidc'},
      },
    })
  })
})

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

  it('generates token watchlist contract for splice-token-app', () => {
    const source = generateDamlSource('splice-token-app')
    expect(source).toContain('template TokenWatchlist')
    expect(source).toContain('choice RefreshSnapshot')
  })

  it('generates scan bookmark contract for splice-scan-reader', () => {
    const source = generateDamlSource('splice-scan-reader')
    expect(source).toContain('template ScanBookmark')
    expect(source).toContain('choice AdvanceCursor')
  })

  it('generates wallet connection contract for splice-dapp-sdk', () => {
    const source = generateDamlSource('splice-dapp-sdk')
    expect(source).toContain('template WalletConnection')
    expect(source).toContain('choice RememberProvider')
  })

  it('throws when a bundled template file is missing', () => {
    const filePath = path.join(TEMPLATE_ROOT, 'basic', 'files', 'daml', 'Main.daml')
    const backupPath = `${filePath}.tmp-test`
    nodeFs.renameSync(filePath, backupPath)

    try {
      expect(() => generateDamlSource('basic')).toThrow(CantonctlError)
    } finally {
      nodeFs.renameSync(backupPath, filePath)
    }
  })
})

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

  it('generates tests for splice-token-app template', () => {
    const test = generateDamlTest('splice-token-app')
    expect(test).toContain('testCreateWatchlist')
    expect(test).toContain('testRefreshSnapshot')
  })

  it('generates tests for splice-scan-reader template', () => {
    const test = generateDamlTest('splice-scan-reader')
    expect(test).toContain('testCreateBookmark')
    expect(test).toContain('testAdvanceCursor')
  })

  it('generates tests for splice-dapp-sdk template', () => {
    const test = generateDamlTest('splice-dapp-sdk')
    expect(test).toContain('testCreateConnection')
    expect(test).toContain('testRememberProvider')
  })
})

describe('scaffoldFromUrl', () => {
  it('clones repo and validates manifest exists', async () => {
    const {scaffoldFromUrl} = await import('./scaffold.js')
    const runner = createMockRunner()
    runner.run.mockResolvedValue({exitCode: 0, stderr: '', stdout: ''})

    const fs = createMockScaffoldFs()
    const existsSet = new Set<string>()
    const fsWithManifest: ScaffoldFileSystem = {
      ...fs,
      existsSync(p: string) {
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
      url: 'https://github.com/user/missing-template',
    })).rejects.toThrow(CantonctlError)
  })
})

describe('module initialization', () => {
  it('throws when a bundled template manifest is missing', async () => {
    const manifestPath = path.join(TEMPLATE_ROOT, 'basic', 'template.json')
    const backupPath = `${manifestPath}.tmp-test`
    nodeFs.renameSync(manifestPath, backupPath)

    try {
      vi.resetModules()
      await expect(import('./scaffold.js')).rejects.toMatchObject({code: ErrorCode.CONFIG_SCHEMA_VIOLATION})
    } finally {
      nodeFs.renameSync(backupPath, manifestPath)
    }
  })

  it('throws when a bundled template manifest contains invalid json', async () => {
    const manifestPath = path.join(TEMPLATE_ROOT, 'basic', 'template.json')
    const original = nodeFs.readFileSync(manifestPath, 'utf8')
    nodeFs.writeFileSync(manifestPath, '{"description":')

    try {
      vi.resetModules()
      await expect(import('./scaffold.js')).rejects.toMatchObject({code: ErrorCode.CONFIG_SCHEMA_VIOLATION})
    } finally {
      nodeFs.writeFileSync(manifestPath, original)
    }
  })

  it('drops non-Error manifest parse failures from the wrapped cause', async () => {
    const originalParse = JSON.parse
    JSON.parse = (() => { throw 'bad manifest' }) as typeof JSON.parse

    try {
      vi.resetModules()
      try {
        await import('./scaffold.js')
      } catch (err) {
        expect((err as {code?: string}).code).toBe(ErrorCode.CONFIG_SCHEMA_VIOLATION)
        expect((err as Error & {cause?: unknown}).cause).toBeUndefined()
      }
    } finally {
      JSON.parse = originalParse
    }
  })
})
