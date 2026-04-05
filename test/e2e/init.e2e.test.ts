/**
 * @module test/e2e/init
 *
 * End-to-end tests for `cantonctl init`.
 */

import {execSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {loadConfig} from '../../src/lib/config.js'
import {scaffoldProject, type Template} from '../../src/lib/scaffold.js'
import {getUpstreamSource} from '../../src/lib/upstream/manifest.js'
import {ENV_PATH, hasSdk, SDK_COMMAND, SDK_VERSION} from './helpers.js'

const BUILTIN_TEMPLATES: Template[] = [
  'splice-dapp-sdk',
  'splice-scan-reader',
  'splice-token-app',
]

const PINNED_SDK_VERSION = (() => {
  const source = getUpstreamSource('canton-json-ledger-api-openapi').source
  const version = source.kind === 'git' ? source.ref : source.version
  return version.replace(/^v/, '').split('-')[0]
})()

function run(cmd: string, cwd: string): {exitCode: number; stderr: string; stdout: string} {
  try {
    const stdout = execSync(cmd, {
      cwd,
      env: {...process.env, PATH: ENV_PATH},
      stdio: 'pipe',
      timeout: 120_000,
    }).toString()
    return {exitCode: 0, stderr: '', stdout}
  } catch (err: unknown) {
    const error = err as {status?: number; stdout?: Buffer; stderr?: Buffer}
    return {
      exitCode: error.status ?? 1,
      stderr: error.stderr?.toString() ?? '',
      stdout: error.stdout?.toString() ?? '',
    }
  }
}

const SDK_AVAILABLE = hasSdk()
const itWithSdk = SDK_AVAILABLE ? it : it.skip
const SDK_BUILD_COMMAND = SDK_COMMAND === 'daml'
  ? 'daml build --no-legacy-assistant-warning'
  : 'dpm build'
const SDK_TEST_COMMAND = SDK_COMMAND === 'daml'
  ? 'daml test --no-legacy-assistant-warning'
  : 'dpm test'

let workDir: string

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantonctl-e2e-init-'))
})

afterAll(() => {
  fs.rmSync(workDir, {recursive: true, force: true})
})

describe('init E2E: scaffold', () => {
  for (const template of BUILTIN_TEMPLATES) {
    describe(`template: ${template}`, () => {
      let projectDir: string

      beforeAll(() => {
        projectDir = path.join(workDir, `test-${template}`)
        scaffoldProject({dir: projectDir, name: `test-${template}`, template})
      })

      it('creates the expected files on disk', () => {
        expect(fs.existsSync(path.join(projectDir, 'cantonctl.yaml'))).toBe(true)
        expect(fs.existsSync(path.join(projectDir, 'daml.yaml'))).toBe(true)
        expect(fs.existsSync(path.join(projectDir, 'daml', 'Main.daml'))).toBe(true)
        expect(fs.existsSync(path.join(projectDir, 'test', 'Main.test.daml'))).toBe(true)
        expect(fs.existsSync(path.join(projectDir, '.gitignore'))).toBe(true)
      })

      it('generates profile-based config that validates', async () => {
        const config = await loadConfig({dir: projectDir})
        expect(config.version).toBe(1)
        expect(config.project.name).toBe(`test-${template}`)
        expect(config.project['sdk-version']).toBe(PINNED_SDK_VERSION)
        expect(config.project.template).toBe(template)
        expect(config['default-profile']).toBe('sandbox')
        expect(config.networkProfiles?.local).toBe('sandbox')
        expect(config.networkProfiles?.devnet).toBe('splice-devnet')
        expect(config.profiles?.sandbox.kind).toBe('sandbox')
        expect(config.profiles?.['splice-devnet']).toMatchObject({
          kind: 'remote-validator',
          services: {
            auth: {kind: 'oidc'},
          },
        })
      })
    })
  }

  it('splice-token-app creates stable token starter files', () => {
    const dir = path.join(workDir, 'test-splice-token-app')
    const tokenClient = fs.readFileSync(path.join(dir, 'frontend', 'src', 'token-client.ts'), 'utf8')
    expect(tokenClient).toContain('transfer-instruction')
    expect(tokenClient).not.toContain('validator-internal')
  })

  it('splice-scan-reader creates stable scan reader files', () => {
    const dir = path.join(workDir, 'test-splice-scan-reader')
    const reader = fs.readFileSync(path.join(dir, 'scripts', 'read-scan-updates.mjs'), 'utf8')
    expect(reader).toContain('/v2/updates')
    expect(reader).not.toContain('validator-internal')
  })

  it('splice-dapp-sdk creates public SDK starter files', () => {
    const dir = path.join(workDir, 'test-splice-dapp-sdk')
    const packageJson = fs.readFileSync(path.join(dir, 'frontend', 'package.json'), 'utf8')
    expect(packageJson).toContain('@canton-network/dapp-sdk')
    expect(packageJson).toContain('@canton-network/wallet-sdk')
  })

  it('scaffold fails on an existing directory', () => {
    const dir = path.join(workDir, 'test-splice-dapp-sdk')
    expect(() => scaffoldProject({dir, name: 'test-splice-dapp-sdk', template: 'splice-dapp-sdk'})).toThrow()
  })
})

describe('init E2E: Daml compilation', () => {
  for (const template of BUILTIN_TEMPLATES) {
    itWithSdk(`${template} template compiles with the SDK build command`, () => {
      const projectDir = path.join(workDir, `compile-${template}`)
      scaffoldProject({dir: projectDir, name: `compile-${template}`, template})

      const damlYaml = fs.readFileSync(path.join(projectDir, 'daml.yaml'), 'utf8')
      fs.writeFileSync(
        path.join(projectDir, 'daml.yaml'),
        damlYaml.replace(/sdk-version: .*/, `sdk-version: ${SDK_VERSION}`),
      )

      const result = run(SDK_BUILD_COMMAND, projectDir)
      expect(result.exitCode).toBe(0)
      expect(fs.existsSync(path.join(projectDir, '.daml', 'dist'))).toBe(true)
    })
  }

  for (const template of BUILTIN_TEMPLATES) {
    itWithSdk(`${template} template tests pass with the SDK test command`, () => {
      const projectDir = path.join(workDir, `compile-${template}`)
      const result = run(SDK_TEST_COMMAND, projectDir)
      expect(result.exitCode).toBe(0)
    })
  }
})

describe('init E2E: result shape', () => {
  it('returns the created files list', () => {
    const dir = path.join(workDir, 'json-test')
    const result = scaffoldProject({dir, name: 'json-test', template: 'splice-dapp-sdk'})

    expect(result.projectDir).toBe(dir)
    expect(result.template).toBe('splice-dapp-sdk')
    expect(result.files).toEqual(expect.arrayContaining([
      'cantonctl.yaml',
      'daml.yaml',
      path.join('daml', 'Main.daml'),
      path.join('test', 'Main.test.daml'),
      '.gitignore',
    ]))
  })
})
