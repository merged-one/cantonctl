import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, it} from 'vitest'

import {loadConfig, type ConfigFileSystem} from './config.js'
import {CantonctlError, ErrorCode} from './errors.js'
import {
  TEMPLATES,
  type ScaffoldFileSystem,
  generateConfig,
  generateDamlSource,
  generateDamlTest,
  scaffoldProject,
  type Template,
} from './scaffold.js'
import {getUpstreamSource} from './upstream/manifest.js'

const BUILTIN_TEMPLATES: Template[] = [...TEMPLATES]
const PINNED_SDK_VERSION = (() => {
  const source = getUpstreamSource('canton-json-ledger-api-openapi').source
  const version = source.kind === 'git' ? source.ref : source.version
  return version.replace(/^v/, '').split('-')[0]
})()
const TEMPLATE_ROOT = fileURLToPath(new URL('../../assets/templates/', import.meta.url))

interface WrittenFile {
  content: string
  path: string
}

function createMockScaffoldFs(existing: Set<string> = new Set()): ScaffoldFileSystem & {
  dirs: string[]
  written: WrittenFile[]
} {
  const written: WrittenFile[] = []
  const dirs: string[] = []
  return {
    dirs,
    existsSync(p: string) {
      return existing.has(p)
    },
    mkdirSync(p: string) {
      dirs.push(p)
    },
    writeFileSync(p: string, content: string) {
      written.push({content, path: p})
    },
    written,
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
  it('keeps only the companion-first Splice templates', () => {
    expect(TEMPLATES).toEqual([
      'splice-dapp-sdk',
      'splice-scan-reader',
      'splice-token-app',
    ])
  })

  for (const template of BUILTIN_TEMPLATES) {
    it(`creates the base project structure for ${template}`, () => {
      const fs = createMockScaffoldFs()
      const result = scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template})

      expect(result.projectDir).toBe('/projects/my-app')
      expect(result.template).toBe(template)
      expect(fs.dirs).toContain('/projects/my-app')
      expect(fs.dirs).toContain(path.join('/projects/my-app', 'daml'))
      expect(fs.dirs).toContain(path.join('/projects/my-app', 'test'))
      expect(fs.dirs).toContain(path.join('/projects/my-app', 'scripts'))
      expect(fs.written.map(file => file.path)).toEqual(expect.arrayContaining([
        path.join('/projects/my-app', 'cantonctl.yaml'),
        path.join('/projects/my-app', 'daml.yaml'),
        path.join('/projects/my-app', 'daml', 'Main.daml'),
        path.join('/projects/my-app', 'test', 'Main.test.daml'),
        path.join('/projects/my-app', '.gitignore'),
      ]))
    })
  }

  it('throws a structured error when the target directory already exists', () => {
    const fs = createMockScaffoldFs(new Set(['/projects/my-app']))

    expect(() => scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-dapp-sdk'}))
      .toThrow(CantonctlError)

    try {
      scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-dapp-sdk'})
    } catch (error) {
      expect(error).toEqual(expect.objectContaining({
        code: ErrorCode.CONFIG_DIRECTORY_EXISTS,
      }))
    }
  })

  it('creates stable token-standard starter files for splice-token-app', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-token-app'})

    const client = getWrittenFile(fs, path.join('frontend', 'src', 'token-client.ts')).content
    expect(client).toContain('transfer-instruction')
    expect(client).toContain('holdings')
    expect(client).not.toContain('validator-internal')
  })

  it('creates stable scan reader files for splice-scan-reader', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-scan-reader'})

    const reader = getWrittenFile(fs, path.join('scripts', 'read-scan-updates.mjs')).content
    expect(reader).toContain('/v2/updates')
    expect(reader).not.toContain('validator-internal')
  })

  it('creates public SDK starter files for splice-dapp-sdk', () => {
    const fs = createMockScaffoldFs()
    scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-dapp-sdk'})

    const packageJson = getWrittenFile(fs, path.join('frontend', 'package.json')).content
    expect(packageJson).toContain('@canton-network/dapp-sdk')
    expect(packageJson).toContain('@canton-network/wallet-sdk')
    expect(packageJson).not.toContain('validator-internal')
  })

  it('throws when bundled template files are missing', () => {
    const filesPath = path.join(TEMPLATE_ROOT, 'splice-dapp-sdk', 'files')
    const backupPath = `${filesPath}.tmp-test`
    nodeFs.cpSync(filesPath, backupPath, {recursive: true})
    nodeFs.rmSync(filesPath, {force: true, recursive: true})

    try {
      expect(() => scaffoldProject({
        dir: '/projects/my-app',
        fs: createMockScaffoldFs(),
        name: 'my-app',
        template: 'splice-dapp-sdk',
      })).toThrow(CantonctlError)
    } finally {
      nodeFs.cpSync(backupPath, filesPath, {recursive: true})
      nodeFs.rmSync(backupPath, {force: true, recursive: true})
    }
  })

  it('ignores non-file entries while walking bundled template files', () => {
    const symlinkPath = path.join(TEMPLATE_ROOT, 'splice-dapp-sdk', 'files', 'symlink.tmp-test')
    nodeFs.symlinkSync(path.join(TEMPLATE_ROOT, 'splice-dapp-sdk', 'files', 'daml', 'Main.daml'), symlinkPath)

    try {
      const fs = createMockScaffoldFs()
      const result = scaffoldProject({dir: '/projects/my-app', fs, name: 'my-app', template: 'splice-dapp-sdk'})
      expect(result.files).not.toContain('symlink.tmp-test')
    } finally {
      nodeFs.unlinkSync(symlinkPath)
    }
  })
})

describe('generateConfig', () => {
  it('produces valid YAML for every built-in template', async () => {
    for (const template of BUILTIN_TEMPLATES) {
      const config = await loadGeneratedConfig(generateConfig('test-project', template))
      expect(config.project.name).toBe('test-project')
      expect(config.project.template).toBe(template)
      expect(config.project['sdk-version']).toBe(PINNED_SDK_VERSION)
      expect(config['default-profile']).toBe('sandbox')
      expect(config.networkProfiles?.local).toBe('sandbox')
      expect(config.networkProfiles?.devnet).toBe('splice-devnet')
      expect(config.profiles?.['splice-devnet']).toEqual(expect.objectContaining({
        kind: 'remote-validator',
      }))
    }
  })
})

describe('template sources', () => {
  it('renders Daml sources for each built-in template', () => {
    expect(generateDamlSource('splice-dapp-sdk')).toContain('template WalletConnection')
    expect(generateDamlSource('splice-scan-reader')).toContain('template ScanBookmark')
    expect(generateDamlSource('splice-token-app')).toContain('template TokenWatchlist')
  })

  it('renders Daml tests for each built-in template', () => {
    expect(generateDamlTest('splice-dapp-sdk')).toContain('script do')
    expect(generateDamlTest('splice-scan-reader')).toContain('script do')
    expect(generateDamlTest('splice-token-app')).toContain('script do')
  })
})
